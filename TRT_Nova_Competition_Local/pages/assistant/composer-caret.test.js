const test = require('node:test');
const assert = require('node:assert/strict');
const { readDocument } = require('../../components/conversation-composer/document');
let definition;
global.Component = value => { definition = value; };
require('../../components/conversation-composer/index');
delete global.Component;
const token = { attributes: { width: '94px', height: '20px' }, insert: { image: 'known' } };
const registry = { known: { key: 'watering', label: '判断是否浇水' } };

// Native Delta puts attributes before insert. setContents replaces the document
// and resets the selection: a state-only mock would miss the reported regression.
function fixture(ops, index, length = 0) {
  const c = { ...definition.methods, properties: { value: '', functionItem: null, scopeKey: 'session' }, data: { changing: false },
    setData(data) { Object.assign(this.data, data); },
    triggerEvent(name, detail) {
      if (name === 'editorerror') throw new Error(detail.message);
      if (name !== 'change') return;
      this.properties.value = detail.value;
      this.properties.functionItem = detail.functionKey ? { key: detail.functionKey, label: '判断是否浇水' } : null;
      this.scheduleSync();
    } };
  definition.lifetimes.attached.call(c);
  c._registry = registry;
  let doc = { ops }, range = { index, length }, writes = 0;
  const initial = readDocument(doc, registry);
  c._lastText = c.properties.value = initial.text;
  c._lastKey = initial.functionKey;
  c.properties.functionItem = initial.functionKey ? { key: initial.functionKey } : null;
  c._editor = {
    getContents({ success }) { success({ delta: doc }); },
    getSelection({ success }) { success({ range: { ...range } }); },
    setContents({ delta, success }) { writes++; doc = delta; range = { index: 0, length: 0 }; success({}); },
    setSelection({ index, length, success }) { range = { index, length }; success({}); }
  };
  function atoms() { return doc.ops.flatMap(op => typeof op.insert === 'string' ? op.insert.split('') : [op]); }
  async function change(next, nextRange) {
    const ops = [];
    for (const atom of next) {
      if (typeof atom !== 'string') ops.push(atom);
      else if (typeof ops.at(-1)?.insert === 'string') ops.at(-1).insert += atom;
      else ops.push({ insert: atom });
    }
    doc = { ops }; range = nextRange;
    await c.onEditorInput({ detail: { delta: doc } });
    await Promise.resolve();
    if (c._syncPromise) await c._syncPromise;
  }
  return { c, doc: () => doc, range: () => range, writes: () => writes,
    async input(text) {
      const next = atoms(); next.splice(range.index, range.length, ...text.split(''));
      await change(next, { index: range.index + text.length, length: 0 });
    },
    async backspace() {
      const next = atoms(), start = Math.max(0, range.index - (range.length ? 0 : 1));
      next.splice(start, range.length || (range.index ? 1 : 0));
      await change(next, { index: start, length: 0 });
    },
    async emit() { await c.onEditorInput({ detail: { delta: doc } }); }
  };
}

test('原生字段顺序不同不回写：连续 123456 和重复 1 保持在功能右侧', async () => {
  const f = fixture([token, { insert: '\n' }], 1);
  for (const char of '123456111111') await f.input(char);
  assert.equal(readDocument(f.doc(), registry).text, '123456111111');
  assert.equal(readDocument(f.doc(), registry).blockIndex, 0);
  assert.deepEqual(f.range(), { index: 13, length: 0 });
  assert.equal(f.writes(), 0);
});

test('连续退格只删除光标左侧字符，不跳到开头', async () => {
  const f = fixture([{ insert: '前' }, token, { insert: '1234后\n' }], 6);
  for (const index of [5, 4, 3, 2]) { await f.backspace(); assert.equal(f.range().index, index); }
  assert.equal(readDocument(f.doc(), registry).text, '前后');
  assert.equal(readDocument(f.doc(), registry).functionKey, 'watering');
  assert.equal(f.writes(), 0);
});

test('在功能右侧一次退格删整个功能，保留前后文字与原地光标', async () => {
  const f = fixture([{ insert: '前' }, token, { insert: '后\n' }], 2);
  await f.backspace();
  assert.equal(f.c.properties.functionItem, null);
  assert.equal(f.c.properties.value, '前后');
  assert.deepEqual(f.range(), { index: 1, length: 0 });
  await f.input('中');
  assert.equal(f.c.properties.value, '前中后');
  assert.equal(f.writes(), 0);
});

test('无功能及空 attributes 的有效文字也不触发整段回写', async () => {
  const f = fixture([{ attributes: {}, insert: '123\n' }], 2);
  await f.emit();
  assert.deepEqual(f.range(), { index: 2, length: 0 });
  assert.equal(f.writes(), 0);
});

test('300 字与末尾换行不反复清理；正文 Enter 保留', async () => {
  const f = fixture([token, { insert: '1'.repeat(300) + '\n' }], 301);
  await f.emit(); await f.c.flush();
  assert.equal(f.writes(), 0);
  const multiline = fixture([token, { insert: '第一行\n' }], 4);
  await multiline.input('\n第二行');
  assert.equal(multiline.c.properties.value, '第一行\n第二行');
  assert.equal(multiline.writes(), 0);
});

test('确需清理未知粘贴块时，按实际删除位置恢复光标', async () => {
  const f = fixture([{ insert: '前' }, { insert: { image: 'unknown' } }, token, { insert: '后\n' }], 3);
  await f.emit();
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.range(), { index: 2, length: 0 });
  assert.equal(f.c.properties.value, '前后');
  assert.equal(f.c.properties.functionItem.key, 'watering');
});

test('清理粘贴样式保留选区，不把光标固定到开头或末尾', async () => {
  const f = fixture([{ insert: '前后文字\n', attributes: { bold: true } }], 1, 2);
  await f.emit();
  assert.deepEqual(f.range(), { index: 1, length: 2 });
  assert.equal(f.writes(), 1);
});

test('超过上限的粘贴只回写一次，光标落在截断后的合理位置', async () => {
  const f = fixture([token, { insert: '1'.repeat(310) + '\n' }], 311);
  await f.emit(); await f.c.flush();
  assert.equal(f.c.properties.value.length, 300);
  assert.deepEqual(f.range(), { index: 301, length: 0 });
  assert.equal(f.writes(), 1);
});

test('旧粘贴清理等待读取光标时，新输入优先，不回放旧文档', async () => {
  const f = fixture([{ insert: '新文字\n' }], 3);
  let release;
  f.c._editor.getSelection = ({ success }) => { release = success; };
  const previous = f.c.consumeDocument({ ops: [{ insert: '旧文字\n', attributes: { bold: true } }] });
  await f.c.consumeDocument(f.doc());
  release({ range: { index: 3, length: 0 } });
  await previous;
  assert.equal(f.writes(), 0);
  assert.equal(f.c.properties.value, '新文字');
});

test('切换会话后，旧文档清理的异步结果不能覆盖新草稿', async () => {
  const f = fixture([{ insert: '文字\n' }], 2);
  let release;
  f.c._editor.getSelection = ({ success }) => { release = success; };
  const previous = f.c.consumeDocument({ ops: [{ insert: '旧文字\n', attributes: { bold: true } }] });
  f.c.properties.scopeKey = 'different-session';
  release({ range: { index: 2, length: 0 } });
  await previous;
  assert.equal(f.writes(), 0);
});
