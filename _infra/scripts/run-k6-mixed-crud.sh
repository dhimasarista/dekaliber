#!/usr/bin/env bash
# Runs the mixed_crud k6 load test against a running backend. The target
# must already be up (use run-springkt-jvm.sh / run-springkt-native.sh /
# run-fiber.sh / `pnpm start` in packages/backend/nestjs first).
#
# Usage:
#   _infra/scripts/run-k6-mixed-crud.sh 8080              # Spring Boot JVM
#   _infra/scripts/run-k6-mixed-crud.sh 8081               # Spring Boot native
#   _infra/scripts/run-k6-mixed-crud.sh 8082               # Fiber
#   _infra/scripts/run-k6-mixed-crud.sh 3000               # NestJS
#   VUS=20 DURATION=2m _infra/scripts/run-k6-mixed-crud.sh 8080
#   RAW_SQL=true _infra/scripts/run-k6-mixed-crud.sh 8080
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
repo_root="$script_dir/../.."

port="${1:?Usage: run-k6-mixed-crud.sh <port> (8080=springkt-jvm, 8081=springkt-native, 8082=fiber, 3000=nestjs)}"

BASE_URL="http://localhost:${port}" \
  VUS="${VUS:-10}" \
  DURATION="${DURATION:-1m}" \
  WARMUP="${WARMUP:-10s}" \
  RAW_SQL="${RAW_SQL:-false}" \
  exec k6 run "$repo_root/_infra/k6/mixed-crud.js"
