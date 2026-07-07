# Runs the NestJS backend locally (no Docker). Requires Postgres reachable
# per packages/backend/nestjs/.env (DATABASE_URL).
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'load-root-env.ps1')

$env:PORT = if ($env:nestjs_port) { $env:nestjs_port } else { '3000' }

Set-Location (Join-Path $PSScriptRoot '..\packages\backend\nestjs')
pnpm start:dev
