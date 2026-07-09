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

if [ ! -x "$binary" ] || [ "${FORCE_REBUILD:-0}" = "1" ]; then
  echo "Building native image (this takes ~7-9 minutes)..." >&2
  (cd "$springkt_dir" && ./gradlew nativeCompile --console=plain)
fi

exec "$binary" \
  --spring.datasource.url="jdbc:postgresql://${db_host}:${db_port}/${db_name}" \
  --spring.datasource.username="${db_username}" \
  --spring.datasource.password="${db_password}" \
  --server.port="${server_port}"
