const test = require('node:test');
const assert = require('node:assert/strict');

async function withMemoryPage(run) {
  const previous = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  const service = require('../../services/modules/AgentService');
  const original = service.contextMemory;
  let owner = 'owner-a';
  let definition;
  const modals = [];
  const calls = [];
  global.getApp = () => ({ checkLoginStatus() {}, globalData: { hasLogin: true } });
  global.wx = {
    getStorageSync: () => ({ openid: owner }),
    showModal: options => { modals.push(options); },
    showToast() {}
  };
  global.Page = page => { definition = page; };
  service.contextMemory = async payload => { calls.push(payload); return { memory: { enabled: true, facts: [], version: 2 } }; };
  const target = require.resolve('./aiMemory');
  delete require.cache[target];
  try {
    require(target);
    const page = { ...definition, _memoryOwner: owner, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
    page.data.contextMemory = { enabled: true, version: 1, facts: [{ key: 'preferred_name', content: '喜欢被叫作dola' }] };
    await run({ page, service, calls, modals, setOwner(value) { owner = value; } });
  } finally {
    service.contextMemory = original;
    delete require.cache[target];
    Object.assign(global, previous);
  }
}

test('旧账号的摘要请求返回后不能显示在新账号页面', () => withMemoryPage(async ({ page, service, setOwner }) => {
  let resolve;
  service.contextMemory = () => new Promise(done => { resolve = done; });
  const pending = page.loadContextMemory();
  setOwner('owner-b');
  page._memoryOwner = 'owner-b';
  page.data.contextMemory = null;
  resolve({ memory: { facts: [{ content: '旧账号信息' }] } });
  await pending;
  assert.equal(page.data.contextMemory, null);
}));

for (const action of ['edit', 'forget', 'enable']) {
  test(`账号切换后旧 ${action} 弹窗不能写入新账号`, () => withMemoryPage(async ({ page, calls, modals, setOwner }) => {
    const pending = action === 'edit' ? page.editContextFact({ currentTarget: { dataset: { key: 'preferred_name' } } })
      : action === 'forget' ? page.forgetContextFact({ currentTarget: { dataset: {} } }) : page.toggleContextMemory();
    setOwner('owner-b');
    page._memoryOwner = 'owner-b';
    modals[0].success({ confirm: true, content: '不应该写入' });
    await pending;
    assert.equal(calls.length, 0);
  }));
}

test('离开记忆页后异步结果不能继续更新已卸载页面', () => withMemoryPage(async ({ page, service }) => {
  let resolve;
  service.contextMemory = () => new Promise(done => { resolve = done; });
  const before = page.data.contextMemory;
  const pending = page.loadContextMemory();
  page.onUnload();
  resolve({ memory: { version: 500 } });
  await pending;
  assert.equal(page.data.contextMemory, before);
}));

test('编辑整份摘要时保留原版本，保存成功后才退出编辑', () => withMemoryPage(async ({ page, calls, service }) => {
  page.data.contextMemory.summary = '你喜欢月季。';
  page.startSummaryEdit();
  page.onSummaryInput({ detail: { value: '请叫我云朵。你喜欢月季和简短回答。' } });
  service.contextMemory = async payload => { calls.push(payload); return { memory: { enabled: true, summary: payload.summary, facts: [], version: 2 } }; };
  await page.saveSummary();
  assert.equal(calls[0].action, 'replace_summary'); assert.equal(calls[0].version, 1);
  assert.equal(page.data.editingSummary, false);
  assert.equal(page.data.contextMemory.summary, '请叫我云朵。你喜欢月季和简短回答。');
}));

test('摘要保存失败不丢整段草稿，也不显示成已保存', () => withMemoryPage(async ({ page, service }) => {
  page.startSummaryEdit(); page.onSummaryInput({ detail: { value: '修改后的摘要' } });
  service.contextMemory = async () => { throw new Error('网络暂时不可用'); };
  await page.saveSummary();
  assert.equal(page.data.summaryDraft, '修改后的摘要'); assert.equal(page.data.editingSummary, true);
  assert.match(page.data.summarySaveError, /网络/); assert.equal(page.data.contextBusy, false);
}));

test('聊天并发更新摘要时不悄悄覆盖，保留草稿并要求对照新版', () => withMemoryPage(async ({ page, service }) => {
  page.startSummaryEdit(); page.onSummaryInput({ detail: { value: '旧版本上修改的摘要' } });
  service.contextMemory = async payload => {
    if (payload) throw Object.assign(new Error('记忆已变化，请刷新后再试'), { statusCode: 409 });
    return { memory: { version: 7, summary: '聊天新增了偏好', facts: [] } };
  };
  await page.saveSummary();
  assert.equal(page.data.summaryDraft, '旧版本上修改的摘要');
  assert.equal(page.data.summaryEditVersion, 1); assert.equal(page.data.summaryConflict, true);
  page.reviewSummaryConflict(); assert.equal(page.data.summaryEditVersion, 7);
}));

test('账号切换后旧整段编辑草稿不能写入新账号', () => withMemoryPage(async ({ page, calls, setOwner }) => {
  page.startSummaryEdit(); setOwner('owner-b'); await page.saveSummary(); assert.equal(calls.length, 0);
}));
