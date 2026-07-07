# Runs the Spring Boot Kotlin backend locally (no Docker). Loads Postgres
# credentials from the repo-root .env and passes them as Spring Boot
# command-line args (--spring.datasource.*), not env vars.
#
# Why not env vars: DB_* environment variables set in this script were not
# reliably reaching the forked JVM through the Gradle daemon (bootRun kept
# failing with "password authentication failed" even though the value was
# verified correct right before invoking gradlew). Passing them as --args
# to the Spring Boot app itself sidesteps that entirely -- Spring parses
# them directly as the highest-priority property source.
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'load-root-env.ps1')

$dbHost = if ($env:db_host) { $env:db_host } else { 'localhost' }
$dbPort = if ($env:db_port) { $env:db_port } else { '5432' }
$dbName = if ($env:db_name) { $env:db_name } else { 'dekaliber' }
$dbUsername = if ($env:db_username) { $env:db_username } else { 'postgres' }
$dbPassword = $env:db_password
$serverPort = if ($env:springkt_port) { $env:springkt_port } else { '8080' }

$datasourceArgs = "--spring.datasource.url=jdbc:postgresql://${dbHost}:${dbPort}/${dbName} --spring.datasource.username=$dbUsername --spring.datasource.password=$dbPassword --server.port=$serverPort"

Set-Location (Join-Path $PSScriptRoot '..\packages\backend\springkt')

# --rerun-tasks: Gradle can wrongly mark `bootRun` UP-TO-DATE after a killed
# daemon/prior run, which skips actually starting the server. Always force it.
& ./gradlew.bat bootRun --rerun-tasks --args="$datasourceArgs"
