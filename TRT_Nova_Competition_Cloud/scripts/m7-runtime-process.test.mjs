import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const filename of ['run-m7-full-acceptance.ps1', 'run-m7-devtools-e2e.ps1']) {
  test(`${filename} 识别本项目的 Windows 完整路径，不误认其他服务`, { skip: process.platform !== 'win32' }, () => {
    const source = readFileSync(new URL(`./local-server/${filename}`, import.meta.url), 'utf8');
    const match = source.match(/function Assert-LocalServerProcess\([^\n]+\) \{[\s\S]*?\r?\n\}/);
    assert.ok(match, '保留可独立验证的进程归属函数');
    // 只执行该纯校验函数并替换进程查询；绝不执行启动器主流程或停止任何进程。
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$serverScript = 'D:\\植宠项目\\目录 有空格\\scripts\\local-server\\server.js'
function Get-CimInstance { param($ClassName, $Filter) return $script:fixtureProcess }
${match[0]}
$cases = @(
  @{name='node.exe'; command='"C:\\Node\\node.exe" "D:\\植宠项目\\目录 有空格\\scripts\\local-server\\server.js"'; expected=$true},
  @{name='node.exe'; command='node.exe "D:/植宠项目/目录 有空格/scripts/local-server/server.js"'; expected=$true},
  @{name='node.exe'; command='node.exe "D:\\另一个项目\\scripts\\local-server\\server.js"'; expected=$false},
  @{name='node.exe'; command='node.exe scripts/local-server/server.js'; expected=$false},
  @{name='node.exe'; command='node.exe "D:\\植宠项目\\目录 有空格\\scripts\\local-server\\server.js.bak"'; expected=$false},
  @{name='python.exe'; command='python.exe "D:\\植宠项目\\目录 有空格\\scripts\\local-server\\server.js"'; expected=$false}
)
foreach ($case in $cases) {
  $script:fixtureProcess = [pscustomobject]@{Name=$case.name; CommandLine=$case.command}
  $accepted = $true
  try { Assert-LocalServerProcess -ProcessId 123 | Out-Null } catch { $accepted = $false }
  if ($accepted -ne $case.expected) { throw "进程归属断言失败：$($case.command)" }
}
'PASS: 6 process ownership cases'
`;
    const result = spawnSync('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: 6/);
    assert.match(source, /\$serverScript\s*=.*Resolve-Path/);
    for (const launch of source.split(/\r?\n/).filter(line => /Start-Process -FilePath \$nodePath/.test(line))) {
      assert.match(launch, /\$serverScript/, '测试启动和恢复必须都使用完整脚本路径');
    }
  });
}
