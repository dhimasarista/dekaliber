# Dot-source this to load key=value pairs from the repo-root .env (gitignored)
# into the current process environment. Used by scripts that need real DB
# credentials without hardcoding them anywhere tracked by git.
$rootEnvPath = Join-Path $PSScriptRoot '..\.env'

if (-not (Test-Path $rootEnvPath)) {
    Write-Warning ".env not found at $rootEnvPath -- copy .env.example to .env and fill in real values first."
    return
}

Get-Content $rootEnvPath | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        Set-Item -Path "Env:$key" -Value $value
    }
}
