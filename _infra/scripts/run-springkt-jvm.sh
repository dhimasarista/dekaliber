#!/usr/bin/env bash
# Runs the Spring Boot Kotlin backend locally in normal JVM mode (bootRun),
# reading Postgres credentials from the repo-root .env and passing them as
# Spring Boot command-line args -- not env vars, and not application.yaml's
# defaults (which point at a `postgres` role that may not exist locally;
# see _docs/springkt-run-modes.md for why plain `bootRun` can fail).
#
# Usage:
#   _infra/scripts/run-springkt-jvm.sh              # port 8080 (default)
#   _infra/scripts/run-springkt-jvm.sh 8082          # custom port
#   TRACE_PINNED=1 _infra/scripts/run-springkt-jvm.sh
#     Enables -Djdk.tracePinnedThreads=full. With virtual threads enabled,
#     any blocking call inside a `synchronized` block (or certain native
#     calls) pins the virtual thread to its OS carrier thread instead of
#     yielding it -- defeating the whole point of virtual threads under
#     load. This flag makes the JVM log a stack trace every time that
#     happens, pointing at the exact blocking call to fix (e.g. swap
#     `synchronized` for `java.util.concurrent.locks.ReentrantLock`).
#     Look for "Thread pinned" in stdout/stderr while running a load test.
#     CONFIRMED (2026-07-12, 200 VU / 25s / 21.5k requests): 0 pinning
#     events in this codebase -- Kotlin controllers/services, Hibernate,
#     HikariCP, and the Postgres JDBC driver are all pinning-clean. Leave
#     this OFF for throughput measurements: on vs. off showed ~6.5%
#     variance in a same-load A/B (856.8 vs 912.8 rps), most likely normal
#     run-to-run noise rather than tracing overhead, but with zero pinning
#     events to trace there's no diagnostic upside to leaving it on, only
#     downside risk to the numbers. Only turn it on again if new code adds
#     a `synchronized` block on the request path and you need to confirm
#     it isn't causing pinning.
#   HIKARI_POOL_SIZE=50 _infra/scripts/run-springkt-jvm.sh
#     Overrides datasource.hikari.maximum-pool-size (default 20). CONFIRMED
#     bottleneck at 20 under 500 VU load (2026-07-12): HikariCP's own
#     housekeeper log showed "Pool stats (total=20/20, idle=0/20,
#     active=20, waiting=479)" -- 479 requests queued for a connection at
#     once. Use this to sweep 20 -> 50 -> 100 and watch for the point where
#     Postgres itself (not the pool) becomes the limiting factor -- see
#     _docs/springkt-run-modes.md.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repo_root="$script_dir/../.."

# shellcheck disable=SC1091
source "$script_dir/load-root-env.sh"

db_host="${DB_HOST:-localhost}"
db_port="${DB_PORT:-5432}"
db_name="${DB_NAME:-dekaliber}"
db_username="${DB_USERNAME:-mac}"
db_password="${DB_PASSWORD:?DB_PASSWORD must be set in .env}"
server_port="${1:-${springkt_port:-8080}}"

if [ "${TRACE_PINNED:-0}" = "1" ]; then
  export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djdk.tracePinnedThreads=full"
fi

if [ -n "${HIKARI_POOL_SIZE:-}" ]; then
  export HIKARI_POOL_SIZE
fi

cd "$repo_root/packages/backend/springkt"

exec ./gradlew bootRun --console=plain --args="\
--spring.datasource.url=jdbc:postgresql://${db_host}:${db_port}/${db_name} \
--spring.datasource.username=${db_username} \
--spring.datasource.password=${db_password} \
--server.port=${server_port}"
