# Spring Boot Kotlin — running JVM vs. native (AOT)

`packages/backend/springkt` can run two ways: as a normal JVM process
(`bootRun` / `bootJar` + `java -jar`), or compiled ahead-of-time to a GraalVM
native executable (`nativeCompile`). Both read the same
`src/main/resources/application.yaml`, but that file's *defaults* don't match
every local Postgres setup — see below.

## Why `./gradlew bootRun` can fail out of the box

`application.yaml` defaults to:

```yaml
spring:
  datasource:
    username: ${DB_USERNAME:postgres}
    password: ${DB_PASSWORD:nadhim}
```

If your local Postgres doesn't have a `postgres` role (e.g. on macOS with
Postgres.app / Homebrew, the default superuser role is usually your OS
username instead), `bootRun` fails during startup with:

```
org.hibernate.exception.AuthException: Unable to obtain isolated JDBC connection [FATAL: role "postgres" does not exist]
```

This is **not a port conflict** and not a bug in the app — it's Hibernate
failing to open its first connection because the role in the JDBC URL doesn't
exist. Check your actual role with:

```sh
psql -h localhost -d postgres -c "\du"
```

Whatever role has `Superuser`/`Create DB` there is what you pass below. The
repo's own root `.env` documents this project's dev role as `mac` (not
`postgres`) — see `_infra/scripts/env.sh`.

## Running JVM mode (any port)

```sh
cd packages/backend/springkt
./gradlew bootRun --args="--spring.datasource.url=jdbc:postgresql://localhost:5432/dekaliber --spring.datasource.username=mac --spring.datasource.password=nadhim --server.port=8080"
```

Or use the wrapper script (see `_infra/scripts/run-springkt-jvm.sh`), which
reads credentials from the root `.env` instead of hardcoding them.

`--args` is used instead of `DB_*` environment variables on purpose: env vars
set before invoking `gradlew` were observed not reliably reaching the forked
JVM through the Gradle daemon (stale daemon state), while `--args` are parsed
by Spring Boot itself as the highest-priority property source and always win.

## Building + running native (AOT) mode

```sh
cd packages/backend/springkt
./gradlew nativeCompile
./build/native/nativeCompile/dekaliber \
  --spring.datasource.url=jdbc:postgresql://localhost:5432/dekaliber \
  --spring.datasource.username=mac \
  --spring.datasource.password=nadhim \
  --server.port=8081
```

Or `_infra/scripts/run-springkt-native.sh`, which builds if the binary is
missing/stale, then runs it.

Native build takes ~7-9 minutes on Apple Silicon (GraalVM 25, Oracle
distribution via SDKMAN `25-graal`). The build is **not cross-platform** —
the binary produced only runs on the OS/architecture it was built on. For
Linux deployment, rebuild on Linux (or via Docker buildx / CI).

### What makes native mode work here

Three GraalVM/Hibernate/Kotlin incompatibilities had to be worked around
(see `packages/backend/springkt/build.gradle.kts` comments for the fully
detailed rationale of each):

1. **Hibernate ORM 7's reflective annotation-mock classes**
   (`org.hibernate.boot.models.annotations.internal.*`) aren't covered by a
   hand-written reflect-config — they're generated per JPA/Hibernate
   annotation actually used. Fixed by capturing `reachability-metadata.json`
   with the GraalVM tracing agent instead of hand-writing it.
2. **Hibernate's default bytecode provider (ByteBuddy)** generates proxy
   classes at runtime via `ClassLoader.defineClass`, which native-image's
   closed-world model rejects outright. Setting
   `hibernate.bytecode.provider: none` in `application.yaml` does **not**
   work on Hibernate 7.4.1 — `BytecodeProviderInitiator` ignores that
   property and unconditionally `ServiceLoader`-loads every registered
   provider regardless of config. Fixed by stripping
   `META-INF/services/org.hibernate.bytecode.spi.BytecodeProvider` from the
   `hibernate-core` jar via a Gradle artifact transform, so `ServiceLoader`
   finds none and Hibernate falls back to its built-in no-op provider.
3. **`kotlin-reflect`**, pulled in transitively by `jackson-module-kotlin`,
   is used by Spring Data JPA's `PreferredConstructorDiscoverer` for any
   Kotlin-compiled class (every `.kt` file carries `@kotlin.Metadata`,
   regardless of whether it needs Kotlin-specific reflection). It fails
   under native-image with `KotlinReflectionInternalError: Unresolved class:
   java.lang.String` because the `kotlin/*.kotlin_builtins` resource files
   it needs (bundled in `kotlin-stdlib`) aren't captured by the tracing
   agent's default heuristic filter (treated as JDK-internal). Fixed by
   registering `kotlin/**/*.kotlin_builtins` as an explicit resource glob in
   `reachability-metadata.json`.

### Regenerating `reachability-metadata.json`

If you add new endpoints, entities, or dependencies, the committed
`src/main/resources/META-INF/native-image/id.archmage/dekaliber/reachability-metadata.json`
may need new entries:

```sh
cd packages/backend/springkt
./gradlew bootJar
java -agentlib:native-image-agent=config-output-dir=/tmp/agent-out \
  -jar build/libs/dekaliber-0.0.1-SNAPSHOT.jar \
  --spring.datasource.url=jdbc:postgresql://localhost:5432/dekaliber \
  --spring.datasource.username=mac \
  --spring.datasource.password=nadhim \
  --server.port=8080
# exercise every endpoint (GET/POST/PUT/DELETE on /resource, /metrics, and at
# least one validation-error and one 404 case) so the agent traces those
# reflective/resource-loading paths, then stop the process with SIGTERM
# (not SIGKILL -- the agent flushes its config on graceful shutdown only)
cp /tmp/agent-out/reachability-metadata.json \
  src/main/resources/META-INF/native-image/id.archmage/dekaliber/reachability-metadata.json
```

Two entries are added back manually after every regeneration because the
agent doesn't reliably trigger them in a short manual test run (they depend
on HikariCP pool-resize timing):

```json
{ "type": "com.zaxxer.hikari.util.ConcurrentBag$IConcurrentBagEntry[]" }
{ "type": "java.sql.Statement[]" }
```

## Running both modes side by side

Since they're separate processes, just use different `--server.port` values
(see `_infra/scripts/run-springkt-jvm.sh` and
`_infra/scripts/run-springkt-native.sh`, which default to 8080 and 8081
respectively).

## `/metrics` RSS reporting

Both backends expose `GET /metrics`. NestJS reports real RSS via Node's
`process.memoryUsage().rss`. The JVM has no standard cross-platform API for
process RSS, so Spring Boot's `MetricsController` reads `VmRSS` from
`/proc/self/status` on Linux (accurate — same mechanism as `ps`/`top`) and
falls back to `heapUsedMB` on other OSes (e.g. macOS during local dev),
marking which one was used via the `rssSource` field (`"proc"` vs.
`"heapFallback"`) so the two are never silently conflated.
