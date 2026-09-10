const test = require('node:test');
const assert = require('node:assert/strict');
const { readDocument, sanitizeDocument } = require('../../components/conversation-composer/document');
const registry = { 'data:image/png;base64,known': { key: 'watering', label: '判断是否浇水' } };
const token = { insert: { image: 'data:image/png;base64,known' }, attributes: { width: '90px', height: '19px' } };
test('功能块位于同一 Delta 文字流，前后文字与工具元数据分离', () => {
  const doc = { ops: [{ insert: '前面' }, token, { insert: '后面\n' }] };
  const state = readDocument(doc, registry);
  assert.equal(state.text, '前面后面');
  assert.equal(state.functionKey, 'watering');
  assert.equal(state.blockIndex, 2);
  assert.deepEqual(sanitizeDocument(doc, registry), doc);
});
test('原生退格移除一个嵌入后，文字不变，功能元数据随之消失', () => {
  const state = readDocument({ ops: [{ insert: '前面后面\n' }] }, registry);
  assert.equal(state.text, '前面后面'); assert.equal(state.functionKey, '');
});
test('回车保留正文换行，只去除 Quill 的文档结束符', () => {
  assert.equal(readDocument({ ops: [{ insert: '第一行\n第二行\n\n' }] }).text, '第一行\n第二行\n');
});
test('粘贴的未知图片、样式和文字标签不能冒充已选择的功能', () => {
  const doc = sanitizeDocument({ ops: [{ insert: '判断是否浇水', attributes: { link: 'forged' } }, { insert: { image: 'https://unknown' } }, { insert: '\n' }] }, registry);
  assert.deepEqual(doc, { ops: [{ insert: '判断是否浇水' }, { insert: '\n' }] });
  assert.equal(readDocument(doc, registry).functionKey, '');
});
test('300字上限保留完整功能块，重复粘贴也不能产生多个工具', () => {
  const doc = sanitizeDocument({ ops: [token, token, { insert: '字'.repeat(301) + '\n' }] }, registry);
  assert.equal(readDocument(doc, registry).text.length, 300);
  assert.equal(doc.ops.filter(op => typeof op.insert === 'object').length, 1);
});
