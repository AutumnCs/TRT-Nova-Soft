param(
  [switch]$SkipDevTools,
  [switch]$SkipSchemaApply,
  [string]$EvidenceDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$serverScript = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'scripts\local-server\server.js')).Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot '..')).Path
$nodePath = (Get-Command node).Source
$npmPath = (Get-Command npm.cmd).Source
$gitPath = (Get-Command git).Source
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceRoot = if ($EvidenceDirectory) {
  [System.IO.Path]::GetFullPath($EvidenceDirectory)
} else {
  [System.IO.Path]::GetFullPath("D:\植宠项目\验收记录\M7_2026-09-03\full-acceptance-$timestamp")
}
$isolatedOpenid = 'm7_devtools_full_' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$steps = [System.Collections.Generic.List[object]]::new()
$environmentBackup = @{}
$isolatedServer = $null
$startedMySql = $null
$originalListener = $null
$hadOriginalServer = $false
$finalExitCode = 1
$finalStatus = 'FAIL'
$automationPort = 0

New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null

function Add-StepResult {
  param(
    [string]$Name,
    [string]$Status,
    [int]$ExitCode,
    [string]$LogPath,
    [double]$ElapsedSeconds,
    [string]$EvidenceLevel = 'local'
  )
  $steps.Add([pscustomobject]@{
    name = $Name
    status = $Status
    exitCode = $ExitCode
    elapsedSeconds = [Math]::Round($ElapsedSeconds, 3)
    logPath = $LogPath
    evidenceLevel = $EvidenceLevel
  }) | Out-Null
}

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = $projectRoot,
    [string]$EvidenceLevel = 'local-static'
  )
  $safeName = $Name -replace '[^A-Za-z0-9_-]', '-'
  $logPath = Join-Path $evidenceRoot "$safeName.log"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Output "[START] $Name"
  Push-Location $WorkingDirectory
  try {
    $output = & $FilePath @ArgumentList 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    $output | Tee-Object -FilePath $logPath
  } catch {
    $_ | Out-String | Tee-Object -FilePath $logPath
    $exitCode = 1
  } finally {
    Pop-Location
    $watch.Stop()
  }
  if (-not (Test-Path -LiteralPath $logPath)) {
    '[command completed without stdout/stderr]' | Set-Content -LiteralPath $logPath -Encoding UTF8
  }
  "[exitCode=$exitCode]" | Add-Content -LiteralPath $logPath -Encoding UTF8
  $status = if ($exitCode -eq 0) { 'PASS' } else { 'FAIL' }
  Add-StepResult -Name $Name -Status $status -ExitCode $exitCode -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel $EvidenceLevel
  Write-Output "[$status] $Name (exit=$exitCode, log=$logPath)"
  if ($exitCode -ne 0) { throw "$Name 失败，真实退出码 $exitCode" }
}

