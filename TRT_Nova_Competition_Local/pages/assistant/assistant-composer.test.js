const test = require('node:test');
const assert = require('node:assert/strict');

async function withComposer(run) {
  const previous = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  let definition;
  let owner = 'composer-owner';
  let refreshes = 0;
  const toasts = [];
  global.getApp = () => ({ globalData: { hasLogin: true }, checkLoginStatus() {} });
  global.wx = {
    getStorageSync(key) { return key === 'apiAccessTokenMeta' ? { openid: owner } : null; },
    getWindowInfo() { return { statusBarHeight: 20 }; },
    getMenuButtonBoundingClientRect() { return { bottom: 60 }; },
    showToast(value) { toasts.push(value); },
    showModal(value) { throw new Error(`意外弹窗: ${value.title}`); },
    getFileSystemManager() {
      return { readFile(options) { options.success({ data: Buffer.from([255, 216, 255, 224, 0]).toString('base64') }); } };
    }
  };
  global.Page = (value) => { definition = value; };
  const modulePath = require.resolve('./assistant');
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    page.onLoad();
    page.setData({ loadingSession: false, activeSessionId: 'global-session', selectedPlantPet: null });
    page._sessionLoadedOpenid = owner;
    page.loadPlantsAndSession = () => { refreshes += 1; return Promise.resolve(); };
    await run({ page, wx: global.wx, setOwner(value) { owner = value; }, refreshCount: () => refreshes, toasts });
  } finally {
    delete require.cache[modulePath];
    Object.assign(global, previous);
  }
}

test('图文和历史消息都展示摘要整理失败提示，不假装保存成功', () => withComposer(async ({ page }) => {
  const response = { contextMemory: { status: 'failed', message: '本轮对话已保存，跨会话摘要暂未更新。' } };
  assert.match(page.buildAssistantMessage(response).summary, /暂未更新/);
  for (const kind of ['vision_analysis', 'document_analysis', 'chat']) {
    const restored = page.mapStoredMessage({ id: 1, role: 'assistant', content: '回答', response: { ...response, kind } });
    assert.match(restored.summary, /暂未更新/);
  }
}));

for (const kind of ['image', 'document']) {
  for (const plant of [null, { id: 21, nickname: '月季' }]) {
    test(`${kind} 选择器隐藏/显示页面后仍进入草稿（${plant ? '有植宠' : '无植宠'}）`, () => withComposer(async ({ page, wx, refreshCount }) => {
      page.setData({ selectedPlantPet: plant, inputValue: '只介绍，不安排任务' });
      let complete;
      const api = kind === 'image' ? 'chooseMedia' : 'chooseMessageFile';
      wx[api] = (options) => { complete = options; page.onHide(); page.onShow(); };
      const selected = kind === 'image' ? page.choosePlantImage() : page.choosePlantDocument();
      complete.success({ tempFiles: [{ tempFilePath: 'wxfile://rose', path: 'wxfile://rose.md', name: '月季.md', size: 5 }] });
      await selected;
      assert.ok(kind === 'image' ? page.data.pendingImage : page.data.pendingDocument);
      assert.equal(page.data.inputValue, '只介绍，不安排任务');
      assert.equal(page.data.canSend, true);
      assert.equal(page.data.sending, false, '选择附件不能触发发送');
      assert.equal(refreshCount(), 0, '选择器返回不能重新加载并清掉草稿');
    }));
  }
}

for (const change of ['account', 'conversation', 'plant', 'unload']) {
  test(`附件回调不得进入已经变更的 ${change}`, () => withComposer(async ({ page, wx, setOwner }) => {
    let complete;
    wx.chooseMedia = (options) => { complete = options; };
    const selected = page.choosePlantImage();
    if (change === 'account') setOwner('another-owner');
    if (change === 'conversation') page.setData({ activeSessionId: 'another-session' });
    if (change === 'plant') page.setData({ selectedPlantPet: { id: 42 } });
    if (change === 'unload') page.onUnload();
    complete.success({ tempFiles: [{ tempFilePath: 'wxfile://rose', size: 5 }] });
    await selected;
    assert.equal(page.data.pendingImage, null);
    assert.equal(page._pendingVisionPayload || null, null);
  }));
}

