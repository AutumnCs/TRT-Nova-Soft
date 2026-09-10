param(
  [ValidateSet('start', 'status', 'stop')][string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serverScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'server.js')).Path
$runtimeRoot = Join-Path $projectRoot '.runtime\local'
$statePath = Join-Path $runtimeRoot 'runtime-state.json'
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw '请先运行 npm run local:setup' }
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envFile -Encoding utf8) {
  if ($line.Trim() -and -not $line.Trim().StartsWith('#') -and $line.Contains('=')) {
    $pair = $line -split '=', 2
    $settings[$pair[0].Trim()] = $pair[1].Trim()
  }
}
$port = [int]$settings['LOCAL_PORT']
if ($port -lt 1024 -or $port -gt 65535) { throw 'LOCAL_PORT 无效' }
function Get-Listener {
  Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Assert-OwnedServer([int]$ProcessId) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $processInfo) { throw '服务进程已退出；检查本目录运行日志' }
  $normalized = ([string]$processInfo.CommandLine).Replace('/', '\')
  $escaped = [regex]::Escape($serverScript)
  if (-not $processInfo -or $processInfo.Name -ne 'node.exe' -or $normalized -notmatch ('(?:^|[\s"])' + $escaped + '(?=["\s]|$)')) {
    throw "端口 $port 属于其他进程；不停止、不覆盖。请换用空闲 LOCAL_PORT。"
  }
  return $processInfo
}
$listener = Get-Listener
if ($Action -eq 'status') {
  if (-not $listener) { Write-Output "STOPPED: http://127.0.0.1:$port"; exit 0 }
  Assert-OwnedServer ([int]$listener.OwningProcess) | Out-Null
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
  Write-Output "READY: http://127.0.0.1:$port; health=$($health.StatusCode); MySQL 由用户单独管理"
  exit 0
}
if ($Action -eq 'stop') {
  if (-not (Test-Path -LiteralPath $statePath)) { Write-Output '没有本管理器启动的进程记录；不停止其他进程'; exit 0 }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.processId)" -ErrorAction SilentlyContinue
  if ($processInfo) {
    Assert-OwnedServer ([int]$state.processId) | Out-Null
    if ($processInfo.CreationDate.ToUniversalTime().Ticks -ne ([DateTimeOffset]$state.createdAt).UtcDateTime.Ticks) { throw '进程编号已复用；拒绝停止' }
    Stop-Process -Id ([int]$state.processId)
  }
  Write-Output 'STOPPED: 仅停止本目录启动的 Node 服务；未停止 MySQL'
  exit 0
}
if ($listener) {
  Assert-OwnedServer ([int]$listener.OwningProcess) | Out-Null
  Write-Output "ALREADY RUNNING: http://127.0.0.1:$port"
  exit 0
}
$nodePath = (Get-Command node).Source
# Read-only schema check through the configured application account.
& $nodePath (Join-Path $projectRoot 'scripts\local-db\initialize.mjs') --verify
if ($LASTEXITCODE -ne 0) { throw '本地数据库未就绪；本管理器不会重建数据库' }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$spawnResult = & $nodePath (Join-Path $projectRoot 'scripts/spawn-local-process.mjs') $nodePath $runtimeRoot (Join-Path $runtimeRoot 'server.stdout.log') (Join-Path $runtimeRoot 'server.stderr.log') $serverScript
if ($LASTEXITCODE -ne 0) { throw '本地服务启动失败；检查本目录运行日志' }
$process = $spawnResult | ConvertFrom-Json
$processInfo = Assert-OwnedServer $process.processId
[ordered]@{ processId=$process.processId; createdAt=$processInfo.CreationDate.ToUniversalTime().ToString('o'); port=$port; serverScript=$serverScript } |
  ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  $listener = Get-Listener
  if ($listener -and [int]$listener.OwningProcess -eq $process.processId) {
    Write-Output "READY: http://127.0.0.1:$port; logs=$runtimeRoot"
    exit 0
  }
  if (-not (Get-Process -Id $process.processId -ErrorAction SilentlyContinue)) { throw "服务启动进程已退出；检查 $runtimeRoot" }
  Start-Sleep -Milliseconds 250
}
throw "启动超时；进程和日志保留在 $runtimeRoot，未操作 MySQL"
