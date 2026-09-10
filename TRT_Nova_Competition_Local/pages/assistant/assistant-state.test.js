const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VISION_NOTICE_BUTTONS,
  detectImageMimeFromBase64,
  getBase64ByteSize,
  getVisionErrorMessage,
  isVisionCancellation,
  shouldSendOnConfirm,
  canSendDraft,
  createAssistantAsyncScope,
  isAssistantAsyncScopeCurrent,
  isAssistantInteractionLocked,
  canApplySessionSnapshot,
  canPreserveAssistantView,
  runSingleFlight,
  canRewriteMessage,
  buildMessageActionMenu
} = require('./assistant-state');

test('SWR 会话快照只在本地消息版本未变化时覆盖', () => {
  assert.equal(canApplySessionSnapshot(true, 3, 3), true);
  assert.equal(canApplySessionSnapshot(true, 3, 4), false);
  assert.equal(canApplySessionSnapshot(false, 3, 4), true);
});

test('无植宠的全局会话也可保留，但不能跨账号复用', () => {
  const state = { activeSessionId: 'global-session', messages: [{ role: 'user', text: '草稿上下文' }] };
  assert.equal(canPreserveAssistantView(state, 'owner-a', 'owner-a'), true);
  assert.equal(canPreserveAssistantView(state, 'owner-a', 'owner-b'), false);
  assert.equal(canPreserveAssistantView(state, 'owner-a', ''), false);
});

test('图片隐私确认按钮符合微信 showModal 四字符限制', () => {
  assert.ok(Array.from(VISION_NOTICE_BUTTONS.confirmText).length <= 4);
  assert.ok(Array.from(VISION_NOTICE_BUTTONS.cancelText).length <= 4);
});

test('图片类型按真实字节识别，不依赖临时路径扩展名', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString('base64');
  const webp = Buffer.from('RIFF\u0010\u0000\u0000\u0000WEBP', 'binary').toString('base64');

  assert.equal(detectImageMimeFromBase64(png), 'image/png');
  assert.equal(detectImageMimeFromBase64(jpeg), 'image/jpeg');
  assert.equal(detectImageMimeFromBase64(webp), 'image/webp');
  assert.equal(getBase64ByteSize(png), 9);
});

test('图片错误保留真实原因，用户取消不作为失败', () => {
  assert.equal(
    getVisionErrorMessage({ errMsg: 'readFile:fail permission denied' }),
    'permission denied'
  );
  assert.equal(isVisionCancellation({ errMsg: 'chooseMedia:fail cancel' }), true);
});

test('Enter 发送，Shift+Enter 保留换行', () => {
  assert.equal(shouldSendOnConfirm({ detail: { value: '浇水吗' } }), true);
  assert.equal(shouldSendOnConfirm({ detail: { value: '第一行\n第二行', shiftKey: true } }), false);
});

test('文字、待发送图片或文档任一存在时允许发送', () => {
  assert.equal(canSendDraft('', null), false);
  assert.equal(canSendDraft('  浇水吗  ', null), true);
  assert.equal(canSendDraft('', { tempFilePath: 'wxfile://pending-image' }), true);
  assert.equal(canSendDraft('', null, { tempFilePath: 'wxfile://pending-document' }), true);
  assert.equal(canSendDraft('   ', {}), false);
});

test('异步回包必须同时匹配植株、会话和页面 epoch', () => {
  const expected = createAssistantAsyncScope(12, 'conversation-a', 7);
  assert.equal(isAssistantAsyncScopeCurrent(expected, createAssistantAsyncScope(12, 'conversation-a', 7)), true);
  assert.equal(isAssistantAsyncScopeCurrent(expected, createAssistantAsyncScope(13, 'conversation-a', 7)), false);
  assert.equal(isAssistantAsyncScopeCurrent(expected, createAssistantAsyncScope(12, 'conversation-b', 7)), false);
  assert.equal(isAssistantAsyncScopeCurrent(expected, createAssistantAsyncScope(12, 'conversation-a', 8)), false);
});

test('较早会话的延迟回包不能覆盖切换后的当前视图', async () => {
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => { resolveOldRequest = resolve; });
  const expected = createAssistantAsyncScope(12, 'conversation-a', 7);
  let current = createAssistantAsyncScope(12, 'conversation-a', 7);
  let rendered = 'conversation-a-loading';
  const completion = oldRequest.then((value) => {
    if (isAssistantAsyncScopeCurrent(expected, current)) rendered = value;
  });

  current = createAssistantAsyncScope(13, 'conversation-b', 8);
  rendered = 'conversation-b';
  resolveOldRequest('stale-conversation-a');
  await completion;
  assert.equal(rendered, 'conversation-b');
});

