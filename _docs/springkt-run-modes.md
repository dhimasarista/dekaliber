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

### Native (AOT) build variants

`nativeCompile` produces one binary per invocation — GC choice and PGO
profile are baked in at compile time, not switchable at runtime like a JVM
flag. All variants below use the same `reachability-metadata.json` and
artifact-transform fixes described above; only the `native-image` build
args differ. Each rebuild takes ~7-9 minutes on Apple Silicon.

| Variant | Command | Binary output | When to use |
|---|---|---|---|
| **Default (Serial GC)** | `./gradlew nativeCompile` or `_infra/scripts/run-springkt-native.sh` | `build/native/nativeCompile/dekaliber` | The default for a reason: smallest footprint, fastest startup (~0.2-0.4s observed). Start here. |
| **G1 GC** | `NATIVE_GC=G1 _infra/scripts/run-springkt-native.sh` | same path, overwritten | Sustained high-concurrency load where GC pause time shows up in tail latency. Trades startup speed/footprint for throughput. |
| **PGO instrumented** (step 1 of 2) | `NATIVE_BUILD_ARGS="--pgo-instrument" _infra/scripts/run-springkt-native.sh` | same path — this binary is for profiling only, not for serving real traffic | First half of a PGO build. Produces a binary that's slower than normal (instrumentation overhead) but records a `.iprof` profile of what it executes. |
| **PGO final** (step 2 of 2) | `NATIVE_BUILD_ARGS="--pgo=default.iprof" _infra/scripts/run-springkt-native.sh` | same path, overwritten | Rebuild using the profile collected above. Closes some of the hot-path-optimization gap between native (AOT, no runtime JIT) and JVM mode (JIT profiles hot paths automatically at runtime) — worth it if native mode is measurably behind JVM mode under load and startup-time PGO overhead is acceptable to pay once. |
| **G1 + PGO combined** | 1) `NATIVE_GC=G1 NATIVE_BUILD_ARGS="--pgo-instrument" _infra/scripts/run-springkt-native.sh`, run + collect profile, 2) `NATIVE_GC=G1 NATIVE_BUILD_ARGS="--pgo=default.iprof" _infra/scripts/run-springkt-native.sh` | same path, overwritten | Both levers together, for sustained-throughput workloads. Not benchmarked here — combine only after confirming each lever helps on its own. |

`NATIVE_GC` and `NATIVE_BUILD_ARGS` can be combined (as above) — the script
always prepends `--gc=$NATIVE_GC` ahead of whatever's in `NATIVE_BUILD_ARGS`,
so there's no need to also put `--gc=G1` inside `NATIVE_BUILD_ARGS` by hand.

Only one binary exists on disk at a time (`build/native/nativeCompile/dekaliber`)
— building a new variant overwrites the previous one. Rename or copy it
elsewhere first if you want to keep several variants around to compare
(e.g. `cp build/native/nativeCompile/dekaliber build/native/nativeCompile/dekaliber-g1`).

See the PGO walkthrough further down for the full instrumented-run →
rebuild sequence, and the GC entry below for why Serial is the default.

### Per-stack tuning: pool size, GC, virtual threads

Pool sizes, thread pools, and GC choice are **deliberately not matched to
the other backends' numbers** (NestJS, Fiber). An earlier iteration pinned
every backend's connection pool to the same literal value (50) as an
attempt at a "fair" comparison; re-testing under load showed this was its
own source of bias, not a neutral baseline — see the HikariCP comment in
`application.yaml` and `packages/backend/nestjs/src/prisma/prisma.service.ts`
for the specifics. Each backend is now sized per its own best-practice
guidance instead:

- **HikariCP** (`spring.datasource.hikari.maximum-pool-size`, default 20):
  sized via HikariCP's own `(core_count * 2) + effective_spindle_count`
  formula, not copied from another stack's pool number.

  Confirmed the bottleneck at 20 under 500 VU load
  (`HikariPool-1 - Pool stats (total=20/20, idle=0/20, active=20,
  waiting=479)` — enable with
  `JAVA_TOOL_OPTIONS="-Dlogging.level.com.zaxxer.hikari=DEBUG"`), then swept
  the pool up via `HIKARI_POOL_SIZE=100 _infra/scripts/run-springkt-jvm.sh`
  to chase the queue away. **It got worse** (1012 rps at pool=20 vs.
  761-933 rps at pool=100) — Postgres's own `max_connections=100` became
  the real ceiling once HikariCP itself asked for 100 connections, leaving
  ~0 headroom for Postgres's background processes; a plain `psql` couldn't
  even connect during that run (`FATAL: sorry, too many clients already`).
  The queue didn't disappear at pool=100 either (`waiting=400`) — it moved
  from "waiting for a HikariCP connection" to "waiting for Postgres itself
  to have a free slot," which is strictly worse. Reverted to 20. Raising
  Postgres's `max_connections` and re-sweeping is the correct next step if
  this needs revisiting, not raising the app-side pool further.
