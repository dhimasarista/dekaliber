#!/usr/bin/env bash
# Runs the NestJS backend locally. Requires packages/backend/nestjs/.env to
# exist with a valid DATABASE_URL (copy .env.example if missing -- it is not
# created automatically, unlike the Spring Boot side which takes its
# credentials from the repo-root .env instead).
#
# Usage:
#   _infra/scripts/run-nestjs.sh              # port 3000 (default, from .env)
#   _infra/scripts/run-nestjs.sh 3001          # override PORT
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

exec pnpm start
