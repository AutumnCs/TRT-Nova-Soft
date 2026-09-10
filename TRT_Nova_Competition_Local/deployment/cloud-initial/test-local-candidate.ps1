[CmdletBinding()]
param([string]$NodeExecutable = 'node', [switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$candidateRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$repo = (Resolve-Path -LiteralPath (Join-Path $candidateRoot '../..')).Path
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$evidenceDir = Join-Path $candidateRoot "state/verification/$runId"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-Check {
  param([string]$Name, [string]$Program, [string[]]$Arguments, [int]$ExpectedExit = 0)
  $log = Join-Path $evidenceDir "$Name.log"
  & $Program @Arguments *> $log
  $code = $LASTEXITCODE
  $results.Add([pscustomobject]@{ name = $Name; exitCode = $code; expectedExitCode = $ExpectedExit; log = $log })
  Write-Output "$Name : exit=$code (expected=$ExpectedExit); $log"
  if ($code -ne $ExpectedExit) { throw "$Name failed; inspect $log" }
}

Push-Location -LiteralPath $repo
try {
  Invoke-Check 'node-version' $NodeExecutable @('--version')
  if (-not $SkipBuild) {
    # The build uses the caller's npm but tests below run the explicitly chosen Node.
    Invoke-Check 'build-and-zip' 'pwsh' @('-NoProfile', '-File', 'deployment/cloud-initial/build-cloud-candidate.ps1')
  }
  Invoke-Check 'source-parity' $NodeExecutable @('deployment/cloud-initial/tools/check-current-source.mjs')
  Invoke-Check 'build-preflight' $NodeExecutable @('deployment/cloud-initial/tools/preflight.mjs')
  Invoke-Check 'frontend-config' $NodeExecutable @('deployment/cloud-initial/tools/render-config.mjs', '--config', 'deployment/cloud-initial/candidate.config.example.json', '--allow-placeholders', '--out', (Join-Path $evidenceDir 'candidate.rendered.local.json'))
  Invoke-Check 'frontend-snapshot' $NodeExecutable @('deployment/cloud-initial/tools/snapshot-client.mjs', '--config', 'deployment/cloud-initial/candidate.config.example.json', '--allow-placeholders', '--out', (Join-Path $evidenceDir 'miniprogram'))
  $productTestFiles = @()
  foreach ($testRoot in @('dist/scf/api-scf/test', 'dist/scf/agent-scf/test', 'custom-tab-bar', 'pages', 'services', 'scripts', 'admin-web/test')) {
    $productTestFiles += @(Get-ChildItem -LiteralPath $testRoot -File -Recurse | Where-Object Name -Match '\.test\.(js|mjs)$' |
      ForEach-Object { [System.IO.Path]::GetRelativePath($repo, $_.FullName) })
  }
  Invoke-Check 'product-regression' $NodeExecutable (@('--test') + $productTestFiles)
  $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $candidateRoot 'test') -Filter '*.test.mjs' | ForEach-Object FullName)
  Invoke-Check 'cloud-unit-and-sdk' $NodeExecutable (@('--test') + $testFiles)
  Invoke-Check 'real-local-database' $NodeExecutable @('deployment/cloud-initial/test/local-cloud-rehearsal.mjs')
  Invoke-Check 'package-policy' 'pwsh' @('-NoProfile', '-File', 'deployment/cloud-initial/verify-cloud-candidate-artifacts.ps1')
  Invoke-Check 'release-must-block' $NodeExecutable @('deployment/cloud-initial/tools/preflight.mjs', '--release', '--config', 'deployment/cloud-initial/candidate.config.example.json') 1
  Invoke-Check 'dependency-audit' 'pwsh' @('-NoProfile', '-File', 'deployment/cloud-initial/audit-dependencies.ps1')
  Invoke-Check 'project-context' $NodeExecutable @('scripts/check-ai-context.mjs')
  $summary = [pscustomobject]@{ status = 'PASS'; createdAt = (Get-Date).ToString('o');
    evidence = 'LOCAL_CLOUD_CANDIDATE_REHEARSAL'; deployed = $false; actualCloudAcceptance = $false;
    physicalDeviceTested = $false; steps = $results }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir 'result.json') -Encoding utf8
  Write-Output "PASS: local candidate only. Evidence: $evidenceDir"
} catch {
  [pscustomobject]@{ status = 'FAIL'; reason = $_.Exception.Message; steps = $results } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir 'result.json') -Encoding utf8
  Write-Error $_
  exit 1
} finally { Pop-Location }
