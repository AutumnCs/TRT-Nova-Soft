[CmdletBinding()]
param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$cloudRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$preflight = Join-Path $cloudRoot 'tools/preflight.mjs'
$builder = Join-Path $cloudRoot 'tools/build.mjs'
$artifactVerifier = Join-Path $cloudRoot 'verify-cloud-candidate-artifacts.ps1'
$buildRoot = Join-Path $cloudRoot 'build'
$artifactsRoot = Join-Path $cloudRoot 'artifacts'

& node $preflight
if ($LASTEXITCODE -ne 0) {
  throw "Cloud candidate build preflight failed with exit code $LASTEXITCODE"
}

$buildArguments = @($builder)
if ($SkipInstall) {
  $buildArguments += '--skip-install'
}
& node @buildArguments
if ($LASTEXITCODE -ne 0) {
  throw "Cloud candidate staging build failed with exit code $LASTEXITCODE"
}

if ($SkipInstall) {
  Write-Host "Inspection-only staging built at: $buildRoot"
  Write-Host 'No ZIP was created because production dependencies were intentionally skipped.'
  return
}

New-Item -ItemType Directory -Force -Path $artifactsRoot | Out-Null
$functionNames = @('auth-scf', 'api-scf', 'ingest-scf', 'agent-scf', 'history-cleanup-scf')
foreach ($functionName in $functionNames) {
  $stagingDir = Join-Path $buildRoot $functionName
  $zipPath = Join-Path $artifactsRoot "$functionName.zip"
  if (-not (Test-Path -LiteralPath (Join-Path $stagingDir 'index.js') -PathType Leaf)) {
    throw "Missing index.js in staging: $stagingDir"
  }
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -LiteralPath (Get-ChildItem -Force -LiteralPath $stagingDir).FullName -DestinationPath $zipPath -CompressionLevel Optimal

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($requiredEntry in @('index.js', 'cloud-runtime.js', 'package.json', 'package-lock.json', 'NOVA_PACKAGE_MANIFEST.json')) {
      if ($entryNames -notcontains $requiredEntry) {
        throw "$functionName ZIP root is invalid; missing $requiredEntry"
      }
    }
  } finally {
    $archive.Dispose()
  }
}

& $artifactVerifier
if ($LASTEXITCODE -ne 0) {
  throw "Cloud candidate ZIP policy verification failed with exit code $LASTEXITCODE"
}

& node $builder --finalize
if ($LASTEXITCODE -ne 0) {
  throw "Cloud candidate artifact finalization failed with exit code $LASTEXITCODE"
}

Write-Host "Cloud staging candidate artifacts built at: $artifactsRoot"
Write-Host 'Claim boundary: artifacts were built locally; no Tencent Cloud resource was created or tested.'