- **`server.tomcat.threads.max`**: with virtual threads enabled (see
  below), this stops being a real concurrency cap — it's the platform
  (carrier) thread pool size, not a limit on in-flight
  requests/virtual-threads. Left at Spring Boot's own default (200)
  rather than raised; raising it previously (500) didn't change measured
  throughput, consistent with it not being the relevant lever anymore.
- **Virtual threads** (`spring.threads.virtual.enabled: true`): confirmed
  active by thread-dumping the JVM mid-request and finding the
  request-handling thread listed as `"tomcat-handler-N" virtual` with a
  `VirtualThread.parkNanos`/`sleepNanos` stack — not just inferred from the
  config existing. Supported out of the box on GraalVM for JDK 21+
  (including the JDK 25 distribution this project targets) with no extra
  native-image flags required; this was also confirmed empirically here —
  the native binary boots and serves requests normally with this setting
  on.

  Also directly A/B'd against platform threads at the same pool=20 / 500 VU
  load (`SPRING_THREADS_VIRTUAL_ENABLED=false`, confirmed off via thread
  dump — threads show as `"http-nio-8080-exec-N"`, not
  `"tomcat-handler-N" virtual`): VT on = 1012 rps / 456ms avg / 808ms p95,
  VT off = 664 rps / 671ms avg / 1000ms p95. Virtual threads measurably
  *help* under this load — don't swap to Kotlin coroutines chasing this
  bottleneck; coroutines are a different scheduler over the same limited
  Postgres connection count, not a way to get more connections out of
  Postgres.
- **Thread pinning** (virtual threads only): a `synchronized` block or
  certain native/blocking calls on the request path can pin a virtual
  thread to its OS carrier thread, silently defeating the point of using
  virtual threads under load. Detect it with:
  ```sh
  TRACE_PINNED=1 _infra/scripts/run-springkt-jvm.sh
  ```
  which sets `-Djdk.tracePinnedThreads=full`; watch stdout/stderr for
  `Thread pinned` during a load test — it prints the exact blocking call to
  fix (typically: replace `synchronized` with
  `java.util.concurrent.locks.ReentrantLock`).
- **Native-image GC and PGO**: see "Native (AOT) build variants" above for
  the full command reference. Summary of the *why*: native-image defaults
  to Serial GC (small footprint, fast startup — the usual reason to reach
  for native-image at all); G1 trades some of that away for better
  sustained throughput, worth trying if a load test shows GC pause time
  dominating tail latency. Separately, native-image without PGO misses
  hot-path optimizations the JVM's JIT would normally discover at runtime
  — a plausible reason native mode can trail JVM mode under some loads
  despite native's faster startup/lower idle memory. Both are compile-time
  choices (force a rebuild), not runtime flags. Full instrumented-run →
  rebuild sequence:
  ```sh
  # 1. Build an instrumented image and run a representative workload
  #    against it to collect a profile
  cd packages/backend/springkt
  ./gradlew nativeCompile --build-args="--pgo-instrument"
  ./build/native/nativeCompile/dekaliber --server.port=8081 &
  # exercise it with a representative load (e.g. the k6 mixed-crud script)
  # against :8081, then stop the process -- default.iprof is written to
  # the working directory on exit
  # 2. Rebuild using the collected profile
  NATIVE_BUILD_ARGS="--pgo=default.iprof" _infra/scripts/run-springkt-native.sh
  ```
  Not run as part of the default build — it requires a representative
  load run between the two builds, which isn't something to do on every
  `nativeCompile`.

## Reset test data before every load-test comparison run

```sh
_infra/scripts/reset-test-data.sh
```

Truncates and vacuums every backend's test table (`resource`, `"Resource"`,
`resource_fiber` — one per backend, see "Per-stack tuning" and
`_docs/fiber-backend.md` for why they're separate). **Run this before every
load test you intend to compare against another run or another backend.**

This isn't optional cleanup — forgetting it silently invalidates throughput
numbers. `k6/mixed-crud.js`'s `create` op (30% weight) inserts continuously
with no cleanup, so table size grows monotonically across every run you
don't reset, and `read_heavy`'s `ORDER BY created_at LIMIT/OFFSET` query
gets more expensive as the table and its indexes grow. Confirmed impact
(2026-07-12): the exact same Spring Boot JVM code/config measured
593-1012 rps (p95 800ms-1.34s) on a table that had accumulated 262k rows
(50MB, 27.8k dead tuples, autovacuum running behind) across several
unreset test runs — then **2388.8 rps (p95 384ms)** immediately after
running this script, no other change. That's not a JVM, HikariCP, pool-size,
or virtual-threads effect — every backend sharing this Postgres instance is
equally exposed to the same table-bloat problem, so forgetting to reset
before a run biases *whichever backend you're testing that run* downward by
an amount that has nothing to do with the backend itself.

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
