[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$cloudRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$functionNames = @('auth-scf', 'api-scf', 'ingest-scf', 'agent-scf', 'history-cleanup-scf')
$results = @()

foreach ($functionName in $functionNames) {
  $lockDir = Join-Path (Join-Path $cloudRoot 'locks') $functionName
  Push-Location -LiteralPath $lockDir
  try {
    $raw = & npm audit --omit=dev --package-lock-only --json --registry=https://registry.npmjs.org 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($raw | Out-String).Trim()
    if ($exitCode -ne 0) {
      throw "npm audit failed for $functionName with exit code $exitCode`n$text"
    }
    $parsed = $text | ConvertFrom-Json
    $vulnerabilities = $parsed.metadata.vulnerabilities
    $results += [pscustomobject]@{
      function = $functionName
      info = [int]$vulnerabilities.info
      low = [int]$vulnerabilities.low
      moderate = [int]$vulnerabilities.moderate
      high = [int]$vulnerabilities.high
      critical = [int]$vulnerabilities.critical
      total = [int]$vulnerabilities.total
    }
  } finally {
    Pop-Location
  }
}

$results | Format-Table -AutoSize
if (($results | Measure-Object -Property total -Sum).Sum -ne 0) {
  throw 'Dependency audit found known vulnerabilities; review and update locks before cloud release.'
}
Write-Host 'Dependency audit passed: 0 known vulnerabilities across the five current production lockfiles.'
