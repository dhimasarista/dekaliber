# Runs the AnalogJS panel (frontend + generator server routes).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\packages\panel')
pnpm dev
