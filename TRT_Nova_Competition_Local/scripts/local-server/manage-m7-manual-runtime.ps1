param([ValidateSet('start', 'status', 'stop')][string]$Action = 'status')
# Historical command alias. The portable manager never starts/stops MySQL.
& (Join-Path $PSScriptRoot 'manage-local-runtime.ps1') -Action $Action
exit $LASTEXITCODE