function Ensure-MiniprogramAutomator {
  $expectedVersion = '0.12.1'
  $explicitRoot = [Environment]::GetEnvironmentVariable('MINIPROGRAM_AUTOMATOR_PATH', 'Process')
  $installPrefix = Join-Path ([System.IO.Path]::GetTempPath()) 'zhichong-miniprogram-automator'
  $temporaryRoot = Join-Path $installPrefix 'node_modules\miniprogram-automator'
  $wechatCli = if ($env:WECHAT_DEVTOOLS_CLI) { $env:WECHAT_DEVTOOLS_CLI } else { 'D:\D\微信web开发者工具\cli.bat' }
  $wechatRoot = Split-Path -Parent $wechatCli
  $checkedRoots = @(
    (Join-Path $projectRoot 'node_modules\miniprogram-automator'),
    (Join-Path $wechatRoot 'node_modules\miniprogram-automator'),
    (Join-Path $wechatRoot 'package.nw\node_modules\miniprogram-automator'),
    (Join-Path $wechatRoot 'code\package.nw\node_modules\miniprogram-automator'),
    $temporaryRoot
  )
  $automatorRoot = ''
  $source = ''
  if ($explicitRoot) {
    $automatorRoot = [System.IO.Path]::GetFullPath($explicitRoot)
    $source = 'explicit-environment'
  } else {
    foreach ($candidateRoot in $checkedRoots) {
      $candidateManifest = Join-Path $candidateRoot 'package.json'
      if (-not (Test-Path -LiteralPath $candidateManifest -PathType Leaf)) { continue }
      $candidateVersion = [string]((Get-Content -LiteralPath $candidateManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version)
      if ($candidateVersion -eq $expectedVersion) {
        $automatorRoot = $candidateRoot
        $source = if ($candidateRoot -eq $temporaryRoot) { 'pinned-temporary-install' } else { 'existing-compatible-install' }
        break
      }
    }
    if (-not $automatorRoot) {
      $automatorRoot = $temporaryRoot
      $source = 'pinned-temporary-install'
    }
  }
  $manifestPath = Join-Path $automatorRoot 'package.json'
  $installedVersion = ''
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $installedVersion = [string]((Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  }
  if (-not $explicitRoot -and $automatorRoot -eq $temporaryRoot -and $installedVersion -ne $expectedVersion) {
    New-Item -ItemType Directory -Path $installPrefix -Force | Out-Null
    Invoke-NativeStep -Name 'install-miniprogram-automator' -FilePath $npmPath -ArgumentList @(
      'install', '--prefix', $installPrefix, '--no-audit', '--no-fund', '--no-save',
      "miniprogram-automator@$expectedVersion"
    ) -EvidenceLevel 'local-test-tool-bootstrap'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
      throw "miniprogram-automator 安装命令成功但缺少清单：$manifestPath"
    }
    $installedVersion = [string]((Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  }
  if (-not $installedVersion) {
    throw "缺少 miniprogram-automator：$automatorRoot；显式路径不会被脚本覆盖"
  }
  if (-not $explicitRoot -and $installedVersion -ne $expectedVersion) {
    throw "miniprogram-automator 版本不匹配：期望 $expectedVersion，实际 $installedVersion"
  }
  Set-IsolatedEnvironmentValue -Name 'MINIPROGRAM_AUTOMATOR_PATH' -Value $automatorRoot
  $logPath = Join-Path $evidenceRoot 'devtools-dependency.log'
  @(
    "root=$automatorRoot",
    "version=$installedVersion",
    "source=$source",
    "checkedRoots=$($checkedRoots -join ';')",
    'workspaceDependencyChanged=false'
  ) | Set-Content -LiteralPath $logPath -Encoding UTF8
  Add-StepResult -Name 'devtools-dependency' -Status 'PASS' -ExitCode 0 -LogPath $logPath -ElapsedSeconds 0 -EvidenceLevel 'local-test-tool'
  Write-Host "[PASS] devtools-dependency (version=$installedVersion, root=$automatorRoot)"
}

function Read-LocalEnvironment {
  $envPath = Join-Path $projectRoot '.env.local'
  if (-not (Test-Path -LiteralPath $envPath)) { throw "缺少本地配置：$envPath" }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -le 0) { continue }
    $values[$trimmed.Substring(0, $separator).Trim()] = $trimmed.Substring($separator + 1).Trim()
  }
  return $values
}

function Resolve-MySqlExecutable {
  $homePath = if ($env:ZHICHONG_MYSQL_HOME) { $env:ZHICHONG_MYSQL_HOME } else { 'D:\zhichong-mysql\mysql-8.0.29-winx64' }
  $candidate = Join-Path $homePath 'bin\mysql.exe'
  if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  $command = Get-Command mysql.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw '未找到 MySQL 客户端；请设置 ZHICHONG_MYSQL_HOME 或把 mysql.exe 加入 PATH'
}

function Resolve-MySqlServerExecutable {
  $homePath = if ($env:ZHICHONG_MYSQL_HOME) { $env:ZHICHONG_MYSQL_HOME } else { 'D:\zhichong-mysql\mysql-8.0.29-winx64' }
  $candidate = Join-Path $homePath 'bin\mysqld.exe'
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "未找到本地 MySQL 服务端：$candidate；请设置 ZHICHONG_MYSQL_HOME"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Assert-LocalMySqlProcess {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable
  )
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if (-not $processInfo -or $processInfo.Name -ne 'mysqld.exe') {
    throw "127.0.0.1:3306 的进程 $ProcessId 不是 MySQL 服务端"
  }
  $actualExecutable = if ($processInfo.ExecutablePath) {
    [System.IO.Path]::GetFullPath($processInfo.ExecutablePath)
  } else {
    ''
  }
  if (-not $actualExecutable -or -not $actualExecutable.Equals($ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "127.0.0.1:3306 的 mysqld.exe 不属于终局验收指定安装目录：$actualExecutable"
  }
  return $processInfo
}

function Wait-LocalMySql {
  param(
    [Parameter(Mandatory = $true)][int]$LauncherPid,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable
  )
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    $listener = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') } |
      Select-Object -First 1
    if ($listener) {
      Assert-LocalMySqlProcess -ProcessId $listener.OwningProcess -ExpectedExecutable $ExpectedExecutable | Out-Null
      return [int]$listener.OwningProcess
    }
    Start-Sleep -Milliseconds 250
  }
  throw "本地 MySQL 启动进程 $LauncherPid 未在 30 秒内产生 127.0.0.1:3306 监听进程"
}

function Start-M7LocalMySqlIfNeeded {
  $mysqlServerExe = Resolve-MySqlServerExecutable
  $listener = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') } |
    Select-Object -First 1
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $logPath = Join-Path $evidenceRoot 'mysql-runtime.log'
  if ($listener) {
    $processInfo = Assert-LocalMySqlProcess -ProcessId $listener.OwningProcess -ExpectedExecutable $mysqlServerExe
    @(
      'mode=existing',
      "pid=$($listener.OwningProcess)",
      "executable=$($processInfo.ExecutablePath)",
      'ownership=external-process-preserved'
    ) | Set-Content -LiteralPath $logPath -Encoding UTF8
    $watch.Stop()
    Add-StepResult -Name 'mysql-runtime' -Status 'PASS' -ExitCode 0 -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel 'local-mysql'
    Write-Host "[PASS] mysql-runtime (existing pid=$($listener.OwningProcess), preserved)"
    return $null
  }

  $mysqlHome = Split-Path -Parent (Split-Path -Parent $mysqlServerExe)
  $mysqlContainer = Split-Path -Parent $mysqlHome
  $dataDirectory = Join-Path $mysqlContainer 'data'
  if (-not (Test-Path -LiteralPath $dataDirectory -PathType Container)) {
    throw "缺少已经初始化的本地 MySQL 数据目录：$dataDirectory"
  }
  $standardOutput = Join-Path $evidenceRoot 'mysql.stdout.log'
  $standardError = Join-Path $evidenceRoot 'mysql.stderr.log'
  $knownServerPids = @(Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath)).Equals($mysqlServerExe, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { [int]$_.ProcessId })
  $arguments = @(
    '--console',
    "--basedir=$mysqlHome",
    "--datadir=$dataDirectory",
    '--port=3306',
    '--bind-address=127.0.0.1'
  )
  $launcher = Start-Process -FilePath $mysqlServerExe -ArgumentList $arguments -WorkingDirectory $mysqlHome -WindowStyle Hidden -RedirectStandardOutput $standardOutput -RedirectStandardError $standardError -PassThru
  try {
    $serverPid = Wait-LocalMySql -LauncherPid $launcher.Id -ExpectedExecutable $mysqlServerExe
    $server = Get-Process -Id $serverPid
  } catch {
    @(
      'mode=harness-started',
      "launcherPid=$($launcher.Id)",
      "executable=$mysqlServerExe",
      "failure=$($_.Exception.Message)"
    ) | Set-Content -LiteralPath $logPath -Encoding UTF8
    $watch.Stop()
    Add-StepResult -Name 'mysql-runtime' -Status 'FAIL' -ExitCode 1 -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel 'local-mysql'
    Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath -and
        ([System.IO.Path]::GetFullPath($_.ExecutablePath)).Equals($mysqlServerExe, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([int]$_.ProcessId -notin $knownServerPids)
      } |
      ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue }
    throw
  }
  @(
    'mode=harness-started',
    "pid=$($server.Id)",
    "launcherPid=$($launcher.Id)",
    "executable=$mysqlServerExe",
    "dataDirectory=$dataDirectory",
    'ownership=harness-process-stop-on-exit'
  ) | Set-Content -LiteralPath $logPath -Encoding UTF8
  $watch.Stop()
  Add-StepResult -Name 'mysql-runtime' -Status 'PASS' -ExitCode 0 -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel 'local-mysql'
  Write-Host "[PASS] mysql-runtime (harness-started pid=$($server.Id))"
  return $server
}

