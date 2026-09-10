// Uses the real editor and its bindinput path. This is native API/event coverage,
// not a claim that physical keyboard or device IME input has been automated.
async function run(miniProgram, assert, screenshot) {
  const result = await miniProgram.evaluate(async () => {
    const page = getCurrentPages().at(-1);
    const c = page.selectComponent('#conversation-composer');
    const editor = c._editor;
    const call = (name, options = {}) => new Promise((resolve, reject) => editor[name]({ ...options, success: resolve, fail: reject }));
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const originalSet = editor.setContents, originalConsume = c.consumeDocument;
    let writes = 0, events = 0;
    const samples = [];
    editor.setContents = function (options) { writes++; return originalSet.call(this, options); };
    c.consumeDocument = function (delta) { events++; return originalConsume.call(this, delta); };
    async function snapshot(step) {
      const content = await call('getContents'), selection = await call('getSelection');
      let text = '', tokenIndex = -1, offset = 0;
      for (const op of content.delta.ops) {
        if (typeof op.insert === 'string') { text += op.insert; offset += op.insert.length; }
        else { tokenIndex = offset; offset++; }
      }
      const sample = { step, text: text.replace(/\n$/, ''), tokenIndex, range: selection.range, writes, events,
        pageText: page.data.inputValue, pageFunction: page.data.selectedFunction?.key || '',
        ops: content.delta.ops.map(op => typeof op.insert === 'string' ? op : { keys: Object.keys(op), attributes: op.attributes, insert: '[function]' }) };
      samples.push(sample); return sample;
    }
    try {
      const before = await snapshot('before');
      await call('setSelection', { index: before.tokenIndex + 1, length: 0 });
      for (const char of '123456111111') {
        await call('insertText', { text: char }); await settle(); await snapshot('type-' + char);
      }
      for (let i = 0; i < 4; i++) {
        const selection = await call('getSelection');
        await call('deleteText', { index: selection.range.index - 1, length: 1 });
        await settle(); await snapshot('backspace-' + i);
      }
      await call('setSelection', { index: before.tokenIndex + 1, length: 0 });
      await call('deleteText', { index: before.tokenIndex, length: 1 });
      await settle(); await snapshot('remove-function');
      await call('insertText', { text: '中间' }); await settle(); await snapshot('insert-middle');
      await call('insertText', { text: '\n下一行' }); await settle(); await snapshot('newline');
      return { samples, writes, events, source: 'native EditorContext APIs and bindinput; no physical keyboard simulation' };
    } finally { editor.setContents = originalSet; c.consumeDocument = originalConsume; }
  });
  const { samples } = result, before = samples[0];
  assert(result.events >= 19, '原生输入事件确实经过组件，不是只修改 page.data', result);
  assert(result.writes === 0, '连续输入和删除期间没有一次整段 setContents 回写', { writes: result.writes });
  let typed = '';
  for (const [i, char] of [...'123456111111'].entries()) {
    typed += char;
    const sample = samples[i + 1];
    assert(sample.text === before.text + typed && sample.tokenIndex === before.tokenIndex
      && sample.range.index === before.tokenIndex + 1 + typed.length && sample.pageText === sample.text,
    '连续输入第 ' + (i + 1) + ' 字符顺序、光标和页面状态一致', sample);
  }
  for (let i = 0; i < 4; i++) {
    const sample = samples[13 + i];
    assert(sample.text === before.text + typed.slice(0, -(i + 1)) && sample.range.index === before.tokenIndex + typed.length - i,
      '连续退格第 ' + (i + 1) + ' 次只移除左侧字符', sample);
  }
  const removed = samples[17], middle = samples[18], newline = samples[19];
  assert(removed.tokenIndex === -1 && removed.range.index === before.tokenIndex && removed.pageFunction === ''
    && removed.text === before.text + typed.slice(0, -4), '删除整个功能保留前后文字和光标位置', removed);
  assert(middle.text === before.text + '中间' + typed.slice(0, -4), '删除功能后继续在原位置输入', middle);
  assert(newline.text === before.text + '中间\n下一行' + typed.slice(0, -4), 'Enter 等效换行留在正文而不发送', newline);
  await screenshot('02d-composer-caret-after-native-events.png');
  return result;
}
module.exports = { run };
