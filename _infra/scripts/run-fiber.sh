#!/usr/bin/env bash
# Runs the Go Fiber backend locally, reading Postgres credentials from the
# repo-root .env (same pattern as run-springkt-jvm.sh).
#
# Usage:
#   _infra/scripts/run-fiber.sh              # port 8082 (default)
#   _infra/scripts/run-fiber.sh 8083          # custom port
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
server_port="${1:-8082}"

cd "$repo_root/packages/backend/fiber"

exec go run . \
  --db-host="$db_host" \
  --db-port="$db_port" \
  --db-name="$db_name" \
  --db-username="$db_username" \
  --db-password="$db_password" \
  --server-port="$server_port"