function Invoke-M7SchemaPreflight {
  $localEnvironment = Read-LocalEnvironment
  $mysqlExe = Resolve-MySqlExecutable
  $databaseName = $localEnvironment['DB_NAME']
  if ($databaseName -ne 'zhichong_v01_local') {
    throw "终局本地验收只允许专用数据库 zhichong_v01_local，当前为 $databaseName"
  }
  $mysqlConnectionArguments = @(
    '-h', ($localEnvironment['DB_HOST'] ?? '127.0.0.1'),
    '-P', ($localEnvironment['DB_PORT'] ?? '3306'),
    '-u', ($localEnvironment['DB_USER'] ?? 'zhichong'),
    '--default-character-set=utf8mb4'
  )
  $oldPassword = [Environment]::GetEnvironmentVariable('MYSQL_PWD', 'Process')
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $logPath = Join-Path $evidenceRoot 'database-schema.log'
  try {
    [Environment]::SetEnvironmentVariable('MYSQL_PWD', $localEnvironment['DB_PASSWORD'], 'Process')
    if (-not $SkipSchemaApply) {
      $schemaPath = Join-Path $projectRoot 'reference\agent_runtime.m7.sql'
      if (-not (Test-Path -LiteralPath $schemaPath)) { throw "缺少 M7 schema：$schemaPath" }
      Get-Content -LiteralPath $schemaPath -Raw -Encoding UTF8 |
        & $mysqlExe @mysqlConnectionArguments $databaseName 2>&1 | Tee-Object -FilePath $logPath
      if ($LASTEXITCODE -ne 0) { throw "M7 非破坏性 schema 应用失败，真实退出码 $LASTEXITCODE" }
      & $nodePath (Join-Path $projectRoot 'scripts\local-server\migrate-conversation-context.js') 2>&1 | Tee-Object -FilePath $logPath -Append
      if ($LASTEXITCODE -ne 0) { throw "上下文记忆增量迁移失败，真实退出码 $LASTEXITCODE" }
    }
    $tableQuery = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$databaseName' AND table_name IN ('ai_conversation_events','ai_action_proposals','care_task_creation_keys','ai_message_media_links','ai_session_context','ai_context_memory');"
    $tableCountOutput = & $mysqlExe @mysqlConnectionArguments -N -B $databaseName -e $tableQuery 2>&1
    $queryExitCode = [int]$LASTEXITCODE
    $tableCountOutput | Tee-Object -FilePath $logPath -Append
    $tableCount = [int](($tableCountOutput | Select-Object -Last 1).ToString().Trim())
    if ($queryExitCode -ne 0 -or $tableCount -ne 6) {
      throw "M7 schema 预检失败：需要 6 张运行时/上下文表，实际 $tableCount"
    }
    $watch.Stop()
    Add-StepResult -Name 'database-schema' -Status 'PASS' -ExitCode 0 -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel 'local-mysql'
    Write-Output "[PASS] database-schema (6/6, log=$logPath)"
  } catch {
    $watch.Stop()
    $_ | Out-String | Tee-Object -FilePath $logPath -Append
    Add-StepResult -Name 'database-schema' -Status 'FAIL' -ExitCode 1 -LogPath $logPath -ElapsedSeconds $watch.Elapsed.TotalSeconds -EvidenceLevel 'local-mysql'
    throw
  } finally {
    [Environment]::SetEnvironmentVariable('MYSQL_PWD', $oldPassword, 'Process')
  }
}

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
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and $listener.OwningProcess -eq $ExpectedPid) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "植宠本地服务器 $ExpectedPid 未在 127.0.0.1:3000 就绪"
}