test('发送或会话加载期间锁定植株与会话切换', () => {
  assert.equal(isAssistantInteractionLocked({ sending: true, loadingSession: false }), true);
  assert.equal(isAssistantInteractionLocked({ sending: false, loadingSession: true }), true);
  assert.equal(isAssistantInteractionLocked({ visionBusy: true }), true);
  assert.equal(isAssistantInteractionLocked({ documentBusy: true }), true);
  assert.equal(isAssistantInteractionLocked({ savingDiagnosis: true }), true);
  assert.equal(isAssistantInteractionLocked({ rewriteBusy: true }), true);
  assert.equal(isAssistantInteractionLocked({ proposalBusyKey: 'proposal-1' }), true);
  assert.equal(isAssistantInteractionLocked({ sending: false, loadingSession: false }), false);

  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, 'assistant.wxml'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, 'assistant.js'), 'utf8');
  assert.match(wxml, /range-key="nickname"[^>]+disabled="\{\{sending \|\| loadingSession[^}]+proposalBusyKey\}\}"/);
  assert.match(wxml, /class="conversation-picker"[^>]+disabled="\{\{sending \|\| loadingSession[^}]+proposalBusyKey\}\}"/);
  assert.match(wxml, /class="new-conversation-button"[^>]+disabled="\{\{sending \|\| loadingSession[^}]+proposalBusyKey\}\}"/);
  assert.match(page, /async onPlantPetChange\(e\) \{\s+if \(isAssistantInteractionLocked\(this\.data\)\) return;/);
  assert.match(page, /async onConversationChange\(e\) \{\s+if \(isAssistantInteractionLocked\(this\.data\)\) return;/);
  assert.match(page, /onHide\(\) \{\s+this\.invalidateAssistantAsyncScope\(\);/);
  assert.match(page, /onUnload\(\) \{\s+this\._assistantUnmounted = true;\s+this\.invalidateAssistantAsyncScope\(\);/);
  assert.match(page, /prepareRewriteConversation\(plantPetId, requestScope\)/);
  assert.match(page, /const sessionId = this\.data\.activeSessionId \|\| '';/);
  assert.match(page, /sessionId,\s+userMessageId: backendId/);
  assert.match(page, /async choosePlantImage[\s\S]+?this\.beginAttachmentSelection\(\)[\s\S]+?this\.isCurrentAttachmentSelection\(selection\)/);
  assert.match(page, /async choosePlantDocument[\s\S]+?this\.beginAttachmentSelection\(\)[\s\S]+?this\.isCurrentAttachmentSelection\(selection\)/);
});

test('并发触发图片发送时只创建一个隐私确认流程', async () => {
  const owner = {};
  let calls = 0;
  let resolveNotice;
  const notice = () => {
    calls += 1;
    return new Promise((resolve) => { resolveNotice = resolve; });
  };
  const first = runSingleFlight(owner, '_visionNoticePromise', notice);
  const second = runSingleFlight(owner, '_visionNoticePromise', notice);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveNotice(true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(owner._visionNoticePromise, null);
});

test('任务候选入口位于长来源列表之前', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, 'assistant.wxml'), 'utf8');
  assert.ok(wxml.indexOf('task-suggestion-list') < wxml.indexOf('source-list'));
  assert.match(wxml, /NOVA 任务提案/);
});

