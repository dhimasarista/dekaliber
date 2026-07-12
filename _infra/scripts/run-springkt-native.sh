#!/usr/bin/env bash
# Builds (if needed) and runs the Spring Boot Kotlin backend as a GraalVM
# native executable, reading Postgres credentials from the repo-root .env.
# See _docs/springkt-run-modes.md for why native mode needs the committed
# reachability-metadata.json and what breaks without it.
#
# Usage:
#   _infra/scripts/run-springkt-native.sh              # port 8081 (default)
#   _infra/scripts/run-springkt-native.sh 8083          # custom port
#   FORCE_REBUILD=1 _infra/scripts/run-springkt-native.sh   # always rebuild
#   NATIVE_GC=G1 _infra/scripts/run-springkt-native.sh
#     Builds with --gc=G1 instead of native-image's default Serial GC.
#     Serial GC is tuned for small footprint and fast startup (the usual
#     reason to reach for native-image at all); G1 trades some of both
#     away for better throughput under sustained allocation pressure --
#     worth trying if a load test shows GC pause time dominating latency
#     at high concurrency. Forces a rebuild since GC choice is baked into
#     the binary; NATIVE_GC set to anything other than the last-used value
#     invalidates $binary's usefulness for the up-to-date check below, so
#     this always rebuilds when NATIVE_GC is set, not just when missing.
#   NATIVE_BUILD_ARGS="--pgo=/path/to/profile.iprof" _infra/scripts/run-springkt-native.sh
#     Passes through additional native-image build args, e.g. for a
#     second, PGO-optimized build once you have an .iprof profile from an
#     instrumented run (see _docs/springkt-run-modes.md).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repo_root="$script_dir/../.."
springkt_dir="$repo_root/packages/backend/springkt"
binary="$springkt_dir/build/native/nativeCompile/dekaliber"

# shellcheck disable=SC1091
source "$script_dir/load-root-env.sh"

db_host="${DB_HOST:-localhost}"
db_port="${DB_PORT:-5432}"
db_name="${DB_NAME:-dekaliber}"
db_username="${DB_USERNAME:-mac}"
db_password="${DB_PASSWORD:?DB_PASSWORD must be set in .env}"
server_port="${1:-8081}"

build_args="${NATIVE_BUILD_ARGS:-}"
if [ -n "${NATIVE_GC:-}" ]; then
  build_args="--gc=${NATIVE_GC} ${build_args}"
fi

if [ ! -x "$binary" ] || [ "${FORCE_REBUILD:-0}" = "1" ] || [ -n "${NATIVE_GC:-}" ] || [ -n "${NATIVE_BUILD_ARGS:-}" ]; then
  echo "Building native image (this takes ~7-9 minutes)..." >&2
  if [ -n "$build_args" ]; then
    echo "  with extra build args: $build_args" >&2
    (cd "$springkt_dir" && ./gradlew nativeCompile --console=plain --build-args="$build_args")
  else
    (cd "$springkt_dir" && ./gradlew nativeCompile --console=plain)
  fi
fi

exec "$binary" \
  --spring.datasource.url="jdbc:postgresql://${db_host}:${db_port}/${db_name}" \
  --spring.datasource.username="${db_username}" \
  --spring.datasource.password="${db_password}" \
  --server.port="${server_port}"
