#!/usr/bin/env bash
# Runs the NestJS backend locally. Requires packages/backend/nestjs/.env to
# exist with a valid DATABASE_URL (copy .env.example if missing -- it is not
# created automatically, unlike the Spring Boot side which takes its
# credentials from the repo-root .env instead).
#
# Usage:
#   _infra/scripts/run-nestjs.sh              # port 3000 (default, from .env), single process
#   _infra/scripts/run-nestjs.sh 3001          # override PORT
#   CLUSTER=1 _infra/scripts/run-nestjs.sh
#     Runs one worker process per CPU core (cluster.ts) instead of a single
#     process. Node's event loop is single-threaded for non-I/O work (JSON
#     serialize, DTO validation, routing, ORM query building) -- under
#     high concurrency that becomes the bottleneck before I/O wait does.
#     Cluster mode fans that work out across cores. Requires a prod build
#     (`pnpm build`) since it runs from dist/, not ts-node.
#   CLUSTER_WORKERS=4 CLUSTER=1 _infra/scripts/run-nestjs.sh
#     Override worker count (default: all available cores).
#   DB_POOL_TOTAL=20 _infra/scripts/run-nestjs.sh
#     Total Postgres connection budget, split evenly across workers in
#     cluster mode (or used as-is for a single process). NOT matched to
#     other backends' pool numbers on purpose -- see prisma.service.ts.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repo_root="$script_dir/../.."
nestjs_dir="$repo_root/packages/backend/nestjs"

if [ ! -f "$nestjs_dir/.env" ]; then
  echo "error: $nestjs_dir/.env not found -- copy .env.example to .env and fill in DATABASE_URL first." >&2
  exit 1
fi

cd "$nestjs_dir"

if [ -n "${1:-}" ]; then
  export PORT="$1"
fi

if [ "${CLUSTER:-0}" = "1" ]; then
  pnpm build
  exec pnpm start:cluster
fi

exec pnpm start
