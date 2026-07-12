#!/usr/bin/env bash
# Truncates every backend's test table and vacuums the database. Run this
# BEFORE any load-test comparison run -- k6 mixed-crud.js's `create` op
# (30% weight) inserts rows continuously with no cleanup, so table size
# (and thus read_heavy/index cost) grows monotonically across every run
# you don't reset.
#
# CONFIRMED IMPACT (2026-07-12): forgetting this made Spring Boot JVM look
# 2.4x slower than it actually is -- 593-1012 rps on a table that had
# accumulated 262k rows (50MB, 27.8k dead tuples, last autovacuum ~30min
# stale) vs. 2388.8 rps on the same code/config immediately after this
# script. p95 latency dropped from 800ms-1.34s to 384ms. This wasn't a
# JVM/HikariCP/pool-size effect at all -- every backend sharing this
# Postgres instance is equally exposed to the same table-bloat problem,
# so a stale table silently biases every stack's numbers downward by
# whatever amount of test data happened to accumulate before that run.
#
# Usage: _infra/scripts/reset-test-data.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repo_root="$script_dir/../.."

# shellcheck disable=SC1091
source "$script_dir/load-root-env.sh"

db_host="${DB_HOST:-localhost}"
db_port="${DB_PORT:-5432}"
db_name="${DB_NAME:-dekaliber}"
db_username="${DB_USERNAME:-mac}"

# One table per backend, all in the same Postgres instance -- see
# _docs/springkt-run-modes.md and _docs/fiber-backend.md for why they're
# separate tables rather than shared.
tables=("resource" "\"Resource\"" "resource_fiber")

for t in "${tables[@]}"; do
  echo "Truncating $t..." >&2
  psql -h "$db_host" -p "$db_port" -U "$db_username" -d "$db_name" -c "TRUNCATE TABLE $t;"
  psql -h "$db_host" -p "$db_port" -U "$db_username" -d "$db_name" -c "VACUUM ANALYZE $t;"
done

echo "Done. All test tables truncated and vacuumed." >&2