for (const kind of ['image', 'document']) {
  test(`${kind} 回调先到、页面稍后显示时仍保留草稿`, () => withComposer(async ({ page, wx, refreshCount }) => {
    const api = kind === 'image' ? 'chooseMedia' : 'chooseMessageFile';
    wx[api] = (options) => {
      page.onHide();
      options.success({ tempFiles: [{ tempFilePath: 'wxfile://rose', path: 'wxfile://rose.md', name: '月季.md', size: 5 }] });
    };
    if (kind === 'image') await page.choosePlantImage();
    else await page.choosePlantDocument();
    page.onShow();
    assert.ok(kind === 'image' ? page.data.pendingImage : page.data.pendingDocument);
    assert.equal(page.data.canSend, true);
    assert.equal(refreshCount(), 1, '选择已结束后正常恢复页面刷新');
  }));
}

test('取消选择保留原附件与用户文字，下次仍能选择', () => withComposer(async ({ page, wx }) => {
  page.setData({ pendingDocument: { tempFilePath: 'wxfile://old', name: '原文档.md' }, inputValue: '保留我的问题', canSend: true });
  wx.chooseMedia = (options) => { page.onHide(); page.onShow(); options.fail({ errMsg: 'chooseMedia:fail cancel' }); };
  await page.choosePlantImage();
  assert.equal(page.data.pendingDocument.name, '原文档.md');
  assert.equal(page.data.inputValue, '保留我的问题');
  wx.chooseMedia = (options) => options.success({ tempFiles: [{ tempFilePath: 'wxfile://new', size: 5 }] });
  await page.choosePlantImage();
  assert.equal(page.data.pendingImage.tempFilePath, 'wxfile://new');
  assert.equal(page.data.pendingDocument, null);
}));

test('功能是独立标签：选择与移除都不改用户文字', () => withComposer(async ({ page }) => {
  page.setData({ inputValue: '只看最近一周，不安排任务' });
  page.selectFunction({ currentTarget: { dataset: { key: 'plant_status' } } });
  assert.equal(page.data.inputValue, '只看最近一周，不安排任务');
  assert.equal(page.data.selectedFunction.key, 'plant_status');
  page.removeSelectedFunction();
  assert.equal(page.data.inputValue, '只看最近一周，不安排任务');
  assert.equal(page.data.canSend, true);
}));

test('只有功能标签也能发送；移除后空草稿不能发送', () => withComposer(async ({ page }) => {
  page.selectFunction({ currentTarget: { dataset: { key: 'watering' } } });
  assert.equal(page.data.inputValue, '');
  page.onInput({ detail: { value: '' } });
  assert.equal(page.data.canSend, true);
  let sent;
  page.sendTextMessage = async (text) => { sent = { text, key: page.data.selectedFunction.key }; };
  await page.sendMessage();
  assert.deepEqual(sent, { text: '判断是否浇水', key: 'watering' });
  page.removeSelectedFunction();
  assert.equal(page.data.canSend, false);
}));

test('移除功能不会影响已选附件', () => withComposer(async ({ page }) => {
  page.setData({ pendingImage: { tempFilePath: 'wxfile://rose' } });
  page.selectFunction({ currentTarget: { dataset: { key: 'plant_status' } } });
  page.removeSelectedFunction();
  assert.equal(page.data.inputValue, '');
  assert.equal(page.data.pendingImage.tempFilePath, 'wxfile://rose');
  assert.equal(page.data.canSend, true);
}));

test('Enter 只改草稿，不再触发请求', () => withComposer(async ({ page }) => {
  let sends = 0; page.sendMessage = () => { sends++; };
  await page.onInputConfirm({ detail: { value: '第一行\n' } });
  assert.equal(sends, 0); assert.equal(page.data.inputValue, '第一行\n');
}));

test('原生编辑器删除功能块会同步清除所选工具，不留提示词', () => withComposer(async ({ page }) => {
  page.selectFunction({ currentTarget: { dataset: { key: 'watering' } } });
  page.onComposerChange({ detail: { value: '只看记录', functionKey: '' } });
  assert.equal(page.data.selectedFunction, null); assert.equal(page.data.inputValue, '只看记录');
}));

for (const change of ['account', 'session', 'hide']) {
  test(`输入框异步读取期间切换 ${change} 不得发送旧草稿`, () => withComposer(async ({ page, setOwner }) => {
    let finish; let sends = 0;
    page.setData({ inputValue: '旧草稿' });
    page.selectComponent = () => ({ flush: () => new Promise(resolve => { finish = resolve; }) });
    page.sendTextMessage = async () => { sends++; };
    const sending = page.sendMessage();
    if (change === 'account') setOwner('other');
    if (change === 'session') page.setData({ activeSessionId: 'other' });
    if (change === 'hide') page.onHide();
    finish(); await sending;
    assert.equal(sends, 0);
  }));
}