test('消息操作默认隐藏，长按后才显示带文字的临时菜单', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(path.join(__dirname, 'assistant.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'assistant.js'), 'utf8');
  const state = fs.readFileSync(path.join(__dirname, 'assistant-state.js'), 'utf8');
  assert.doesNotMatch(wxml, /class="message-action-row"/);
  assert.match(wxml, /bindlongpress="openMessageActionMenu"/);
  assert.match(wxml, /class="message-action-overlay"/);
  assert.match(wxml, /class="message-action-menu"/);
  assert.match(state, /images\/icons\/message\/copy\.svg/);
  assert.match(state, /images\/icons\/message\/pencil\.svg/);
  assert.match(state, /images\/icons\/message\/undo-2\.svg/);
  assert.match(js, /openMessageActionMenu/);
  assert.match(js, /closeMessageActionMenu/);
});

test('长按菜单按消息能力生成操作并限制在视口内', () => {
  const menu = buildMessageActionMenu({
    role: 'user', backendId: 17, text: '浇水吗', canRewrite: true, canWithdraw: true
  }, { clientX: 370, clientY: 650 }, { windowWidth: 375, windowHeight: 667 });
  assert.deepEqual(menu.actions.map((item) => item.key), ['copy', 'rewrite', 'withdraw']);
  assert.ok(menu.left >= 12 && menu.left <= 183);
  assert.ok(menu.top >= 12 && menu.top < 650);
  assert.equal(buildMessageActionMenu({ role: 'assistant', backendId: 18, text: '回答' }), null);
});

test('重新编辑覆盖纯文字和已保存附件，旧版缺失附件不会显示虚假入口', () => {
  assert.equal(canRewriteMessage({ role: 'user', backendId: 1, text: '怎么浇水' }), true);
  assert.equal(canRewriteMessage({
    role: 'user', backendId: 2, visionInput: true, visionMediaFileId: 'local://image', imageOriginalUnavailable: false
  }), true);
  assert.equal(canRewriteMessage({
    role: 'user', backendId: 3, documentInput: true,
    documentAttachment: { originalPersisted: true, mediaFileId: 'local://document' }
  }), true);
  assert.equal(canRewriteMessage({
    role: 'user', backendId: 4, visionInput: true, imageOriginalUnavailable: true
  }), false);
  assert.equal(canRewriteMessage({ role: 'assistant', backendId: 5, text: '回答' }), false);
});

test('首次加载期间隐藏再返回会在旧请求结束后补拉且解除 loading', async () => {
  const previous = {
    getApp: global.getApp,
    wx: global.wx,
    Page: global.Page
  };
  let pageDefinition;
  global.getApp = () => ({
    globalData: { hasLogin: true },
    checkLoginStatus() {},
    gotoLoginPage() {}
  });
  global.wx = {
    getStorageSync() { return null; },
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo() { return { statusBarHeight: 20 }; },
    getMenuButtonBoundingClientRect() { return { bottom: 60 }; }
  };
  global.Page = (definition) => { pageDefinition = definition; };

  const modulePath = require.resolve('./assistant.js');
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page.onLoad();
    page._assistantHidden = false;

    const waits = [];
    let calls = 0;
    page._loadPlantsAndSessionOnce = async function deferredLoad() {
      calls += 1;
      this.setData({ loadingSession: true });
      return new Promise((resolve) => waits.push(resolve));
    };

    const firstLoad = page.loadPlantsAndSession();
    assert.equal(calls, 1);
    page.onHide();
    assert.equal(page.data.loadingSession, false);

    // 等价于 onShow 已把页面重新标为可见并再次请求加载。
    page._assistantHidden = false;
    const visibleLoad = page.loadPlantsAndSession();
    assert.equal(calls, 1, '旧请求未结束前保持单飞');
    waits[0]('stale');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2, '旧请求结束后为当前可见页面补拉一次');
    waits[1]('fresh');
    await Promise.all([firstLoad, visibleLoad]);

    assert.equal(page._loadingPlantsPromise, null);
    assert.equal(page._loadingPlants, false);
  } finally {
    delete require.cache[modulePath];
    global.getApp = previous.getApp;
    global.wx = previous.wx;
    global.Page = previous.Page;
  }
});

test('保留会话的旧后台快照和刷新失败都不会清掉当前消息', async () => {
  const previous = {
    getApp: global.getApp,
    wx: global.wx,
    Page: global.Page
  };
  const agentService = require('../../services/modules/AgentService');
  const originalGetSession = agentService.getSession;
  let pageDefinition;
  global.getApp = () => ({
    globalData: { hasLogin: true },
    checkLoginStatus() {},
    gotoLoginPage() {}
  });
  global.wx = {
    getStorageSync(key) {
      if (key === 'apiAccessTokenMeta') return { openid: 'owner-a' };
      return null;
    },
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo() { return { statusBarHeight: 20 }; },
    getMenuButtonBoundingClientRect() { return { bottom: 60 }; }
  };
  global.Page = (definition) => { pageDefinition = definition; };

  const modulePath = require.resolve('./assistant.js');
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page.onLoad();
    page.setData({
      selectedPlantPet: null,
      activeSessionId: 'global-session',
      loadingSession: false,
      messages: [{ id: 'stored-old', role: 'user', text: '原消息' }]
    });
    page._sessionLoadedOpenid = 'owner-a';

    let resolveOldSnapshot;
    agentService.getSession = () => new Promise((resolve) => { resolveOldSnapshot = resolve; });
    const refreshing = page.loadSession('global-session', { preserveView: true });
    await new Promise((resolve) => setImmediate(resolve));
    page.setConversationMessages(page.data.messages.concat([
      { id: 'optimistic-user', role: 'user', text: '刷新期间发送的新消息' }
    ]));
    resolveOldSnapshot({
      sessionId: 'global-session',
      messages: [{ id: 1, role: 'user', content: '服务端旧快照' }],
      memories: []
    });
    assert.equal(await refreshing, false);
    assert.ok(page.data.messages.some((item) => item.id === 'optimistic-user'));

    const beforeFailure = page.data.messages.map((item) => ({ ...item }));
    agentService.getSession = async () => { throw new Error('network down'); };
    assert.equal(await page.loadSession('global-session', { preserveView: true }), false);
    assert.deepEqual(page.data.messages, beforeFailure);
    assert.match(page.data.loadError, /正在显示上次内容/);
  } finally {
    agentService.getSession = originalGetSession;
    delete require.cache[modulePath];
    global.getApp = previous.getApp;
    global.wx = previous.wx;
    global.Page = previous.Page;
  }
});
