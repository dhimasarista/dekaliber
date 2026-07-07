# Starts NestJS, Spring Boot Kotlin, and the AnalogJS panel each in their own
# window, so logs stay separate and any one of them can be Ctrl+C'd on its own.
# Requires Postgres reachable locally beforehand (see README / .env).
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'load-root-env.ps1')
$nestjsPort = if ($env:nestjs_port) { $env:nestjs_port } else { '3000' }
$springktPort = if ($env:springkt_port) { $env:springkt_port } else { '8080' }

$scripts = @('dev-nestjs.ps1', 'dev-springkt.ps1', 'dev-panel.ps1')

foreach ($script in $scripts) {
    $path = Join-Path $PSScriptRoot $script
    Start-Process pwsh -ArgumentList '-NoExit', '-File', $path
}

Write-Host "Started NestJS (:$nestjsPort), Spring Boot Kotlin (:$springktPort), and the panel (:5173) in separate windows."
Write-Host "Close each window (or Ctrl+C inside it) to stop that service."
