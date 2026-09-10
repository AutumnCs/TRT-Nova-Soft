// Optional real Windows key checks, scoped to the foreground DevTools and its focused editor.
const cp = require('node:child_process');
const path = require('node:path');
function key(action, handle = 0) {
  const result = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'devtools-native-key.ps1'), '-Action', action, '-ExpectedHandle', String(handle)], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error(result.stderr || 'native keyboard unavailable');
  return Number(result.stdout.trim());
}
async function run(miniProgram, page, assert, screenshot) {
  if (process.env.M7_INSPECT_NATIVE_FOCUS !== '1') throw new Error('系统按键测试必须先核对桌面截图与自动化实例一致，未发送按键');
  const handle = key('activate');
  const composer = await page.$('#conversation-composer');
  const editor = await composer.$('#document-editor');
  await editor.tap();
  if (process.env.M7_INSPECT_NATIVE_FOCUS === '1') {
    const fs = require('node:fs');
    const output = path.join(process.env.M7_EVIDENCE_DIR, 'native-window.png');
    const captured = cp.spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'devtools-native-key.ps1'), '-Action', 'capture', '-ExpectedHandle', String(handle), '-OutputPath', output], { encoding: 'utf8', windowsHide: true });
    if (captured.status !== 0) throw new Error(captured.stderr);
    console.log('[NATIVE_WINDOW_READY]', JSON.stringify({ handle, output }));
    const ready = path.join(process.env.M7_EVIDENCE_DIR, 'focus-verified.json');
    for (let attempt = 0; attempt < 55 && !fs.existsSync(ready); attempt++) await new Promise(resolve => setTimeout(resolve, 1000));
    if (!fs.existsSync(ready)) throw new Error('未取得截图核对后的输入框点击，停止');
  }
  const position = await miniProgram.evaluate(() => new Promise(resolve => {
    const c = getCurrentPages().at(-1).selectComponent('#conversation-composer');
    c._editor.getContents({ success: result => {
      let index = 0;
      for (const op of result.delta.ops) {
        if (typeof op.insert === 'object') {
          c._editor.setSelection({ index: index + 1, length: 0, success: () => resolve(index + 1) }); return;
        }
        index += op.insert.length;
      }
      resolve(-1);
    } });
  }));
  if (position < 1) throw new Error('no native token to delete');
  // DevTools does not expose document.activeElement. Require the native editor's
  // live collapsed selection after tapping that editor, plus the OS window guard.
  const selection = await miniProgram.evaluate(() => new Promise(resolve => {
    getCurrentPages().at(-1).selectComponent('#conversation-composer')._editor.getSelection({ success: resolve, fail: () => resolve(null) });
  }));
  if (selection?.range?.index !== position || selection.range.length !== 0) throw new Error('原生输入框没有预期光标，未发送系统按键');
  console.log('[KEYBOARD SELECTION]', JSON.stringify(selection.range));
  await screenshot('02d-native-caret-before-backspace.png');
  key('BACKSPACE', handle);
  await page.waitFor(450);
  let data = await page.data();
  await screenshot('02e-native-backspace.png');
  assert(!data.selectedFunction && data.inputValue === '只看最近一周', '实际单击一次 Backspace 移除整个功能，保留用户文字', { text: data.inputValue, selectedFunction: data.selectedFunction });
  const before = data.messages.length;
  key('ENTER', handle);
  await page.waitFor(450);
  data = await page.data();
  assert(data.inputValue === '只看最近一周\n' && !data.sending && data.messages.length === before, '实际 Enter 在原生输入框换行，不发送请求', { text: data.inputValue });
  await screenshot('02f-native-enter-newline.png');
}
module.exports = { run };