function Write-FinalSummary {
  param([string]$Status, [int]$ExitCode, [string]$Failure = '')
  $unitTestCount = $null
  $productContractTestCount = $null
  $legacyBaselineCaseCount = $null
  $apiAssertionCount = $null
  $devToolsAssertionCount = $null
  $screenshotIndex = @()
  $unitLogPath = Join-Path $evidenceRoot 'unit-tests.log'
  $productContractLogPath = Join-Path $evidenceRoot 'product-contract.log'
  $legacyBaselineLogPath = Join-Path $evidenceRoot 'legacy-baseline.log'
  $apiResultPath = Join-Path $evidenceRoot 'm7-api-smoke-result.json'
  $devToolsResultPath = Join-Path $evidenceRoot 'm7-devtools-result.json'
  if (Test-Path -LiteralPath $unitLogPath -PathType Leaf) {
    $unitMatches = [regex]::Matches(
      (Get-Content -LiteralPath $unitLogPath -Raw -Encoding UTF8),
      '(?m)^(?:#|ℹ)\s+tests\s+(?<count>\d+)\s*$'
    )
    if ($unitMatches.Count -gt 0) { $unitTestCount = [int]$unitMatches[$unitMatches.Count - 1].Groups['count'].Value }
  }
  if (Test-Path -LiteralPath $productContractLogPath -PathType Leaf) {
    $contractMatches = [regex]::Matches(
      (Get-Content -LiteralPath $productContractLogPath -Raw -Encoding UTF8),
      '(?m)^(?:#|ℹ)\s+tests\s+(?<count>\d+)\s*$'
    )
    if ($contractMatches.Count -gt 0) {
      $productContractTestCount = [int]$contractMatches[$contractMatches.Count - 1].Groups['count'].Value
    }
  }
  if (Test-Path -LiteralPath $legacyBaselineLogPath -PathType Leaf) {
    $legacyMatch = [regex]::Match((Get-Content -LiteralPath $legacyBaselineLogPath -Raw -Encoding UTF8), '"total"\s*:\s*(?<count>\d+)')
    if ($legacyMatch.Success) { $legacyBaselineCaseCount = [int]$legacyMatch.Groups['count'].Value }
  }
  if (Test-Path -LiteralPath $apiResultPath -PathType Leaf) {
    $apiResult = Get-Content -LiteralPath $apiResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $apiResult.PSObject.Properties['assertionCount']) {
      $apiAssertionCount = [int]$apiResult.assertionCount
    } elseif ($null -ne $apiResult.PSObject.Properties['assertions']) {
      $apiAssertionCount = @($apiResult.assertions).Count
    }
  }
  if (Test-Path -LiteralPath $devToolsResultPath -PathType Leaf) {
    $devToolsResult = Get-Content -LiteralPath $devToolsResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $devToolsResult.PSObject.Properties['assertionCount']) {
      $devToolsAssertionCount = [int]$devToolsResult.assertionCount
    } elseif ($null -ne $devToolsResult.PSObject.Properties['assertions']) {
      $devToolsAssertionCount = @($devToolsResult.assertions).Count
    }
    if ($null -ne $devToolsResult.PSObject.Properties['screenshots']) {
      $screenshotIndex = @($devToolsResult.screenshots)
    }
  }
  $summary = [ordered]@{
    status = $Status
    exitCode = $ExitCode
    runAt = (Get-Date).ToUniversalTime().ToString('o')
    projectRoot = $projectRoot
    evidenceDirectory = $evidenceRoot
    rolloutOverride = [ordered]@{
      scope = 'isolated local server process only'
      enabled = $true
      sampleRate = 1
      productionDefaultChanged = $false
    }
    steps = $steps
    verificationCounts = [ordered]@{
      unitTests = $unitTestCount
      productContractTests = $productContractTestCount
      legacyBaselineCases = $legacyBaselineCaseCount
      apiAssertions = $apiAssertionCount
      devToolsAssertions = $devToolsAssertionCount
      screenshots = $screenshotIndex.Count
    }
    screenshotIndex = $screenshotIndex
    failure = $Failure
    explicitlyNotAutomated = @(
      '实体手机相机授权与真实拍照入口',
      '云端 SCF、云数据库、对象存储、域名和微信后台配置'
    )
    limitations = @(
      'PASS 仅代表当前工作区、本地真实 MySQL/HTTP、配置的真实模型供应商与微信开发者工具证据。',
      '本脚本没有部署或验证云端 SCF、云数据库、对象存储、域名、微信后台配置。',
      '本脚本不替代实体手机的弱网、授权弹窗、冷启动和连续使用验收。',
      '相册和文档选择在 DevTools 自动化中验证；相机授权与真实拍照保留为实体手机验收项。',
      $(if ($SkipDevTools) { '本轮显式跳过微信开发者工具，因此状态只能是 PARTIAL。' } else { '微信开发者工具步骤已纳入本轮。' })
    )
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'm7-full-acceptance-result.json') -Encoding UTF8
  @(
    "# M7 本地终局验收结果",
    "",
    "- 状态：$Status",
    "- 真实退出码：$ExitCode",
    "- 证据目录：$evidenceRoot",
    "- 本地受控灰度：隔离进程强制 enabled / sample=1；生产默认未修改",
    "- 单元测试：$unitTestCount",
    "- Product contract：$productContractTestCount",
    "- Legacy baseline：$legacyBaselineCaseCount",
    "- API 断言：$apiAssertionCount",
    "- DevTools 断言：$devToolsAssertionCount",
    "- 截图：$($screenshotIndex.Count) 张（完整路径见 m7-full-acceptance-result.json）",
    "- 云端与真机：未由本脚本验证",
    $(if ($Failure) { "- 失败原因：$Failure" } else { '- 失败原因：无' })
  ) | Set-Content -LiteralPath (Join-Path $evidenceRoot 'README.md') -Encoding UTF8
}

