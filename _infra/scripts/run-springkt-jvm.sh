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

cd "$repo_root/packages/backend/springkt"

exec ./gradlew bootRun --console=plain --args="\
--spring.datasource.url=jdbc:postgresql://${db_host}:${db_port}/${db_name} \
--spring.datasource.username=${db_username} \
--spring.datasource.password=${db_password} \
--server.port=${server_port}"
