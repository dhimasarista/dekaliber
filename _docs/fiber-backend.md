# Go Fiber backend

`packages/backend/fiber` is the third backend in the load-test comparison,
alongside NestJS and Spring Boot Kotlin. Same contract, same Postgres
instance, own table.

- Framework: [Fiber v3](https://docs.gofiber.io/) (not v2 — check before
  copying examples from older docs/tutorials, the `Ctx` API changed).
- ORM: GORM (`gorm.io/gorm` + `gorm.io/driver/postgres`).
- Entity: `Resource` (`id`, `label`, `value`, `status`, `createdAt`,
  `updatedAt`) — same shape as the NestJS/Prisma and Spring Boot/JPA
  entities, stored in its own table (`resource_fiber`), not shared with
  them. All three backends run against the same `dekaliber` database but
  never touch each other's rows.
- Endpoints: `POST/GET/PUT/DELETE /resource` (+ `GET /resource/:id`), `GET
  /metrics` — identical routes/behavior to the other two backends, including
  the `raw=true` query param on `GET /resource` (bypasses GORM's query
  builder for a raw-SQL comparison baseline, same as NestJS's `$queryRaw`
  path).

## Running

```sh
_infra/scripts/run-fiber.sh              # port 8082 (default)
_infra/scripts/run-fiber.sh 8083          # custom port
```

Or directly:

```sh
cd packages/backend/fiber
go run . --db-username=mac --db-password=nadhim --server-port=8082
```

The schema is created via GORM `AutoMigrate` on startup — no separate
migration step needed (unlike Prisma/Hibernate).

## Postgres index-naming gotcha

Index names are **global per schema in Postgres**, not scoped per table.
Early in development, the GORM index tags used `idx_resource_status` /
`idx_resource_created_at` — the exact same names Hibernate already uses for
the Spring Boot side's `resource` table. `CREATE INDEX IF NOT EXISTS` then
silently no-op'd against the *existing* Spring Boot indexes instead of
creating new ones on `resource_fiber`, because the name was already taken.
`AutoMigrate` reported success and the SQL log showed the statement running,
but `\d resource_fiber` never showed the indexes — because they belonged to
a different table entirely.

Fixed by giving Fiber's indexes their own unique names:
`idx_resource_fiber_status` / `idx_resource_fiber_created_at`. If you add
more indexed fields later, always prefix index names with the
backend/table they belong to rather than reusing a generic
`idx_<column>` pattern — this project has three backends sharing one
Postgres instance, so name collisions across them are a real risk, not a
theoretical one.

## `/metrics` RSS reporting

Same approach as Spring Boot: Go has no standard cross-platform API for a
process's true RSS either, so `/metrics` reads `VmRSS` from
`/proc/self/status` on Linux and falls back to `runtime.MemStats.HeapAlloc`
elsewhere (e.g. macOS dev), marked via `rssSource` (`"proc"` vs.
`"heapFallback"`) — see `packages/backend/fiber/internal/metrics/handler.go`.