try {
  Write-Output "M7 终局本地验收证据目录：$evidenceRoot"
  Invoke-NativeStep -Name 'unit-tests' -FilePath $npmPath -ArgumentList @('test') -EvidenceLevel 'local-unit-contract'
  Invoke-NativeStep -Name 'product-contract' -FilePath $nodePath -ArgumentList @('--test', 'evals/m7-agent/product-contract.test.mjs') -EvidenceLevel 'local-product-contract'
  Invoke-NativeStep -Name 'legacy-baseline' -FilePath $nodePath -ArgumentList @('evals/m7-agent/run-legacy-baseline.mjs') -EvidenceLevel 'local-read-only-baseline'
  Invoke-NativeStep -Name 'context-check' -FilePath $npmPath -ArgumentList @('run', 'check:context') -EvidenceLevel 'local-static'

  $syntaxTargets = @(
    'scripts/local-server/server.js',
    'scripts/local-server/m7-smoke.js',
    'scripts/local-server/m7-devtools-e2e.js',
    'dist/scf/agent-scf/index.js',
    'dist/scf/agent-scf/agent/chatHandler.js',
    'dist/scf/agent-scf/runtime/rolloutRuntime.js',
    'dist/scf/agent-scf/runtime/toolRegistry.js',
    'dist/scf/api-scf/index.js',
    'dist/scf/api-scf/lib/action-proposals.js',
    'dist/scf/api-scf/lib/care-task-proposals.js'
  )
  foreach ($target in $syntaxTargets) {
    Invoke-NativeStep -Name ('syntax-' + ($target -replace '[/\\.]', '-')) -FilePath $nodePath -ArgumentList @('--check', $target) -EvidenceLevel 'local-static'
  }
  Invoke-NativeStep -Name 'prepare-scf-packages' -FilePath $nodePath -ArgumentList @('scripts/prepare-scf-packages.js') -EvidenceLevel 'local-package-build'
  Invoke-NativeStep -Name 'git-diff-check' -FilePath $gitPath -ArgumentList @('diff', '--check') -WorkingDirectory $repositoryRoot -EvidenceLevel 'local-static'
  if (-not $SkipDevTools) {
    Ensure-MiniprogramAutomator
  }
  $startedMySql = Start-M7LocalMySqlIfNeeded
  Invoke-M7SchemaPreflight

  $originalListener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($originalListener) {
    Assert-LocalServerProcess -ProcessId $originalListener.OwningProcess | Out-Null
    $hadOriginalServer = $true
    Stop-Process -Id $originalListener.OwningProcess
    Start-Sleep -Milliseconds 500
  }

  Set-IsolatedEnvironmentValue -Name 'LOCAL_DEV_AUTH_ENABLED' -Value 'true'
  Set-IsolatedEnvironmentValue -Name 'LOCAL_DEV_OPENID' -Value $isolatedOpenid
  Set-IsolatedEnvironmentValue -Name 'M7_EXPECTED_OPENID' -Value $isolatedOpenid
  Set-IsolatedEnvironmentValue -Name 'M7_EVIDENCE_DIR' -Value $evidenceRoot
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_ENABLED' -Value 'true'
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_SAMPLE_RATE' -Value '1'
  Set-IsolatedEnvironmentValue -Name 'AGENT_ROLLOUT_COHORT_KEY' -Value "m7-full-local-$isolatedOpenid"
  Set-IsolatedEnvironmentValue -Name 'AGENT_SHADOW_ENABLED' -Value 'false'
  if (-not $SkipDevTools) {
    # 每轮使用新的 loopback automation 端口，避免复用 DevTools 上一轮遗留的 WebSocket 会话。
    $automationPort = Get-FreeLoopbackPort
    Set-IsolatedEnvironmentValue -Name 'WECHAT_AUTOMATION_PORT' -Value ([string]$automationPort)
    $automationPortLog = Join-Path $evidenceRoot 'devtools-automation-port.log'
    @(
      "address=127.0.0.1",
      "port=$automationPort",
      'selection=fresh-ephemeral-loopback-port',
      'unrelatedDevToolsProcessesStopped=false'
    ) | Set-Content -LiteralPath $automationPortLog -Encoding UTF8
    Add-StepResult -Name 'devtools-automation-port' -Status 'PASS' -ExitCode 0 -LogPath $automationPortLog -ElapsedSeconds 0 -EvidenceLevel 'local-test-tool'
    Write-Output "[PASS] devtools-automation-port (127.0.0.1:$automationPort)"
  }

  $serverOut = Join-Path $evidenceRoot 'local-server.stdout.log'
  $serverErr = Join-Path $evidenceRoot 'local-server.stderr.log'
  $isolatedServer = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru
  Wait-LocalServer -ExpectedPid $isolatedServer.Id
  Invoke-NativeStep -Name 'm7-api-mysql-smoke' -FilePath $nodePath -ArgumentList @('scripts/local-server/m7-smoke.js') -EvidenceLevel 'local-api-mysql-provider'

  if (-not $SkipDevTools) {
    Invoke-NativeStep -Name 'm7-wechat-devtools-e2e' -FilePath $nodePath -ArgumentList @('scripts/local-server/m7-devtools-e2e.js') -EvidenceLevel 'local-wechat-devtools'
    $finalStatus = 'PASS'
  } else {
    $finalStatus = 'PARTIAL'
  }
  $finalExitCode = 0
  Write-FinalSummary -Status $finalStatus -ExitCode $finalExitCode
} catch {
  $failureMessage = $_.Exception.Message
  Write-Error $failureMessage -ErrorAction Continue
  Write-FinalSummary -Status 'FAIL' -ExitCode 1 -Failure $failureMessage
  $finalExitCode = 1
} finally {
  if ($isolatedServer -and -not $isolatedServer.HasExited) {
    Assert-LocalServerProcess -ProcessId $isolatedServer.Id | Out-Null
    Stop-Process -Id $isolatedServer.Id
    Start-Sleep -Milliseconds 500
  }
  if ($startedMySql -and -not $startedMySql.HasExited) {
    $expectedMySqlExecutable = Resolve-MySqlServerExecutable
    Assert-LocalMySqlProcess -ProcessId $startedMySql.Id -ExpectedExecutable $expectedMySqlExecutable | Out-Null
    Stop-Process -Id $startedMySql.Id
    Start-Sleep -Milliseconds 500
    Write-Output "[STOPPED] 验收脚本启动的本地 MySQL PID $($startedMySql.Id)"
  }
  Restore-IsolatedEnvironment
  if ($hadOriginalServer) {
    $restored = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    Wait-LocalServer -ExpectedPid $restored.Id
    Write-Output "[RESTORED] 默认本地服务器 PID $($restored.Id)"
  }
  Write-Output "[FINAL] status=$finalStatus exit=$finalExitCode evidence=$evidenceRoot"
}

exit $finalExitCode
