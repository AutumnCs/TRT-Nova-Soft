[CmdletBinding()]
param(
  [ValidateSet('start', 'status', 'stop')][string]$Action = 'status',
  [string]$MySqlHome = $env:ZHICHONG_MYSQL_HOME,
  [ValidateRange(1024,65535)][int]$Port = 3308,
  [string]$AliasRoot = $env:NOVA_MYSQL_ALIAS_ROOT
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot ".runtime\isolated-mysql-$Port"))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime'))
if (-not $runtimeRoot.StartsWith($allowedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated runtime path' }
$dataPath = Join-Path $runtimeRoot 'data'
$statePath = Join-Path $runtimeRoot 'process.json'
function Get-MySqlListener {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}
function Assert-Owned([object]$State) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($State.processId)" -ErrorAction SilentlyContinue
  if (-not $processInfo) { return $null }
  if ($processInfo.Name -ne 'mysqld.exe' -or
      $processInfo.CreationDate.ToUniversalTime().Ticks -ne ([DateTimeOffset]$State.createdAt).UtcDateTime.Ticks -or
      $State.dataPath -ne $dataPath -or
      ([string]$processInfo.CommandLine).IndexOf([string]$State.dataAlias, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'Process ownership mismatch; will not touch this process'
  }
  $aliasInfo = Get-Item -LiteralPath $State.dataAlias
  if ($aliasInfo.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]$aliasInfo.Target) -ne $dataPath) { throw 'Data alias ownership mismatch' }
  return $processInfo
}
$state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
if ($Action -eq 'status') {
  if ($state -and (Assert-Owned $state)) { Write-Output "RUNNING: loopback MySQL port=$Port; data=$dataPath" }
  else { Write-Output "STOPPED: isolated MySQL port=$Port" }
  exit 0
}
if ($Action -eq 'stop') {
  if ($state -and (Assert-Owned $state)) {
    $listener = Get-MySqlListener
    if (-not $listener -or [int]$listener.OwningProcess -ne [int]$state.processId) { throw 'Listener ownership mismatch; refusing shutdown' }
    & $state.mysqladmin --no-defaults --host=127.0.0.1 "--port=$Port" --user=root --connect-timeout=5 shutdown
    if ($LASTEXITCODE -ne 0) { throw "Graceful shutdown failed: exit=$LASTEXITCODE; no forced termination" }
    $remaining = Get-Process -Id ([int]$state.processId) -ErrorAction SilentlyContinue
    if ($remaining -and -not $remaining.WaitForExit(15000)) { throw 'Graceful shutdown still in progress; data retained, no forced termination' }
    Write-Output "STOPPED: isolated MySQL port=$Port; data retained at $dataPath"
  } else { Write-Output 'No owned MySQL process to stop' }
  exit 0
}
$listener = Get-MySqlListener
if ($listener) {
  if ($state -and [int]$state.processId -eq [int]$listener.OwningProcess -and (Assert-Owned $state)) { Write-Output "ALREADY RUNNING: port=$Port"; exit 0 }
  throw "Port $Port is in use; will not reuse or stop another MySQL instance"
}
if (-not $MySqlHome) {
  $command = Get-Command mysqld.exe -ErrorAction SilentlyContinue
  if ($command) { $MySqlHome = Split-Path -Parent (Split-Path -Parent $command.Source) }
}
if (-not $MySqlHome) { throw 'Set ZHICHONG_MYSQL_HOME or pass -MySqlHome <MySQL installation directory>' }
$mysqlBase = (Resolve-Path -LiteralPath $MySqlHome).Path
$exe = Join-Path $mysqlBase 'bin\mysqld.exe'
$mysqladmin = Join-Path $mysqlBase 'bin\mysqladmin.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'mysqld.exe not found under MySqlHome/bin' }
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
# MySQL 8.0 Windows may initialize but fail to reopen non-ASCII data paths.
# Data stays in this project; only its runtime entry is a verified ASCII junction.
if (-not $AliasRoot) { $AliasRoot = Join-Path ([IO.Path]::GetTempPath()) 'nova-competition-mysql' }
$AliasRoot = [IO.Path]::GetFullPath($AliasRoot)
if ($AliasRoot -match '[^\x00-\x7F]') { throw 'Pass -AliasRoot <ASCII directory> or set NOVA_MYSQL_ALIAS_ROOT' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $namespace = [Convert]::ToHexString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataPath.ToLowerInvariant()))).Substring(0,16).ToLowerInvariant() }
finally { $sha.Dispose() }
$dataAlias = Join-Path $AliasRoot $namespace
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
New-Item -ItemType Directory -Path $AliasRoot -Force | Out-Null
if (Test-Path -LiteralPath $dataAlias) {
  $aliasInfo = Get-Item -LiteralPath $dataAlias
  if ($aliasInfo.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]$aliasInfo.Target) -ne $dataPath) { throw 'Existing alias has a different target; no overwrite' }
} else { New-Item -ItemType Junction -Path $dataAlias -Target $dataPath | Out-Null }
if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'mysql.ibd'))) {
  if (@(Get-ChildItem -LiteralPath $dataPath -Force).Count -gt 0) { throw 'Incomplete nonempty data directory; no overwrite' }
  & $exe --no-defaults --initialize-insecure "--basedir=$mysqlBase" "--datadir=$dataAlias" --innodb-buffer-pool-size=64M *> (Join-Path $runtimeRoot 'initialize.log')
  if ($LASTEXITCODE -ne 0) { throw "MySQL initialize failed: exit=$LASTEXITCODE; inspect initialize.log; no automatic reset" }
}
if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'mysql.ibd'))) { throw 'Incomplete data directory; inspect instead of overwriting it' }
$arguments = @('--no-defaults','--console', "--basedir=$mysqlBase", "--datadir=$dataAlias",
  "--port=$Port",'--bind-address=127.0.0.1','--innodb-buffer-pool-size=64M','--max-connections=40','--mysqlx=OFF')
$spawnResult = & (Get-Command node).Source (Join-Path $projectRoot 'scripts/spawn-local-process.mjs') $exe $runtimeRoot (Join-Path $runtimeRoot 'mysql.stdout.log') (Join-Path $runtimeRoot 'mysql.stderr.log') @arguments
if ($LASTEXITCODE -ne 0) { throw 'Could not launch isolated MySQL; inspect its runtime logs' }
$process = $spawnResult | ConvertFrom-Json
for ($attempt=0; $attempt -lt 120; $attempt++) {
  $listener = Get-MySqlListener
  if ($listener) {
    # Windows mysqld can hand the listener to a child; record the actual owner.
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if ($processInfo.Name -ne 'mysqld.exe' -or
        ([string]$processInfo.CommandLine).IndexOf($dataAlias, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $listener.LocalAddress -ne '127.0.0.1') { throw 'Unexpected listener; no process stopped' }
    [ordered]@{processId=$processInfo.ProcessId;createdAt=$processInfo.CreationDate.ToUniversalTime().ToString('o');port=$Port;dataPath=$dataPath;dataAlias=$dataAlias;mysqladmin=$mysqladmin} |
      ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    Write-Output "READY: loopback-only isolated MySQL port=$Port; synthetic local tests only; data=$dataPath"
    exit 0
  }
  if (-not (Get-Process -Id $process.processId -ErrorAction SilentlyContinue)) { throw 'MySQL startup process exited; inspect mysql.stderr.log; no automatic reset' }
  Start-Sleep -Milliseconds 250
}
throw 'MySQL startup timeout; process and logs retained for diagnosis'
