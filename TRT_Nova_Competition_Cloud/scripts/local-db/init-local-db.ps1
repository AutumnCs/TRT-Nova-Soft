param([Parameter(Mandatory = $true)][string]$ConfirmDatabase)
$ErrorActionPreference = 'Stop'
# Compatibility entry only: initialization never drops an existing database.
& node (Join-Path $PSScriptRoot 'initialize.mjs') "--confirm-database=$ConfirmDatabase"
exit $LASTEXITCODE
