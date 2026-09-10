$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$serverScript = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'scripts\local-server\server.js')).Path
$nodePath = (Get-Command node).Source
$npmPath = (Get-Command npm.cmd).Source
$isolatedOpenid = 'm7_devtools_' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$originalListener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$hadOriginalServer = $false
$isolatedServer = $null
$runExitCode = 1
$environmentBackup = @{}

function Set-IsolatedEnvironmentValue([string]$Name, [string]$Value) {
  if (-not $environmentBackup.ContainsKey($Name)) {
    $environmentBackup[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-IsolatedEnvironment {
  foreach ($entry in $environmentBackup.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
}

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Set-MiniprogramAutomatorPath {
  $expectedVersion = '0.12.1'
  $explicitRoot = [Environment]::GetEnvironmentVariable('MINIPROGRAM_AUTOMATOR_PATH', 'Process')
  $wechatCli = if ($env:WECHAT_DEVTOOLS_CLI) { $env:WECHAT_DEVTOOLS_CLI } else { 'D:\D\微信web开发者工具\cli.bat' }
  $wechatRoot = Split-Path -Parent $wechatCli
  $installPrefix = Join-Path ([System.IO.Path]::GetTempPath()) 'zhichong-miniprogram-automator'
  $temporaryRoot = Join-Path $installPrefix 'node_modules\miniprogram-automator'
  $candidates = if ($explicitRoot) {
    @([System.IO.Path]::GetFullPath($explicitRoot))
  } else {
    @(
      (Join-Path $projectRoot 'node_modules\miniprogram-automator'),
      (Join-Path $wechatRoot 'node_modules\miniprogram-automator'),
      (Join-Path $wechatRoot 'package.nw\node_modules\miniprogram-automator'),
      (Join-Path $wechatRoot 'code\package.nw\node_modules\miniprogram-automator'),
      $temporaryRoot
    )
  }
  $resolvedRoot = ''
  foreach ($candidate in $candidates) {
    $manifest = Join-Path $candidate 'package.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
    $version = [string]((Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version)
    if ($explicitRoot -or $version -eq $expectedVersion) {
      $resolvedRoot = $candidate
      break
    }
  }
  if (-not $resolvedRoot -and -not $explicitRoot) {
    New-Item -ItemType Directory -Path $installPrefix -Force | Out-Null
    & $npmPath install --prefix $installPrefix --no-audit --no-fund --no-save "miniprogram-automator@$expectedVersion"
    if ($LASTEXITCODE -ne 0) { throw "miniprogram-automator@$expectedVersion 安装失败，退出码 $LASTEXITCODE" }
    $resolvedRoot = $temporaryRoot
  }
  if (-not $resolvedRoot) { throw 'MINIPROGRAM_AUTOMATOR_PATH 指向的依赖不存在' }
  $resolvedManifest = Join-Path $resolvedRoot 'package.json'
  if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    throw "缺少 miniprogram-automator 清单：$resolvedManifest"
  }
  $resolvedVersion = [string]((Get-Content -LiteralPath $resolvedManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  if (-not $explicitRoot -and $resolvedVersion -ne $expectedVersion) {
    throw "miniprogram-automator 版本不匹配：期望 $expectedVersion，实际 $resolvedVersion"
  }
  Set-IsolatedEnvironmentValue -Name 'MINIPROGRAM_AUTOMATOR_PATH' -Value $resolvedRoot
  Write-Output "[PASS] miniprogram-automator $resolvedVersion ($resolvedRoot)"
}

function Assert-LocalServerProcess([int]$ProcessId) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  # 与日常启动器使用同一完整路径；只看相对文件名既会误拒，也可能误认其他项目。
  $commandLine = if ($processInfo) { ([string]$processInfo.CommandLine).Replace('\', '/') } else { '' }
  $expectedPath = [regex]::Escape($serverScript.Replace('\', '/'))
  $scriptArgument = '(?i)(?:^|\s)(?:"' + $expectedPath + '"|' + $expectedPath + ')(?=\s|$)'
  if (-not $processInfo -or $processInfo.Name -ne 'node.exe' -or $commandLine -notmatch $scriptArgument) {
    throw "127.0.0.1:3000 的进程 $ProcessId 不是预期的植宠本地服务器"
  }
  return $processInfo
}

function Wait-LocalServer([int]$ExpectedPid) {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and $listener.OwningProcess -eq $ExpectedPid) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "植宠本地服务器 $ExpectedPid 未在 127.0.0.1:3000 就绪"
}

if ($originalListener) {
  Assert-LocalServerProcess -ProcessId $originalListener.OwningProcess | Out-Null
  $hadOriginalServer = $true
  Stop-Process -Id $originalListener.OwningProcess
  Start-Sleep -Milliseconds 500
}

try {
  Set-MiniprogramAutomatorPath
  Set-IsolatedEnvironmentValue -Name 'LOCAL_DEV_AUTH_ENABLED' -Value 'true'
  Set-IsolatedEnvironmentValue -Name 'LOCAL_DEV_OPENID' -Value $isolatedOpenid
  Set-IsolatedEnvironmentValue -Name 'M7_EXPECTED_OPENID' -Value $isolatedOpenid
  # 本轮验收强制 100% 进入受控运行时；只作用于隔离子进程，不改 .env.local/云端默认。
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_ENABLED' -Value 'true'
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_SAMPLE_RATE' -Value '1'
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_COHORT_KEY' -Value "m7-devtools-local-$isolatedOpenid"
  Set-IsolatedEnvironmentValue -Name 'AGENT_SHADOW_ENABLED' -Value 'false'
  Set-IsolatedEnvironmentValue -Name 'WECHAT_AUTOMATION_PORT' -Value ([string](Get-FreeLoopbackPort))
  $isolatedServer = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  Wait-LocalServer -ExpectedPid $isolatedServer.Id

  & $nodePath 'scripts/local-server/m7-devtools-e2e.js'
  $runExitCode = $LASTEXITCODE
} finally {
  if ($isolatedServer -and -not $isolatedServer.HasExited) {
    Assert-LocalServerProcess -ProcessId $isolatedServer.Id | Out-Null
    Stop-Process -Id $isolatedServer.Id
    Start-Sleep -Milliseconds 500
  }

  Restore-IsolatedEnvironment

  if ($hadOriginalServer) {
    $restored = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    Wait-LocalServer -ExpectedPid $restored.Id
    Write-Output "[RESTORED] 默认本地服务器 PID $($restored.Id)"
  }
}

exit $runExitCode
