/**
 * M7 微信开发者工具完整页面闭环。
 * 核心身份从登录页执行 wx.login -> /auth/login，不使用 /dev/token。
 * 配套 PowerShell 只复用既有 LC-02，为本轮启动隔离的本地 openid，完成后恢复默认服务。
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { captureStorage, restoreStorage } = require('./devtools-storage');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M7_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M7_2026-09-01\\devtools-closure-v1';
const rosePath = process.env.M7_ROSE_IMAGE || 'D:\\植宠项目\\验收记录\\M6_2026-08-28\\known-rosa-chinensis.jpg';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(), 'zhichong-miniprogram-automator', 'node_modules', 'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);
const expectedOpenid = String(process.env.M7_EXPECTED_OPENID || '').trim();
const assertionResults = [];
const automationConnectionEvidence = [];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function seedHighUsageFixture(openid) {
  if (openid !== expectedOpenid || !/^m7_/.test(openid)) throw new Error('isolated test owner required');
  const config = {};
  for (const line of fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) config[m[1]] = m[2].trim();
  }
  if (!['127.0.0.1', 'localhost'].includes(config.DB_HOST) || config.DB_NAME !== 'zhichong_v01_local') throw new Error('local fixture only');
  const mysql = require(path.join(projectRoot, 'dist/scf/agent-scf/node_modules/mysql2/promise'));
  const connection = await mysql.createConnection({ host: config.DB_HOST, port: Number(config.DB_PORT) || 3306, database: config.DB_NAME, user: config.DB_USER, password: config.DB_PASSWORD });
  try {
    await connection.execute(`INSERT INTO ai_usage_daily (openid, usage_date, chat_count, vision_count)
      VALUES (?, ?, 500, 200) ON DUPLICATE KEY UPDATE chat_count = GREATEST(chat_count, 500), vision_count = GREATEST(vision_count, 200)`,
    [openid, shanghaiDateWithOffset(0)]);
  } finally { await connection.end(); }
}

function shanghaiDateWithOffset(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() + Number(offsetDays || 0) * 24 * 60 * 60 * 1000));
}

function withTimeout(promise, milliseconds, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function request(method, requestPath, { token, body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: Number(process.env.LOCAL_PORT || 3000),
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(token ? { 'x-access-token': token } : {})
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (error) { /* 由断言报告 */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${requestPath} timeout`)));
    req.on('error', reject);
    req.end(payload);
  });
}

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  assertionResults.push({ message, status: 'PASS' });
  console.log(`[PASS] ${message}`);
}

function runScopedWechatCli(command) {
  const commandLine = command === 'close'
    ? '& $env:M7_WECHAT_CLI close --project $env:M7_PROJECT_ROOT --lang zh'
    : '& $env:M7_WECHAT_CLI auto --project $env:M7_PROJECT_ROOT --auto-port $env:M7_AUTOMATION_PORT --trust-project --lang zh';
  const result = childProcess.spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', commandLine
  ], {
    env: {
      ...process.env,
      M7_WECHAT_CLI: cliPath,
      M7_PROJECT_ROOT: projectRoot,
      M7_AUTOMATION_PORT: String(automationPort)
    },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000
  });
  automationConnectionEvidence.push({
    command,
    status: result.status,
    signal: result.signal || '',
    error: result.error?.message || '',
    stdout: String(result.stdout || '').trim().slice(-2000),
    stderr: String(result.stderr || '').trim().slice(-2000),
    at: new Date().toISOString()
  });
  return result;
}

function persistAutomationConnectionEvidence() {
  if (!evidenceDir) return;
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, 'devtools-connection-attempts.json'),
    JSON.stringify({ automationPort, projectRoot, attempts: automationConnectionEvidence }, null, 2)
  );
}

function isAutomationPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: automationPort });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForAutomationPort(expectedOpen, timeoutMs = 15000) {
  const startedAt = Date.now();
  do {
    if ((await isAutomationPortOpen()) === expectedOpen) return true;
    await wait(300);
  } while (Date.now() - startedAt < timeoutMs);
  return false;
}

async function closeAutomationProject(label, required = false) {
  const result = runScopedWechatCli('close');
  const portClosed = await waitForAutomationPort(false, 10000);
  Object.assign(automationConnectionEvidence[automationConnectionEvidence.length - 1], { label, portClosed });
  persistAutomationConnectionEvidence();
  if (required && (result.status !== 0 || !portClosed)) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`微信开发者工具未能关闭本验收项目${detail ? `：${detail}` : ''}`);
  }
}

async function connectAutomation(automator) {
  const wsEndpoint = `ws://127.0.0.1:${automationPort}`;
  let lastError = null;
  // CLI 可能复用同一路径下半失效的项目窗口。每个有界 launch cycle 都只关闭
  // 当前验收项目，不 quit IDE、不结束任何无关 DevTools 进程。
  for (let launchCycle = 1; launchCycle <= 3; launchCycle += 1) {
    await closeAutomationProject(`preflight-cycle-${launchCycle}`, launchCycle === 1);
    const launchResult = runScopedWechatCli('auto');
    automationConnectionEvidence[automationConnectionEvidence.length - 1].label = `launch-cycle-${launchCycle}`;
    persistAutomationConnectionEvidence();
    if (launchResult.status !== 0) {
      lastError = new Error(`微信开发者工具自动化启动失败（cycle ${launchCycle}）`);
      continue;
    }
    const portReady = await waitForAutomationPort(true, 15000);
    automationConnectionEvidence.push({
      command: 'listener', label: `cycle-${launchCycle}`,
      status: portReady ? 0 : 1, wsEndpoint, at: new Date().toISOString()
    });
    persistAutomationConnectionEvidence();
    if (!portReady) {
      lastError = new Error(`微信开发者工具自动化端口未就绪（cycle ${launchCycle}）`);
      continue;
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let candidate = null;
      try {
        // DevTools 2.02.2608040 may omit SDKVersion from Tool.getInfo. Read
        // the real SDK from the running app; do not fake/skip the version gate.
        const Launcher = require(path.join(automatorRoot, 'out/Launcher')).default;
        candidate = await withTimeout(new Launcher().connectTool({ wsEndpoint }), 8000, 'automator connect');
        const sdk = await withTimeout(candidate.evaluate(() => wx.getAppBaseInfo().SDKVersion), 8000, 'running SDK version');
        const parts = String(sdk).split('.').map(Number);
        if (!(parts[0] > 3 || parts[0] === 3 && (parts[1] > 7 || parts[1] === 7 && parts[2] >= 11))) {
          throw new Error('内联编辑器验收要求实际基础库 >= 3.7.11，当前为 ' + sdk);
        }
        // 连接成功不代表 App RPC 已可用；首个页面探活失败时必须主动断开，
        // 随后重开 exact project，避免悬挂请求污染下一次连接。
        await withTimeout(candidate.currentPage(), 10000, 'automator first response');
        automationConnectionEvidence.push({
          command: 'probe', label: `cycle-${launchCycle}-attempt-${attempt}`,
          status: 0, wsEndpoint, at: new Date().toISOString()
        });
        persistAutomationConnectionEvidence();
        return candidate;
      } catch (error) {
        lastError = error;
        automationConnectionEvidence.push({
          command: 'probe', label: `cycle-${launchCycle}-attempt-${attempt}`,
          status: 1, wsEndpoint, error: error.message, at: new Date().toISOString()
        });
        persistAutomationConnectionEvidence();
        if (candidate) {
          try { await Promise.resolve(candidate.disconnect()); } catch (disconnectError) { /* 仅释放本轮连接 */ }
        }
        await wait(500);
      }
    }
  }
  await closeAutomationProject('terminal-connect-failure-cleanup', false);
  throw lastError || new Error(`微信开发者工具自动化连接失败：${wsEndpoint}`);
}

async function screenshot(miniProgram, fileName) {
  const output = path.join(evidenceDir, fileName);
  await wait(700);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await miniProgram.screenshot({ path: output });
      console.log(`[EVIDENCE] ${output}`);
      return output;
    } catch (error) {
      lastError = error;
      await wait(700);
    }
  }
  throw lastError;
}

async function waitForData(page, predicate, timeoutMs = 15000) {
  const startedAt = Date.now();
  let data = await page.data();
  while (!predicate(data) && Date.now() - startedAt < timeoutMs) {
    await wait(250);
    data = await page.data();
  }
  if (!predicate(data)) throw new Error(`Page state timeout: ${page.path}`);
  return data;
}

async function waitForPage(miniProgram, expectedPath, timeoutMs = 15000) {
  const startedAt = Date.now();
  let page = await miniProgram.currentPage();
  while (page?.path !== expectedPath && Date.now() - startedAt < timeoutMs) {
    await wait(250);
    page = await miniProgram.currentPage();
  }
  return page;
}

async function reLaunchSafe(miniProgram, route) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await miniProgram.reLaunch(route);
      const expectedPath = route.replace(/^\//, '').split('?')[0];
      for (let read = 0; read < 80; read++) {
        await wait(250);
        const current = await miniProgram.currentPage();
        if (current?.path !== expectedPath) continue;
        const state = await current.data();
        if (state && Object.keys(state).length) return current;
      }
      throw new Error('reLaunch did not produce a mounted page: ' + expectedPath);
    } catch (error) {
      lastError = error;
      await wait(1000);
    }
  }
  throw lastError;
}

function lastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

async function switchConversation(page, sessionId, timeoutMs = 15000) {
  const before = await page.data();
  const index = (before.conversations || []).findIndex((item) => item.sessionId === sessionId);
  if (index < 0) throw new Error(`找不到待切换会话：${sessionId}`);
  if (before.activeSessionId !== sessionId) {
    await page.callMethod('onConversationChange', { detail: { value: String(index) } });
  }
  return waitForData(
    page,
    (value) => !value.loadingSession && value.activeSessionId === sessionId,
    timeoutMs
  );
}

async function miniProgramFilesExist(miniProgram, paths = []) {
  return miniProgram.evaluate(function checkFiles(inputPaths) {
    const fileSystem = wx.getFileSystemManager();
    return inputPaths.map((filePath) => {
      try {
        fileSystem.accessSync(filePath);
        return true;
      } catch (error) {
        return false;
      }
    });
  }, paths);
}

async function tapSend(page) {
  await waitForData(page, data => !data.composerBusy, 5000);
  const previous = (await page.data()).messages.filter(item => item.role === 'user').length;
  await (await page.$('.send-fab')).tap();
  // Flushing the native editor is async: !sending alone may still describe the previous turn.
  await waitForData(page, data => data.sending || data.messages.filter(item => item.role === 'user').length > previous, 10000);
}

async function verifyFunctionChip(miniProgram, page, screenshots) {
  await page.callMethod('onInput', { detail: { value: '只看最近一周' } });
  await (await page.$('.input-side-button')).tap();
  await waitForData(page, (value) => value.attachmentMenuOpen && value.attachmentMenuView === 'root', 3000);
  await page.callMethod('showFunctionChoices');
  await withTimeout(page.waitFor('.function-menu-item'), 5000, '功能菜单渲染');
  await (await page.$('.function-menu-item')).tap();
  let data;
  try { data = await waitForData(page, (value) => value.selectedFunction?.key === 'plant_status', 5000); }
  catch (error) {
    error.detail = await miniProgram.evaluate(() => {
      const c = getCurrentPages().at(-1).selectComponent('#conversation-composer');
      return { blocks: c.data.blocks, key: c._lastKey };
    });
    throw error;
  }
  assert(data.selectedFunction?.key === 'plant_status' && data.inputValue === '只看最近一周',
    '选择功能只添加标签，不覆盖用户文字');
  await waitForData(page, value => !value.composerBusy, 5000);
  assert(!(await page.$$('.inline-function')).length, '不再在编辑器外重复呈现功能标签');
  screenshots.push(await screenshot(miniProgram, '02c-inline-function-with-text.png'));
  const doc = await miniProgram.evaluate(() => new Promise(resolve => {
    const c = getCurrentPages().at(-1).selectComponent('#conversation-composer');
    c._editor.getContents({ success: resolve });
  }));
  assert(doc.delta.ops.some(op => typeof op.insert === 'object'), '功能确实是原生编辑文档中的区块，不是 textarea 外面的标签', doc);
  assert(doc.delta.ops.filter(op => typeof op.insert === 'object').length === 1, '编辑文档中只有一个原子功能块');
  const token = doc.delta.ops.find(op => typeof op.insert === 'object');
  assert(parseFloat(token.attributes?.height) <= 24 && parseFloat(token.attributes?.width) <= 120, '内联功能尺寸与文字相称，不撑开一整行', token.attributes);
  if (process.env.M7_COMPOSER_CURSOR_TEST === '1') {
    const result = await require('./devtools-composer-caret').run(miniProgram, assert,
      async name => screenshots.push(await screenshot(miniProgram, name)));
    fs.writeFileSync(path.join(evidenceDir, 'composer-caret-native-events.json'), JSON.stringify(result, null, 2));
    await page.callMethod('onInput', { detail: { value: '只看最近一周' } });
  } else if (process.env.M7_NATIVE_KEY_TEST === '1') {
    await require('./devtools-composer-keys').run(miniProgram, page, assert, async name => screenshots.push(await screenshot(miniProgram, name)));
    await page.callMethod('onInput', { detail: { value: '只看最近一周' } });
  } else {
  await miniProgram.evaluate(() => new Promise(resolve => {
    const c = getCurrentPages().at(-1).selectComponent('#conversation-composer');
    c._editor.getContents({ success: result => {
      let index = 0;
      for (const op of result.delta.ops) {
        if (typeof op.insert === 'object') { c._editor.deleteText({ index, length: 1, success: () => c.flush().then(resolve) }); return; }
        index += op.insert.length;
      }
      resolve();
    } });
  }));
  }
  data = await waitForData(page, (value) => !value.selectedFunction, 3000);
  assert(!data.selectedFunction && data.inputValue === '只看最近一周', '移除功能不留下模板提示词，也不删除用户文字', { text: data.inputValue, key: data.selectedFunction?.key });
  await page.callMethod('onInput', { detail: { value: '' } });
  assert(!(await page.data()).canSend, '清空文字后空草稿不能发送');
}

async function verifyEmptyGardenComposer(miniProgram, screenshots) {
  let page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
  let data = await waitForData(page, (value) => !value.loadingSession && value.activeSessionId, 15000);
  assert(!data.selectedPlantPet && data.plantPets.length === 0, '无植宠也有独立的全局会话');
  await verifyFunctionChip(miniProgram, page, screenshots);
  if (process.env.M7_COMPOSER_ONLY === '1') return;
  const roseBase64 = fs.readFileSync(rosePath).toString('base64');
  await miniProgram.evaluate(function prepareComposerFixtures(base64) {
    const image = `${wx.env.USER_DATA_PATH}/m7-composer-rose.jpg`;
    const document = `${wx.env.USER_DATA_PATH}/m7-composer-notes.md`;
    const fileSystem = wx.getFileSystemManager();
    fileSystem.writeFileSync(image, base64, 'base64');
    fileSystem.writeFileSync(document, '# 月季观察\n今天看到红色花瓣。花盆标签写着“青石”。只整理记录，不安排任务。', 'utf8');
    getApp().globalData.__m7ComposerFixture = {
      image, document,
      imageSize: fileSystem.statSync(image).size,
      documentSize: fileSystem.statSync(document).size
    };
    getApp().globalData.__m7ComposerNoticeCount = 0;
    getApp().globalData.__m7ComposerNotices = [];
  }, roseBase64);
  await miniProgram.mockWxMethod('showModal', function acceptComposerNotice(options) {
    getApp().globalData.__m7ComposerNoticeCount += 1;
    getApp().globalData.__m7ComposerNotices.push({ title: options.title, content: options.content });
    const result = { confirm: true, cancel: false };
    if (options && options.success) options.success(result);
    if (options && options.complete) options.complete(result);
    return result;
  });
  try {
    for (const kind of ['image', 'document']) {
      const api = kind === 'image' ? 'chooseMedia' : 'chooseMessageFile';
      // 开发工具的 mock 默认不模拟生命周期；这里特意补上原生选择器的 hide/show。
      await miniProgram.mockWxMethod(api, function pickWithNativeLifecycle(options) {
        const pages = getCurrentPages();
        const current = pages[pages.length - 1];
        const fixture = getApp().globalData.__m7ComposerFixture;
        const isImage = Array.isArray(options.mediaType);
        current.onHide();
        current.onShow();
        const result = { tempFiles: [{
          tempFilePath: fixture.image, path: fixture.document, name: '月季观察.md',
          size: isImage ? fixture.imageSize : fixture.documentSize, fileType: 'image'
        }] };
        if (options && options.success) options.success(result);
        if (options && options.complete) options.complete(result);
        return result;
      });
      await (await page.$('.input-side-button')).tap();
      await waitForData(page, (value) => value.attachmentMenuOpen && value.attachmentMenuView === 'root', 3000);
      await page.callMethod('showAttachmentChoices');
      await waitForData(page, (value) => value.attachmentMenuView === 'attachment', 3000);
      await withTimeout(page.waitFor('.attachment-menu-item[data-source="album"]'), 5000, '附件菜单渲染');
      const items = await page.$$('.attachment-menu-item');
      await items[kind === 'image' ? 1 : 2].tap();
      data = await waitForData(page, (value) => Boolean(kind === 'image' ? value.pendingImage : value.pendingDocument), 6000);
      await miniProgram.restoreWxMethod(api);
      if (!(kind === 'image' ? data.pendingImage : data.pendingDocument)) {
        screenshots.push(await screenshot(miniProgram, `02a-global-${kind}-failed.png`));
        console.error('[COMPOSER] ' + JSON.stringify(await miniProgram.evaluate(() => {
          const current = getCurrentPages().slice(-1)[0];
          return {
            notices: getApp().globalData.__m7ComposerNotices,
            selecting: Boolean(current._attachmentSelection),
            hidden: Boolean(current._assistantHidden),
            unmounted: Boolean(current._assistantUnmounted),
            loading: current.data.loadingSession,
            menu: current.data.attachmentMenuView,
            payloadReady: Boolean(current._pendingVisionPayload)
          };
        })));
      }
      assert(Boolean(kind === 'image' ? data.pendingImage : data.pendingDocument) && !data.sending,
        `无植宠 ${kind} 经选择器隐藏/返回后可见，且未自动发送`);
      await page.callMethod('onInput', { detail: { value: kind === 'image'
        ? '这是什么，只介绍，不安排任务'
        : '总结这份文档，告诉我花盆标签写着什么，只介绍，不安排任务' } });
      screenshots.push(await screenshot(miniProgram, `02a-global-${kind}-draft.png`));
      // 触发真实页面发送，但不让自动化 RPC 等待整个模型请求。
      await miniProgram.evaluate(function sendComposerAttachment() {
        getCurrentPages().slice(-1)[0].sendMessage();
        return true;
      });
      const messageCountBeforeSend = data.messages.length;
      data = await waitForData(page, (value) => !value.sending && value.messages.length > messageCountBeforeSend
        && !value.messages[value.messages.length - 1]?.loading, 60000);
      const answer = [...data.messages].reverse().find((item) => kind === 'image' ? item.visionResult : item.documentAnalysis);
      if (!answer?.backendId) screenshots.push(await screenshot(miniProgram, `02b-global-${kind}-analysis-failed.png`));
      assert(Boolean(answer?.backendId) && !(answer.taskSuggestions || []).length,
        `无植宠 ${kind} 可真实分析、保存回答，且不生成任务`, {
          sending: data.sending, documentBusy: data.documentBusy,
          lastReply: [...data.messages].reverse().find((item) => item.role === 'assistant')?.text,
          notices: await miniProgram.evaluate(() => getApp().globalData.__m7ComposerNotices)
        });
      const sessionId = data.activeSessionId;
      if (kind === 'document') {
        assert(/青石/.test(answer.text) && !/从图片|图中可以看/.test(answer.text), '文档回答引用本轮独有事实，不沿用上一张图片的描述', answer.text);
      }
      const answerId = answer.backendId;
      page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
      data = await waitForData(page, (value) => !value.loadingSession && value.activeSessionId === sessionId, 20000);
      const restoredInput = [...data.messages].reverse().find((item) =>
        kind === 'image' ? item.role === 'user' && item.visionInput : item.documentInput);
      assert(data.messages.some((item) => item.backendId === answerId)
        && Boolean(kind === 'image' ? restoredInput?.imagePreview : restoredInput?.documentAttachment?.originalPersisted),
      `无植宠 ${kind} 重开页面后附件和回答仍在`);
      screenshots.push(await screenshot(miniProgram, `02b-global-${kind}-restored.png`));
    }
    const noticeCount = await miniProgram.evaluate(() => getApp().globalData.__m7ComposerNoticeCount);
    assert(noticeCount === 2, '无植宠两种附件各确认一次，没有重复弹窗');
  } finally {
    for (const api of ['chooseMedia', 'chooseMessageFile', 'showModal']) {
      await miniProgram.restoreWxMethod(api);
    }
    // 仅重置本次隔离账号的通知状态，让后续既有“首次确认”用例从未确认状态开始。
    await miniProgram.evaluate(key => wx.removeStorageSync(key), 'nvp_vision_notice_ack_v2');
    await miniProgram.evaluate(key => wx.removeStorageSync(key), 'nvp_document_notice_ack_v1');
  }
}

(async () => {
  assert(expectedOpenid.startsWith('m7_devtools_'), 'M7 使用独立本地登录身份，避免触碰既有验收数据', { expectedOpenid });
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  assert(fs.existsSync(rosePath), '找到已知月季验收图片', { rosePath });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  let miniProgram = null;
  let originalStorage = null;
  let token = '';
  let plantPetId = 0;
  const exceptions = [];
  const screenshots = [];
  const performance = {};
  const steps = [];

  try {
    miniProgram = await connectAutomation(automator);
    originalStorage = await miniProgram.evaluate(captureStorage);
    if (!Array.isArray(originalStorage)) throw new Error('未能保留原有开发者工具缓存，停止验收');
    await wait(1200);
    miniProgram.on('exception', (error) => exceptions.push(String(error?.message || error)));
    let page = await reLaunchSafe(miniProgram, '/pages/auth/auth');
    await page.waitFor(700);
    await miniProgram.evaluate(() => wx.clearStorageSync());
    await miniProgram.evaluate(function clearAppLogin() {
      const app = getApp();
      if (typeof app.clearLoginState === 'function') app.clearLoginState();
    });

    page = await reLaunchSafe(miniProgram, '/pages/auth/auth');
    await page.waitFor(700);
    let data = await page.data();
    assert(page.path === 'pages/auth/auth' && data.loginState === 'choose', '从无登录态的登录页开始完整流程', data);
    screenshots.push(await screenshot(miniProgram, '01-login-page.png'));
    steps.push({ step: 1, name: '登录页', health: 'pass' });

    page = await waitForPage(miniProgram, 'pages/auth/auth', 15000);
    await withTimeout(page.waitFor('.wechat-login-btn'), 10000, '登录按钮完成视图层挂载');
    const loginButton = await page.$('.wechat-login-btn');
    await loginButton.tap();
    data = await waitForData(page, (value) => value.loginState === 'wechat-profile', 15000);
    token = await miniProgram.evaluate(key => wx.getStorageSync(key), 'apiAccessToken');
    const tokenMeta = await miniProgram.evaluate(key => wx.getStorageSync(key), 'apiAccessTokenMeta');
    await seedHighUsageFixture(tokenMeta?.openid);
    assert(data.loginState === 'wechat-profile' && token && tokenMeta?.openid === expectedOpenid, '真实按钮完成 wx.login、/auth/login 和 JWT 落盘', { data, tokenMeta });

    const avatarBase64 = fs.readFileSync(path.join(projectRoot, 'images', 'plant-default.jpg')).toString('base64');
    const tempAvatarPath = await miniProgram.evaluate(function writeAvatar(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m7-avatar.jpg`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, avatarBase64);
    await page.callMethod('onChooseAvatar', { detail: { avatarUrl: tempAvatarPath } });
    await page.callMethod('onNickNameChange', { detail: { value: 'M7 验收用户' } });
    data = await page.data();
    assert(data.canSave === true, '登录页资料可保存并继续进入花园', data.userInfo);

    const enterStartedAt = Date.now();
    const enterButton = await page.$('.login-btn');
    await enterButton.tap();
    page = await waitForPage(miniProgram, 'pages/index/index', 15000);
    data = await waitForData(page, (value) => !value.loading, 15000);
    performance.loginToHomeReadyMs = Date.now() - enterStartedAt;
    assert(data.loadError === '' && data.activePets.length === 0, '隔离账号首页呈现真实空花园', data);
    screenshots.push(await screenshot(miniProgram, '02-empty-home.png'));
    steps.push({ step: 2, name: '首页真实空状态', health: 'pass' });

    await verifyEmptyGardenComposer(miniProgram, screenshots);
    if (process.env.M7_COMPOSER_ONLY === '1') {
      assert(exceptions.length === 0, '输入框专项没有页面运行时异常', exceptions);
      fs.writeFileSync(path.join(evidenceDir, 'm7-composer-result.json'), JSON.stringify({
        status: 'PASS', scope: 'native composer only; not full M7 acceptance', assertions: assertionResults, screenshots, exceptions
      }, null, 2));
      return;
    }
    steps.push({ name: '无植宠附件生命周期与功能标签', health: 'pass' });

    const warmHomeStartedAt = Date.now();
    page = await reLaunchSafe(miniProgram, '/pages/index/index');
    data = await waitForData(page, (value) => !value.loading, 10000);
    performance.devtoolsWarmHomeNavigationMs = Date.now() - warmHomeStartedAt;
    const homeRefreshStartedAt = Date.now();
    await page.callMethod('loadPlantPets');
    data = await waitForData(page, (value) => !value.loading, 5000);
    performance.homeBusinessRefreshMs = Date.now() - homeRefreshStartedAt;
    assert(
      performance.homeBusinessRefreshMs < 2000,
      '页面已编译后，首页植宠与任务业务数据在 2 秒内完成刷新',
      performance
    );

    await miniProgram.mockWxMethod('showActionSheet', { tapIndex: 1 });
    const addButton = await page.$('.add-fab');
    await addButton.tap();
    page = await waitForPage(miniProgram, 'pages/plantPetForm/plantPetForm', 10000);
    await miniProgram.restoreWxMethod('showActionSheet');
    data = await waitForData(page, (value) => !value.loading, 10000);
    assert(data.loadError === '' && data.mode === 'create', '首页添加入口明确选择手动建档路径', data);

    const roseBase64 = fs.readFileSync(rosePath).toString('base64');
    const roseSize = Buffer.byteLength(roseBase64, 'base64');
    const tempRosePath = await miniProgram.evaluate(function writeRose(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m7-known-rose`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, roseBase64);
    await miniProgram.evaluate(function saveCoverFixture(filePath) {
      getApp().globalData.__m7CoverFixture = filePath;
    }, tempRosePath);
    await miniProgram.mockWxMethod('chooseImage', function chooseImage(options) {
      const result = { tempFilePaths: [getApp().globalData.__m7CoverFixture] };
      if (options && typeof options.success === 'function') options.success(result);
      if (options && typeof options.complete === 'function') options.complete(result);
      return result;
    });
    const coverPicker = await page.$('.cover-picker');
    await coverPicker.tap();
    data = await waitForData(page, (value) => value.coverPreview === tempRosePath, 3000);
    await miniProgram.restoreWxMethod('chooseImage');
    assert(data.coverChanged === true && data.coverPreview === tempRosePath, '原生相册选择结果进入封面草稿', { coverChanged: data.coverChanged, coverPreview: data.coverPreview });
    const roseSpecies = data.speciesList.find((item) => item.name === '月季');
    assert(roseSpecies?.id, '已发布植物库包含月季建档选项', data.speciesList);
    await page.callMethod('onSelectSpecies', { currentTarget: { dataset: { id: roseSpecies.id } } });
    await page.callMethod('onNicknameInput', { detail: { value: 'M7 南窗月季' } });
    await page.callMethod('onLocationInput', { detail: { value: '南窗台' } });
    await page.callMethod('onCareNotesInput', { detail: { value: 'M7 完整闭环验收样本' } });
    data = await page.data();
    assert(data.coverChanged === true && data.coverPreview === tempRosePath, '选择品种后仍保留用户刚选的自定义封面', { coverChanged: data.coverChanged, coverPreview: data.coverPreview });
    screenshots.push(await screenshot(miniProgram, '03-manual-pet-form-with-cover.png'));

    const submitButton = await page.$('.submit-btn');
    await submitButton.tap();
    page = await waitForPage(miniProgram, 'pages/plantPetDetail/plantPetDetail', 20000);
    data = await waitForData(page, (value) => !value.loading, 10000);
    plantPetId = Number(data.pet?.id) || 0;
    assert(plantPetId > 0 && data.pet?.nickname === 'M7 南窗月季' && data.pet?.coverFileId, '手动档案、月季品种与持久封面在详情页闭合', data.pet);
    screenshots.push(await screenshot(miniProgram, '04-pet-detail-after-create.png'));
    steps.push({ step: 3, name: '手动建档与封面', health: 'pass' });

    page = await miniProgram.switchTab('/pages/index/index');
    data = await waitForData(page, (value) => !value.loading && value.activePets.some((item) => item.id === plantPetId), 10000);
    await miniProgram.mockWxMethod('showActionSheet', { tapIndex: 0 });
    await page.callMethod('addPlantPet');
    page = await waitForPage(miniProgram, 'pages/assistant/assistant', 15000);
    await miniProgram.restoreWxMethod('showActionSheet');
    data = await waitForData(page, (value) => !value.loadingSession && value.attachmentMenuOpen && value.attachmentMenuView === 'attachment', 15000);
    assert(data.selectedPlantPet?.id === plantPetId, '首页拍照辅助建档入口复用 AI 附件链并绑定当前月季', data.selectedPlantPet);
    const quotaBadge = await page.$('.assistant-status-badge');
    const quotaBadgeText = quotaBadge ? await quotaBadge.text() : '';
    assert(
      data.quota?.unlimited === true && data.quota?.chat?.used >= 500 && data.quota?.vision?.used >= 200 &&
        data.quota?.chat?.limit === null && data.quota?.chat?.remaining === null &&
        data.quota?.vision?.limit === null && data.quota?.vision?.remaining === null &&
        quotaBadgeText.includes('Chat ∞') && quotaBadgeText.includes('图 ∞'),
      '高使用计数账号在 DevTools 中仍显示 Chat 与 Vision 无限额度徽标',
      { quota: data.quota, quotaBadgeText }
    );
    screenshots.push(await screenshot(miniProgram, '05-photo-add-entry-menu.png'));

    await miniProgram.mockWxMethod('chooseMedia', {
      tempFiles: [{ tempFilePath: tempRosePath, size: roseSize, fileType: 'image' }]
    });
    let attachmentItems = await page.$$('.attachment-menu-item');
    await attachmentItems[1].tap();
    data = await waitForData(page, (value) => Boolean(value.pendingImage), 5000);
    await miniProgram.restoreWxMethod('chooseMedia');
    await page.callMethod('onInput', { detail: { value: '请识别这盆植物并观察当前状态，不要创建任务。' } });
    screenshots.push(await screenshot(miniProgram, '06-image-and-text-draft.png'));
    assert(data.pendingImage && !data.visionBusy, '选图只进入可继续配文的草稿，不会提前调用 Vision', data.pendingImage);

    await miniProgram.evaluate(function resetVisionPrivacyCounter() {
      getApp().globalData.__m7VisionPrivacyModalCount = 0;
    });
    await miniProgram.mockWxMethod('showModal', function confirmVisionPrivacy(options) {
      if (String(options && options.title || '').includes('图片将交由第三方 AI 处理')) {
        getApp().globalData.__m7VisionPrivacyModalCount += 1;
      }
      const result = { confirm: true, cancel: false };
      if (options && typeof options.success === 'function') options.success(result);
      if (options && typeof options.complete === 'function') options.complete(result);
      return result;
    });
    const visionStartedAt = Date.now();
    await tapSend(page);
    const progressive = await waitForData(page, (value) => value.sending && value.messages.some((item) => item.loading), 1500);
    performance.visionFirstFeedbackMs = Date.now() - visionStartedAt;
    assert(progressive.sending && progressive.messages.some((item) => item.loading), '图片分析在 1.5 秒内给出等效渐进反馈', performance);
    data = await waitForData(page, (value) => !value.visionBusy && value.messages.some((item) => item.visionResult), 60000);
    performance.visionTotalMs = Date.now() - visionStartedAt;
    const firstVisionPrivacyCount = await miniProgram.evaluate(function getVisionPrivacyCount() {
      return getApp().globalData.__m7VisionPrivacyModalCount;
    });
    await page.callMethod('ensureVisionNotice');
    const persistedVisionNotice = await miniProgram.evaluate(key => wx.getStorageSync(key), 'nvp_vision_notice_ack_v2');
    const repeatedVisionPrivacyCount = await miniProgram.evaluate(function getVisionPrivacyCountAfterRepeat() {
      return getApp().globalData.__m7VisionPrivacyModalCount;
    });
    await miniProgram.restoreWxMethod('showModal');
    assert(
      persistedVisionNotice?.version === 2 && Number(persistedVisionNotice.acceptedAt) > 0 &&
        firstVisionPrivacyCount === 1 && repeatedVisionPrivacyCount === 1,
      '同一隐私说明版本内，图片第三方处理确认只在首次发送前出现一次',
      { persistedVisionNotice, firstVisionPrivacyCount, repeatedVisionPrivacyCount }
    );
    const visionMessageIndex = lastIndex(data.messages, (item) => item.role === 'assistant' && item.visionResult);
    const visionMessage = data.messages[visionMessageIndex];
    assert(
      visionMessage?.visionResult?.isPlant &&
        visionMessage.visionResult.candidates?.some((item) => /月季|玫瑰|蔷薇/.test(item.name)) &&
        visionMessage.taskSuggestions.length === 0,
      '真实图片识别月季，明确“不要创建任务”不会误生成 tool call 候选',
      visionMessage
    );
    screenshots.push(await screenshot(miniProgram, '07-vision-result-no-task.png'));
    await page.callMethod('saveVisionDiagnosis', { currentTarget: { dataset: { messageIndex: visionMessageIndex } } });
    data = await waitForData(page, (value) => !value.savingDiagnosis && value.messages[visionMessageIndex]?.diagnosisSaved, 20000);
    assert(data.messages[visionMessageIndex].diagnosisSaved, '用户主动确认后把图片观察另存到当前植宠', data.messages[visionMessageIndex]);
    const visionSessionId = data.activeSessionId;
    const persistedVisionAssistantId = Number(data.messages[visionMessageIndex]?.backendId) || 0;
    const liveVisionUser = [...data.messages].reverse().find((item) => item.role === 'user' && item.visionInput);
    const persistedVisionUserId = Number(liveVisionUser?.backendId) || 0;
    const persistedVisionMediaFileId = String(data.messages[visionMessageIndex]?.visionMediaFileId || '');
    assert(
      persistedVisionAssistantId > 0 && persistedVisionUserId > 0 && persistedVisionMediaFileId &&
        liveVisionUser?.visionMediaFileId === persistedVisionMediaFileId,
      '发送完成时图文用户消息与 Vision 回答共享非空持久媒体标识',
      { persistedVisionUserId, persistedVisionAssistantId, persistedVisionMediaFileId }
    );
    page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
    data = await waitForData(
      page,
      (value) => !value.loadingSession && value.activeSessionId === visionSessionId &&
        value.messages.some((item) => item.backendId === persistedVisionUserId && item.visionInput) &&
        value.messages.some((item) => item.backendId === persistedVisionAssistantId && item.visionResult),
      20000
    );
    const restoredVisionUser = data.messages.find((item) => item.backendId === persistedVisionUserId);
    const restoredVisionAssistant = data.messages.find((item) => item.backendId === persistedVisionAssistantId);
    const restoredPreviewFiles = await miniProgramFilesExist(miniProgram, [
      restoredVisionUser?.imagePreview || '',
      restoredVisionAssistant?.visionPreview || ''
    ]);
    assert(
      restoredVisionUser?.visionMediaFileId === persistedVisionMediaFileId &&
        restoredVisionAssistant?.visionMediaFileId === persistedVisionMediaFileId &&
        restoredVisionUser?.imageOriginalUnavailable === false &&
        restoredVisionAssistant?.visionOriginalUnavailable === false &&
        restoredVisionUser?.imagePreview && restoredVisionAssistant?.visionPreview &&
        restoredPreviewFiles.every(Boolean),
      'reLaunch 后图文轮次、共享 fileId、原件可用状态与可读取预览全部恢复',
      { restoredVisionUser, restoredVisionAssistant, restoredPreviewFiles }
    );
    screenshots.push(await screenshot(miniProgram, '07a-vision-restored-after-relaunch.png'));
    steps.push({ step: 4, name: '图片分析与观察保存', health: 'pass' });

    const documentText = [
      '# M7 月季养护记录',
      '',
      '月季位于南窗台。浇水前检查表层下约 2 厘米，干燥后再浇透，并避免盆底长期积水。'
    ].join('\n');
    const documentBase64 = Buffer.from(documentText, 'utf8').toString('base64');
    const documentSize = Buffer.byteLength(documentText, 'utf8');
    const tempDocumentPath = await miniProgram.evaluate(function writeDocument(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m7-rose-care.md`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, documentBase64);
    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => value.attachmentMenuOpen && value.attachmentMenuView === 'root', 5000);
    await page.callMethod('showAttachmentChoices');
    data = await waitForData(page, (value) => value.attachmentMenuOpen && value.attachmentMenuView === 'attachment', 5000);
    await miniProgram.mockWxMethod('chooseMessageFile', {
      tempFiles: [{ path: tempDocumentPath, name: 'm7-rose-care.md', size: documentSize }]
    });
    attachmentItems = await page.$$('.attachment-menu-item');
    assert(attachmentItems.length >= 3, '附件菜单保留拍照、相册和文档三个真实入口', { count: attachmentItems.length });
    await attachmentItems[2].tap();
    data = await waitForData(page, (value) => Boolean(value.pendingDocument), 5000);
    await miniProgram.restoreWxMethod('chooseMessageFile');
    const messagesBeforeDocumentSend = data.messages.length;
    const documentQuestion = '请总结文档中关于月季浇水判断的建议，并明确这是文档提供的信息。';
    await page.callMethod('onInput', { detail: { value: documentQuestion } });
    data = await page.data();
    assert(
      data.pendingDocument?.name === 'm7-rose-care.md' && data.inputValue === documentQuestion &&
        data.canSend === true && data.documentBusy === false && data.messages.length === messagesBeforeDocumentSend,
      '选择文档后只进入草稿，用户可继续补充文字且不会提前分析',
      { pendingDocument: data.pendingDocument, inputValue: data.inputValue, documentBusy: data.documentBusy }
    );
    screenshots.push(await screenshot(miniProgram, '07a-document-and-text-draft.png'));
    await miniProgram.evaluate(function resetDocumentPrivacyCounter() {
      getApp().globalData.__m7DocumentPrivacyModalCount = 0;
    });
    await miniProgram.mockWxMethod('showModal', function confirmDocumentPrivacy(options) {
      if (String(options && options.title || '').includes('文档将交由第三方 AI 处理')) {
        getApp().globalData.__m7DocumentPrivacyModalCount += 1;
      }
      const result = { confirm: true, cancel: false };
      if (options && typeof options.success === 'function') options.success(result);
      if (options && typeof options.complete === 'function') options.complete(result);
      return result;
    });
    const documentStartedAt = Date.now();
    await tapSend(page);
    const documentProgressive = await waitForData(
      page,
      (value) => value.sending && value.documentBusy && value.messages.some((item) => item.loading),
      1500
    );
    performance.documentFirstFeedbackMs = Date.now() - documentStartedAt;
    assert(
      documentProgressive.sending && documentProgressive.documentBusy &&
        documentProgressive.messages.some((item) => item.loading),
      '文档分析在 1.5 秒内给出等效渐进反馈',
      performance
    );
    data = await waitForData(
      page,
      (value) => !value.documentBusy && value.messages.some((item) => item.documentAnalysis),
      60000
    );
    performance.documentTotalMs = Date.now() - documentStartedAt;
    const firstDocumentPrivacyCount = await miniProgram.evaluate(function getDocumentPrivacyCount() {
      return getApp().globalData.__m7DocumentPrivacyModalCount;
    });
    await page.callMethod('ensureDocumentNotice');
    const persistedDocumentNotice = await miniProgram.evaluate(key => wx.getStorageSync(key), 'nvp_document_notice_ack_v1');
    const repeatedDocumentPrivacyCount = await miniProgram.evaluate(function getDocumentPrivacyCountAfterRepeat() {
      return getApp().globalData.__m7DocumentPrivacyModalCount;
    });
    await miniProgram.restoreWxMethod('showModal');
    assert(
      persistedDocumentNotice?.version === 1 && Number(persistedDocumentNotice.acceptedAt) > 0 &&
        firstDocumentPrivacyCount === 1 && repeatedDocumentPrivacyCount === 1,
      '同一隐私说明版本内，文档第三方处理确认只在首次发送前出现一次',
      { persistedDocumentNotice, firstDocumentPrivacyCount, repeatedDocumentPrivacyCount }
    );
    const documentUserMessage = [...data.messages].reverse().find((item) => item.role === 'user' && item.documentInput);
    const documentAssistantMessage = [...data.messages].reverse().find((item) => item.role === 'assistant' && item.documentAnalysis);
    assert(
      documentUserMessage?.backendId > 0 && documentUserMessage.text === documentQuestion &&
        documentUserMessage.documentAttachment?.originalPersisted === true &&
        documentUserMessage.documentAttachment?.originalName === 'm7-rose-care.md' &&
        documentAssistantMessage?.backendId > 0 && documentAssistantMessage.text?.trim() &&
        documentAssistantMessage.documentAttachment?.originalPersisted === true,
      '文档与补充文字一并发送，真实分析完成后原件和消息均标记为已保存',
      { documentUserMessage, documentAssistantMessage }
    );
    const documentSessionId = data.activeSessionId;
    screenshots.push(await screenshot(miniProgram, '07b-document-analysis-result.png'));
    page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
    data = await waitForData(
      page,
      (value) => !value.loadingSession && value.activeSessionId === documentSessionId &&
        value.messages.some((item) => item.documentInput) && value.messages.some((item) => item.documentAnalysis),
      20000
    );
    const restoredDocumentUser = [...data.messages].reverse().find((item) => item.role === 'user' && item.documentInput);
    const restoredDocumentAssistant = [...data.messages].reverse().find((item) => item.role === 'assistant' && item.documentAnalysis);
    assert(
      data.activeSessionId === documentSessionId && restoredDocumentUser?.backendId === documentUserMessage.backendId &&
        restoredDocumentUser.documentAttachment?.originalPersisted === true &&
        restoredDocumentAssistant?.backendId === documentAssistantMessage.backendId &&
        restoredDocumentAssistant.documentAttachment?.originalPersisted === true,
      '重新加载 AI 助手后仍恢复文档附件、补充问题和分析回答',
      { activeSessionId: data.activeSessionId, restoredDocumentUser, restoredDocumentAssistant }
    );
    screenshots.push(await screenshot(miniProgram, '07c-document-restored-after-reload.png'));
    steps.push({ step: 5, name: '文档草稿、分析与重开恢复', health: 'pass' });

    // 同一植宠多会话隔离：S1 已带图片和文档，S2 独立发送另一标记。
    const sessionOneId = data.activeSessionId;
    const sessionOneMarker = `M7S1-${Date.now()}`;
    const sessionOneText = `本轮临时代号是 ${sessionOneMarker}，请只回复收到。`;
    await page.callMethod('onInput', { detail: { value: sessionOneText } });
    await tapSend(page);
    data = await waitForData(
      page,
      (value) => !value.sending && value.messages.some((item) => item.role === 'user' && item.text === sessionOneText),
      60000
    );
    const sessionOneUser = [...data.messages].reverse().find((item) => item.role === 'user' && item.text === sessionOneText);
    assert(sessionOneUser?.backendId > 0, 'S1 在带图片与文档的会话中持久化独特标记', sessionOneUser);

    await page.callMethod('createNewConversation');
    data = await waitForData(
      page,
      (value) => !value.loadingSession && value.activeSessionId && value.activeSessionId !== sessionOneId,
      15000
    );
    const sessionTwoId = data.activeSessionId;
    const sessionTwoMarker = `M7S2-${Date.now()}`;
    const sessionTwoText = `本轮临时代号是 ${sessionTwoMarker}，请只回复收到。`;
    await page.callMethod('onInput', { detail: { value: sessionTwoText } });
    await tapSend(page);
    data = await waitForData(
      page,
      (value) => !value.sending && value.messages.some((item) => item.role === 'user' && item.text === sessionTwoText),
      60000
    );
    const sessionTwoUser = [...data.messages].reverse().find((item) => item.role === 'user' && item.text === sessionTwoText);
    assert(sessionTwoUser?.backendId > 0, 'S2 在新会话中持久化另一独特标记', sessionTwoUser);

    data = await switchConversation(page, sessionOneId);
    assert(
      data.messages.some((item) => item.text === sessionOneText) &&
        !data.messages.some((item) => item.text === sessionTwoText) &&
        data.messages.some((item) => item.visionInput) && data.messages.some((item) => item.documentInput),
      '从 S2 切回 S1 时只恢复 S1 标记及其图片/文档历史',
      { activeSessionId: data.activeSessionId, messages: data.messages }
    );
    data = await switchConversation(page, sessionTwoId);
    assert(
      data.messages.some((item) => item.text === sessionTwoText) &&
        !data.messages.some((item) => item.text === sessionOneText) &&
        !data.messages.some((item) => item.visionInput || item.documentInput),
      '从 S1 切到 S2 时不串入 S1 标记或附件历史',
      { activeSessionId: data.activeSessionId, messages: data.messages }
    );
    screenshots.push(await screenshot(miniProgram, '07d-session-two-isolated.png'));
    page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
    data = await waitForData(
      page,
      (value) => !value.loadingSession && value.activeSessionId === sessionTwoId &&
        value.messages.some((item) => item.text === sessionTwoText),
      20000
    );
    assert(
      data.activeSessionId === sessionTwoId && data.messages.some((item) => item.text === sessionTwoText) &&
        !data.messages.some((item) => item.text === sessionOneText),
      'reLaunch 后恢复用户最后选择的活跃会话 S2，且历史仍不串线',
      { activeSessionId: data.activeSessionId, messages: data.messages }
    );
    data = await switchConversation(page, sessionOneId);
    assert(
      data.activeSessionId === sessionOneId && data.messages.some((item) => item.text === sessionOneText) &&
        !data.messages.some((item) => item.text === sessionTwoText),
      '继续验收前双向切回 S1，活跃会话与历史保持一致',
      { activeSessionId: data.activeSessionId, messages: data.messages }
    );
    steps.push({ step: '5b', name: '同植宠双会话隔离与重开恢复', health: 'pass' });

    const tasksBeforeProposal = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    const taskCountBeforeProposal = (tasksBeforeProposal.json?.tasks || []).length;

    const cancellableTaskText = '请帮我安排一个今天检查月季盆土的任务。';
    await page.callMethod('onInput', { detail: { value: cancellableTaskText } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'assistant' && item.taskSuggestions?.some((suggestion) => suggestion.status === 'pending')
    ), 60000);
    const cancellableTaskMessageIndex = lastIndex(data.messages, (item) =>
      item.role === 'assistant' && item.taskSuggestions?.some((suggestion) => suggestion.status === 'pending')
    );
    const cancellableTaskSuggestionIndex = (data.messages[cancellableTaskMessageIndex]?.taskSuggestions || [])
      .findIndex((item) => item.status === 'pending');
    const cancellableTaskSuggestion = data.messages[cancellableTaskMessageIndex]?.taskSuggestions?.[cancellableTaskSuggestionIndex];
    assert(
      cancellableTaskSuggestion?.proposalKey && cancellableTaskSuggestion?.plantPetId === plantPetId,
      '明确请求先生成可由用户审阅的待确认任务候选',
      cancellableTaskSuggestion
    );
    const naturalLanguageCancelText = '算了，先不要安排这个任务。';
    await page.callMethod('onInput', { detail: { value: naturalLanguageCancelText } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'user' && item.text === naturalLanguageCancelText
    ), 60000);
    const pendingAfterNaturalLanguageCancel = await request('POST', '/care/task-proposal', {
      token, body: { proposalKey: cancellableTaskSuggestion.proposalKey }
    });
    const tasksAfterNaturalLanguageCancel = await request('POST', '/care/tasks', {
      token, body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(
      pendingAfterNaturalLanguageCancel.json?.proposal?.status === 'pending' &&
        (tasksAfterNaturalLanguageCancel.json?.tasks || []).length === taskCountBeforeProposal,
      '自然语言反悔不会擅自执行取消工具；候选保持 pending 且正式任务不变',
      { proposal: pendingAfterNaturalLanguageCancel, tasks: tasksAfterNaturalLanguageCancel }
    );
    await page.callMethod('previewTaskSuggestion', {
      currentTarget: { dataset: { messageIndex: cancellableTaskMessageIndex, suggestionIndex: cancellableTaskSuggestionIndex } }
    });
    page = await waitForPage(miniProgram, 'pages/taskForm/taskForm', 15000);
    data = await waitForData(page, (value) => !value.loading && value.proposalStatus === 'pending', 10000);
    assert(
      data.mode === 'proposal' && data.proposalKey === cancellableTaskSuggestion.proposalKey,
      '待确认候选可进入专用表单执行显式放弃操作',
      data
    );
    const editedCancelledProposalDate = shanghaiDateWithOffset(1);
    await page.callMethod('onDateChange', { detail: { value: editedCancelledProposalDate } });
    data = await page.data();
    assert(
      data.form.scheduledFor === editedCancelledProposalDate,
      '缺日期任务默认当天后，确认页日期字段仍可由用户修改',
      data.form
    );
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    const cancelProposalButton = await page.$('.cancel-proposal-btn');
    assert(Boolean(cancelProposalButton), '任务候选确认页提供“放弃建议”按钮', { path: page.path });
    await cancelProposalButton.tap();
    page = await waitForPage(miniProgram, 'pages/assistant/assistant', 15000);
    await miniProgram.restoreWxMethod('showModal');
    data = await waitForData(page, (value) => !value.loadingSession && !value.sending, 15000);
    const cancelledTaskProposal = await request('POST', '/care/task-proposal', {
      token, body: { proposalKey: cancellableTaskSuggestion.proposalKey }
    });
    const tasksAfterExplicitCancel = await request('POST', '/care/tasks', {
      token, body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(
      cancelledTaskProposal.json?.proposal?.status === 'cancelled' &&
        (tasksAfterExplicitCancel.json?.tasks || []).length === taskCountBeforeProposal,
      '用户在确认页点击“放弃建议”后候选取消，正式任务数仍不变',
      { proposal: cancelledTaskProposal, tasks: tasksAfterExplicitCancel }
    );

    const taskStartedAt = Date.now();
    await page.callMethod('onInput', { detail: { value: '请帮我安排一个今天观察月季叶片的任务。' } });
    await tapSend(page);
    const chatProgressive = await waitForData(page, (value) => value.sending && value.messages.some((item) => item.loading), 1500);
    performance.chatFirstFeedbackMs = Date.now() - taskStartedAt;
    assert(chatProgressive.sending, 'Chat 在 1.5 秒内显示等效渐进反馈', performance);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) => item.taskSuggestions?.length), 60000);
    performance.chatTaskTotalMs = Date.now() - taskStartedAt;
    const taskMessageIndex = lastIndex(data.messages, (item) => item.role === 'assistant' && item.taskSuggestions?.length);
    const taskSuggestion = data.messages[taskMessageIndex]?.taskSuggestions?.[0];
    assert(
      taskSuggestion?.plantPetId === plantPetId && taskSuggestion?.proposalKey && taskSuggestion?.status === 'pending',
      '明确任务意图只产生当前月季的持久待确认候选',
      taskSuggestion
    );
    const tasksWhilePending = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(
      (tasksWhilePending.json?.tasks || []).length === taskCountBeforeProposal,
      '候选待确认期间没有旁路写入正式任务',
      tasksWhilePending
    );
    await page.callMethod('previewTaskSuggestion', { currentTarget: { dataset: { messageIndex: taskMessageIndex, suggestionIndex: 0 } } });
    page = await waitForPage(miniProgram, 'pages/taskForm/taskForm', 15000);
    data = await waitForData(page, (value) => !value.loading, 10000);
    assert(
      data.mode === 'proposal' && data.proposalKey === taskSuggestion.proposalKey &&
        data.proposalStatus === 'pending' && data.form.plantPetId === plantPetId,
      'AI 候选按 proposalKey 从后端重载，不依赖本地临时缓存',
      data
    );
    const editedTaskTitle = `M7 用户编辑叶片观察 ${Date.now()}`;
    await page.callMethod('onTitleInput', { detail: { value: editedTaskTitle } });
    await page.callMethod('onDescriptionInput', { detail: { value: '用户在确认页补充：观察叶背与新芽。' } });
    if (!(await page.data()).form.reminderEnabled) {
      await page.callMethod('onReminderToggle', { detail: { value: true } });
    }
    await page.callMethod('onReminderTimeChange', { detail: { value: '10:30' } });
    data = await page.data();
    assert(
      data.form.title === editedTaskTitle && data.form.reminderEnabled === true && data.form.reminderTime === '10:30',
      '确认页允许编辑业务字段，同时锁定候选所属植宠',
      data.form
    );
    screenshots.push(await screenshot(miniProgram, '08-ai-task-confirmation-form.png'));
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    const taskSubmit = await page.$('.submit-btn');
    await taskSubmit.tap();
    page = await waitForPage(miniProgram, 'pages/assistant/assistant', 15000);
    await miniProgram.restoreWxMethod('showModal');
    const taskList = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    const createdTask = taskList.json?.tasks?.find((item) => item.source === 'ai' && item.title === editedTaskTitle);
    const taskId = Number(createdTask?.id) || 0;
    assert(taskId > 0 && createdTask.reminderTime === '10:30', '任务经用户编辑和确认后才真实落库', taskList);
    const idempotentConfirm = await request('POST', '/care/task-proposal-confirm', {
      token,
      body: {
        proposalKey: taskSuggestion.proposalKey,
        plantPetId,
        taskType: createdTask.taskType,
        title: editedTaskTitle,
        description: createdTask.description,
        scheduledFor: createdTask.scheduledFor,
        reminderTime: createdTask.reminderTime,
        recurrenceType: createdTask.recurrenceType,
        recurrenceInterval: createdTask.recurrenceInterval
      }
    });
    assert(
      idempotentConfirm.json?.success && Number(idempotentConfirm.json.task?.id) === taskId &&
        idempotentConfirm.json.proposal?.idempotent === true,
      '重复确认同一 proposalKey 返回同一任务，不重复创建',
      idempotentConfirm
    );
    data = await waitForData(page, (value) => !value.loadingSession && !value.sending, 15000);
    const taskCountAfterConfirm = (taskList.json?.tasks || []).length;
    await page.callMethod('onInput', { detail: { value: '我没有让你安排任务，不要创建任何任务。' } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending, 60000);
    const denialReply = [...data.messages].reverse().find((item) => item.role === 'assistant' && !item.loading);
    assert((denialReply?.taskSuggestions || []).length === 0, '任务否定语句不显示任务候选', denialReply);
    await page.callMethod('onInput', { detail: { value: '为什么有时需要安排养护任务？' } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending, 60000);
    const discussionReply = [...data.messages].reverse().find((item) => item.role === 'assistant' && !item.loading);
    assert((discussionReply?.taskSuggestions || []).length === 0, '只讨论任务概念不显示任务候选', discussionReply);
    const tasksAfterNegativeQueries = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(
      (tasksAfterNegativeQueries.json?.tasks || []).length === taskCountAfterConfirm,
      '任务否定、讨论和普通图片建议都没有旁路创建正式任务',
      tasksAfterNegativeQueries
    );
    steps.push({ step: 6, name: 'AI 待确认任务', health: 'pass' });

    page = await miniProgram.switchTab('/pages/index/index');
    const listStartedAt = Date.now();
    data = await waitForData(page, (value) => !value.loading && value.homeTasks.some((item) => item.id === taskId), 15000);
    performance.homeListReadyMs = Date.now() - listStartedAt;
    assert(data.homeTasks.some((item) => item.id === taskId), '首页今日任务显示刚确认的 AI 任务', data.homeTasks);
    screenshots.push(await screenshot(miniProgram, '09-home-today-task.png'));

    const calendarStartedAt = Date.now();
    page = await miniProgram.switchTab('/pages/calendar/calendar');
    data = await waitForData(page, (value) => !value.loading && value.selectedTasks.some((item) => item.id === taskId), 15000);
    performance.devtoolsCalendarNavigationMs = Date.now() - calendarStartedAt;
    const calendarRefreshStartedAt = Date.now();
    await page.callMethod('loadCalendar');
    data = await waitForData(page, (value) => !value.loading && value.selectedTasks.some((item) => item.id === taskId), 5000);
    performance.calendarBusinessRefreshMs = Date.now() - calendarRefreshStartedAt;
    assert(
      performance.calendarBusinessRefreshMs < 2000,
      '页面已编译后，日历任务业务数据在 2 秒内完成刷新',
      performance
    );
    screenshots.push(await screenshot(miniProgram, '10-calendar-pending-task.png'));
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('completeTask', { currentTarget: { dataset: { id: taskId } } });
    data = await waitForData(page, (value) => value.selectedTasks.some((item) => item.id === taskId && item.status === 'completed'), 10000);
    await miniProgram.restoreWxMethod('showModal');
    assert(data.selectedTasks.some((item) => item.id === taskId && item.status === 'completed'), '日历完成打卡并即时刷新', data.selectedTasks);
    screenshots.push(await screenshot(miniProgram, '11-calendar-completed-task.png'));
    steps.push({ step: 7, name: '首页、日历与打卡', health: 'pass' });

    page = await miniProgram.navigateTo(`/pages/plantPetDetail/plantPetDetail?plantPetId=${plantPetId}`);
    data = await waitForData(page, (value) => !value.loading && value.pet?.id === plantPetId, 10000);
    await page.callMethod('addJournalRecord');
    page = await waitForPage(miniProgram, 'pages/plantJournal/plantJournal', 10000);
    data = await waitForData(page, (value) => !value.loading && value.showComposer, 10000);
    assert(data.showComposer && data.draft.plantPetId === plantPetId, '从植宠详情打开当前月季成长记录面板', data.draft);
    await page.setData({
      draft: {
        ...data.draft,
        plantPetId,
        title: 'M7 月季叶片观察',
        content: '完成今日观察，花瓣和叶片已拍照留档。',
        photos: [{ key: 'm7-growth', fileId: '', tempPath: tempRosePath, displayUrl: tempRosePath }]
      }
    });
    screenshots.push(await screenshot(miniProgram, '12-journal-photo-text-composer.png'));
    const saveJournal = await page.$('.save-btn');
    await saveJournal.tap();
    data = await waitForData(page, (value) => !value.showComposer && value.records.some((item) => item.title === 'M7 月季叶片观察'), 15000);
    assert(data.records.some((item) => item.title === 'M7 月季叶片观察' && item.photos.length === 1), '图文成长记录保存到时间线', data.records);
    screenshots.push(await screenshot(miniProgram, '13-journal-timeline.png'));

    page = await reLaunchSafe(miniProgram, `/pages/plantJournal/plantJournal?plantPetId=${plantPetId}`);
    data = await waitForData(page, (value) => !value.loading && value.records.some((item) => item.title === 'M7 月季叶片观察'), 15000);
    assert(data.records.some((item) => item.photos.length === 1), '重开页面后图文记录与照片仍可恢复', data.records);
    screenshots.push(await screenshot(miniProgram, '14-reopened-journal-timeline.png'));
    steps.push({ step: 8, name: '图文时间线与重开恢复', health: 'pass' });

    page = await miniProgram.switchTab('/pages/assistant/assistant');
    data = await waitForData(page, (value) => !value.loadingSession && value.selectedPlantPet?.id === plantPetId, 15000);
    const ragStartedAt = Date.now();
    await page.callMethod('onInput', { detail: { value: '月季平时浇水应该怎么判断？' } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) => item.sources?.some((source) => ['knowledge_article', 'plant_library'].includes(source.type))), 60000);
    performance.ragChatTotalMs = Date.now() - ragStartedAt;
    const ragMessage = [...data.messages].reverse().find((item) => item.sources?.some((source) => ['knowledge_article', 'plant_library'].includes(source.type)));
    assert(ragMessage?.sources?.length, 'AI 回答显示已发布知识来源卡', ragMessage);
    screenshots.push(await screenshot(miniProgram, '15-ai-rag-sources.png'));

    const ragUserMessage = [...data.messages].reverse().find((item) => item.role === 'user' && item.text === '月季平时浇水应该怎么判断？');
    assert(ragUserMessage?.backendId && data.messageActionMenuOpen === false, '默认阅读态不常驻显示低频消息操作', ragUserMessage);
    await page.callMethod('openMessageActionMenu', {
      currentTarget: { dataset: { id: ragUserMessage.backendId } },
      touches: [{ clientX: 320, clientY: 420 }]
    });
    data = await page.data();
    const messageActionKeys = (data.messageActionMenuActions || []).map((item) => item.key);
    assert(
      data.messageActionMenuOpen && messageActionKeys.includes('copy') &&
        messageActionKeys.includes('rewrite') && messageActionKeys.includes('withdraw'),
      '长按用户消息才临时显示复制、重新编辑与撤回菜单',
      data.messageActionMenuActions
    );
    screenshots.push(await screenshot(miniProgram, '16-message-longpress-menu.png'));
    await miniProgram.evaluate(function resetClipboardProbe() {
      getApp().globalData.__m7ClipboardData = '';
    });
    await miniProgram.mockWxMethod('setClipboardData', function captureClipboard(options) {
      getApp().globalData.__m7ClipboardData = String(options && options.data || '');
      const result = { errMsg: 'setClipboardData:ok' };
      if (options && typeof options.success === 'function') options.success(result);
      if (options && typeof options.complete === 'function') options.complete(result);
      return result;
    });
    await page.callMethod('runMessageAction', { currentTarget: { dataset: { action: 'copy' } } });
    const copiedRagText = await miniProgram.evaluate(function readClipboardProbe() {
      return getApp().globalData.__m7ClipboardData;
    });
    await miniProgram.restoreWxMethod('setClipboardData');
    assert(copiedRagText === ragUserMessage.text, '长按菜单的复制操作实际写入完整原消息文本', { copiedRagText });
    await page.callMethod('openMessageActionMenu', {
      currentTarget: { dataset: { id: ragUserMessage.backendId } },
      touches: [{ clientX: 320, clientY: 420 }]
    });
    await page.callMethod('runMessageAction', { currentTarget: { dataset: { action: 'rewrite' } } });
    data = await page.data();
    assert(
      data.rewriteSourceMessageId === ragUserMessage.backendId && data.inputValue === ragUserMessage.text,
      '重新编辑把原消息放回输入框，并在发送前等待用户修改',
      { rewriteSourceMessageId: data.rewriteSourceMessageId, inputValue: data.inputValue }
    );
    await page.callMethod('cancelRewrite');

    const rewriteSourceSessionId = data.activeSessionId;
    const rewriteOldValue = `M7OLD${Date.now()}`;
    const rewriteNewValue = `M7NEW${Date.now()}`;
    const rewriteOldText = `本轮校验值是 ${rewriteOldValue}，请回复收到。`;
    const rewriteNewText = `改写后本轮校验值是 ${rewriteNewValue}，下一次提问时请原样复述。`;
    await page.callMethod('onInput', { detail: { value: rewriteOldText } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'user' && item.text === rewriteOldText && item.backendId > 0
    ), 60000);
    const rewriteOldUser = [...data.messages].reverse().find((item) => item.role === 'user' && item.text === rewriteOldText);
    await page.callMethod('openMessageActionMenu', {
      currentTarget: { dataset: { id: rewriteOldUser.backendId } },
      touches: [{ clientX: 320, clientY: 420 }]
    });
    await page.callMethod('runMessageAction', { currentTarget: { dataset: { action: 'rewrite' } } });
    data = await waitForData(page, (value) => !value.rewriteBusy && value.rewriteSourceMessageId === rewriteOldUser.backendId, 10000);
    assert(
      data.inputValue === rewriteOldText && data.rewriteSourceMessageId === rewriteOldUser.backendId,
      '实际重写前先把目标消息恢复为可编辑草稿',
      { inputValue: data.inputValue, rewriteSourceMessageId: data.rewriteSourceMessageId }
    );
    await page.callMethod('onInput', { detail: { value: rewriteNewText } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.activeSessionId !== rewriteSourceSessionId &&
      value.messages.some((item) => item.role === 'user' && item.text === rewriteNewText && item.backendId > 0), 60000);
    const rewriteBranchSessionId = data.activeSessionId;
    assert(
      rewriteBranchSessionId && rewriteBranchSessionId !== rewriteSourceSessionId &&
        data.messages.some((item) => item.text === rewriteNewText) &&
        !data.messages.some((item) => item.text === rewriteOldText),
      '修改后实际发送会创建独立分支，分支包含新值且不包含被替换旧轮次',
      { rewriteSourceSessionId, rewriteBranchSessionId, messages: data.messages }
    );
    const rewriteSourceSession = await request('POST', '/agent/session', {
      token, body: { sessionId: rewriteSourceSessionId, plantPetId }
    });
    assert(
      rewriteSourceSession.json?.messages?.some((item) => item.content === rewriteOldText) &&
        !rewriteSourceSession.json?.messages?.some((item) => item.content === rewriteNewText),
      '原会话保留旧轮次且不被新分支覆盖',
      rewriteSourceSession
    );
    page = await reLaunchSafe(miniProgram, '/pages/assistant/assistant');
    data = await waitForData(page, (value) => !value.loadingSession && value.activeSessionId === rewriteBranchSessionId &&
      value.messages.some((item) => item.text === rewriteNewText), 20000);
    assert(
      data.activeSessionId === rewriteBranchSessionId &&
        data.messages.some((item) => item.text === rewriteNewText) &&
        !data.messages.some((item) => item.text === rewriteOldText),
      'reLaunch 后仍恢复重写分支及新值，不回跳原会话',
      { activeSessionId: data.activeSessionId, messages: data.messages }
    );
    const rewriteFollowUp = '请只原样复述我刚才改写后的本轮校验值。';
    await page.callMethod('onInput', { detail: { value: rewriteFollowUp } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'user' && item.text === rewriteFollowUp
    ), 60000);
    const rewriteFollowUpUserIndex = lastIndex(data.messages, (item) => item.role === 'user' && item.text === rewriteFollowUp);
    const rewriteFollowUpAssistant = data.messages.slice(rewriteFollowUpUserIndex + 1)
      .find((item) => item.role === 'assistant' && !item.loading);
    assert(
      rewriteFollowUpAssistant?.text?.includes(rewriteNewValue) &&
        !rewriteFollowUpAssistant.text.includes(rewriteOldValue),
      '重写分支的后续追问只引用新值，不幽灵召回旧值',
      rewriteFollowUpAssistant
    );
    screenshots.push(await screenshot(miniProgram, '16a-rewrite-branch-follow-up.png'));

    const withdrawnSecret = `M7-WITHDRAW-${Date.now()}`;
    const withdrawnText = `本轮一次性暗号是 ${withdrawnSecret}，请回复你看到了。`;
    await page.callMethod('onInput', { detail: { value: withdrawnText } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'user' && item.text === withdrawnText && item.backendId > 0
    ), 60000);
    const withdrawnUserMessage = [...data.messages].reverse().find((item) => item.role === 'user' && item.text === withdrawnText);
    const withdrawnUserIndex = data.messages.findIndex((item) => item.backendId === withdrawnUserMessage?.backendId);
    const withdrawnAssistantMessage = data.messages.slice(withdrawnUserIndex + 1).find((item) => item.role === 'assistant' && item.backendId > 0);
    assert(
      withdrawnUserMessage?.backendId > 0 && withdrawnUserMessage?.canWithdraw === true &&
        withdrawnAssistantMessage?.backendId > 0,
      '撤回专项先产生一组真实持久化用户/助手轮次',
      { withdrawnUserMessage, withdrawnAssistantMessage }
    );
    await page.callMethod('openMessageActionMenu', {
      currentTarget: { dataset: { id: withdrawnUserMessage.backendId } },
      touches: [{ clientX: 320, clientY: 420 }]
    });
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('runMessageAction', { currentTarget: { dataset: { action: 'withdraw' } } });
    data = await waitForData(
      page,
      (value) => !value.sending && !value.messages.some((item) =>
        item.backendId === withdrawnUserMessage.backendId || item.backendId === withdrawnAssistantMessage.backendId
      ),
      20000
    );
    await miniProgram.restoreWxMethod('showModal');
    assert(
      !data.messages.some((item) => item.text === withdrawnText ||
        item.backendId === withdrawnUserMessage.backendId || item.backendId === withdrawnAssistantMessage.backendId),
      '在 DevTools 中实际确认撤回后，整组轮次从当前会话投影消失',
      data.messages
    );
    const withdrawnRecallQuestion = '刚才撤回消息里的暗号是什么？如果不知道就说不知道。';
    await page.callMethod('onInput', { detail: { value: withdrawnRecallQuestion } });
    await tapSend(page);
    data = await waitForData(page, (value) => !value.sending && value.messages.some((item) =>
      item.role === 'user' && item.text === withdrawnRecallQuestion
    ), 60000);
    const withdrawnRecallUserIndex = lastIndex(data.messages, (item) => item.role === 'user' && item.text === withdrawnRecallQuestion);
    const withdrawnRecallAssistant = data.messages.slice(withdrawnRecallUserIndex + 1).find((item) => item.role === 'assistant' && !item.loading);
    assert(
      withdrawnRecallAssistant?.text && !withdrawnRecallAssistant.text.includes(withdrawnSecret),
      '撤回后的后续上下文不会召回已删除轮次中的独特暗号',
      withdrawnRecallAssistant
    );

    await page.callMethod('openAiMemory');
    page = await waitForPage(miniProgram, 'pages/aiMemory/aiMemory', 15000);
    data = await waitForData(page, value => Boolean(value.contextMemory) && !value.loading, 15000);
    assert(data.contextMemory?.enabled === false, '新账号跨会话记忆默认关闭，但会话原话仍保留');
    const memoryBackBounds = await (await page.$('.summary-icon-button')).size();
    assert(memoryBackBounds.width >= 32 && memoryBackBounds.width <= 64, '记忆页返回按钮是紧凑按钮，不撑开标题栏', memoryBackBounds);
    screenshots.push(await screenshot(miniProgram, '17-memory-default-off.png'));
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await (await page.$('switch')).tap();
    data = await waitForData(page, value => value.contextMemory?.enabled && !value.contextBusy, 15000);
    await miniProgram.restoreWxMethod('showModal');
    assert(data.contextMemory.enabled, '用户在记忆页开启一次自动跨会话摘要');
    page = await miniProgram.switchTab('/pages/assistant/assistant');
    await waitForData(page, value => !value.loadingSession, 15000);
    await page.callMethod('onInput', { detail: { value: '以后叫我蒲公英吧，我喜欢简短直接的回答。' } });
    await tapSend(page);
    data = await waitForData(page, value => !value.sending, 60000);
    assert(!data.messages.at(-1)?.memorySuggestions?.length, '开启后不再逐条显示称呼候选确认卡');
    const previousSessionId = data.activeSessionId;
    await page.callMethod('createNewConversation');
    data = await waitForData(page, value => !value.loadingSession && value.activeSessionId !== previousSessionId, 15000);
    assert(data.activeSessionId !== previousSessionId, '同一植宠创建了新的独立会话');
    await page.callMethod('onInput', { detail: { value: '你记得该怎么称呼我吗？' } });
    await tapSend(page);
    data = await waitForData(page, value => !value.sending, 60000);
    assert(/蒲公英/.test(data.messages.at(-1)?.text || ''), '新会话召回AI自动整理的昵称', data.messages.at(-1));
    screenshots.push(await screenshot(miniProgram, '18-memory-cross-session.png'));
    await page.callMethod('openAiMemory');
    page = await waitForPage(miniProgram, 'pages/aiMemory/aiMemory', 15000);
    data = await waitForData(page, value => Boolean(value.contextMemory) && !value.loading, 15000);
    const fact = data.contextMemory.facts.find(item => item.key === 'preferred_name');
    assert(fact && /蒲公英/.test(fact.content) && !/蒲公英吧/.test(fact.content), '摘要有原话来源，昵称不包含语气词', fact);
    screenshots.push(await screenshot(miniProgram, '19-ai-memory-summary.png'));
    assert(data.contextMemory.summary && !(await page.$$('.context-fact')).length, '记忆展示为一整段摘要，不是逐条编辑卡');
    await (await page.$('.summary-edit-link')).tap();
    await withTimeout(page.waitFor('.summary-editor'), 5000, '整段摘要编辑器');
    await (await page.$('.summary-editor')).input('你希望我称呼你为云朵。你喜欢简短直接的回答，也喜欢月季。');
    screenshots.push(await screenshot(miniProgram, '19b-ai-memory-whole-edit.png'));
    await (await page.$('.summary-save')).tap();
    data = await waitForData(page, value => !value.contextBusy && !value.editingSummary, 25000);
    assert(data.contextMemory.summary === '你希望我称呼你为云朵。你喜欢简短直接的回答，也喜欢月季。', '整段编辑原样保存，不要求逐条修正');
    screenshots.push(await screenshot(miniProgram, '20-ai-memory-edited.png'));
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('forgetContextFact', { currentTarget: { dataset: {} } });
    data = await waitForData(page, value => !value.contextMemory.facts.length && !value.contextBusy, 15000);
    await miniProgram.restoreWxMethod('showModal');
    assert(!data.contextMemory.facts.length, '用户可清除自动摘要');
    page = await miniProgram.switchTab('/pages/assistant/assistant');
    data = await waitForData(page, value => !value.loadingSession, 15000);
    const beforeDeletedRecallSessionId = data.activeSessionId;
    await page.callMethod('createNewConversation');
    await waitForData(page, value => !value.loadingSession && value.activeSessionId !== beforeDeletedRecallSessionId, 15000);
    await page.callMethod('onInput', { detail: { value: '你记得该怎么称呼我吗？' } });
    await tapSend(page);
    data = await waitForData(page, value => !value.sending, 60000);
    assert(data.messages.at(-1)?.text && !/蒲公英|云朵/.test(data.messages.at(-1).text), '清除后新会话不从旧对话恢复称呼', data.messages.at(-1));
    steps.push({ step: 9, name: 'RAG、消息菜单、自动摘要与跨会话召回', health: 'pass' });

    page = await miniProgram.switchTab('/pages/profile/profile');
    data = await waitForData(page, (value) => !value.profileLoading, 10000);
    await miniProgram.evaluate(function installVibrationCounter() {
      getApp().globalData.__m7VibrateCount = 0;
      wx.vibrateShort = function vibrateShort(options) {
        getApp().globalData.__m7VibrateCount += 1;
        if (options && typeof options.success === 'function') options.success({ errMsg: 'vibrateShort:ok' });
      };
    });

    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 0 } } });
    page = await waitForPage(miniProgram, 'pages/profileEdit/profileEdit', 10000);
    data = await page.data();
    const avatarRing = await page.$('.avatar-ring');
    const avatarButton = await page.$('.avatar-btn');
    const nicknameInput = await page.$('.field-input');
    const [avatarRingSize, avatarButtonSize, nicknameAlign] = await Promise.all([
      avatarRing.size(),
      avatarButton.size(),
      nicknameInput.style('text-align')
    ]);
    assert(
      avatarButtonSize.width < avatarRingSize.width && avatarButtonSize.height < avatarRingSize.height,
      '个人资料头像内容缩进在装饰框内',
      { avatarRingSize, avatarButtonSize }
    );
    assert(nicknameAlign === 'left' || nicknameAlign === 'start', '个人资料输入文字不再错误居右', { nicknameAlign });
    screenshots.push(await screenshot(miniProgram, '17-profile-edit-frame-and-alignment.png'));
    await page.callMethod('goBack');
    page = await waitForPage(miniProgram, 'pages/profile/profile', 10000);

    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 2 } } });
    page = await waitForPage(miniProgram, 'pages/wiki/wiki', 10000);
    data = await waitForData(page, (value) => value.hasLoaded && !value.loading, 15000);
    const wikiBackButton = await page.$('.back-btn');
    const wikiTopbar = await page.$('.topbar');
    const wikiContent = await page.$('.content');
    const topbarBeforeScroll = await wikiTopbar.offset();
    assert(Boolean(wikiBackButton), '知识库提供明确返回按钮');
    screenshots.push(await screenshot(miniProgram, '18-wiki-fixed-safe-header.png'));
    await wikiContent.scrollTo(0, 520);
    await wait(500);
    const [wikiScrollTop, topbarAfterScroll] = await Promise.all([
      wikiContent.property('scrollTop'),
      wikiTopbar.offset()
    ]);
    assert(Number(wikiScrollTop) > 0, '知识库内容由内部滚动区承载', { wikiScrollTop });
    assert(
      Math.abs(Number(topbarAfterScroll.top) - Number(topbarBeforeScroll.top)) <= 1,
      '知识库滚动时安全区标题保持稳定，不再被页面上滑截断',
      { topbarBeforeScroll, topbarAfterScroll }
    );
    screenshots.push(await screenshot(miniProgram, '19-wiki-scrolled-with-safe-header.png'));
    await page.callMethod('goBack');
    page = await waitForPage(miniProgram, 'pages/profile/profile', 10000);
    steps.push({ step: 10, name: '个人资料与知识库界面回归', health: 'pass' });

    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 10 } } });
    page = await waitForPage(miniProgram, 'pages/about/about', 10000);
    screenshots.push(await screenshot(miniProgram, '20-about-before-back.png'));
    await page.callMethod('goBack');
    page = await waitForPage(miniProgram, 'pages/profile/profile', 10000);
    const aboutBackVibrationCount = await miniProgram.evaluate(function getAboutBackVibrationCount() {
      return getApp().globalData.__m7VibrateCount;
    });
    assert(aboutBackVibrationCount === 0, '从关于我们返回我的不触发震动', { aboutBackVibrationCount });
    steps.push({ step: 11, name: '关于我们返回动效', health: 'pass' });

    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 9 } } });
    page = await waitForPage(miniProgram, 'pages/settings/settings', 10000);
    data = await page.data();
    const vibrationCount = await miniProgram.evaluate(function getVibrationCount() {
      return getApp().globalData.__m7VibrateCount;
    });
    assert(page.path === 'pages/settings/settings' && vibrationCount === 0, '系统设置成为可进入页面，不再以“开发中”震动', { path: page.path, vibrationCount });
    screenshots.push(await screenshot(miniProgram, '21-settings-p0-hub.png'));
    steps.push({ step: 12, name: '设置 P0 汇总页', health: 'pass' });

    assert(exceptions.length === 0, '完整页面闭环没有运行时异常', exceptions);
    const result = {
      status: 'PASS',
      runAt: new Date().toISOString(),
      expectedOpenid,
      plantPetId,
      assertionCount: assertionResults.length,
      assertions: assertionResults,
      steps,
      performance,
      evidenceDir,
      automationPort,
      connectionEvidencePath: path.join(evidenceDir, 'devtools-connection-attempts.json'),
      screenshots,
      exceptions,
      limitations: [
        '本轮是微信开发者工具与本地真实服务，不替代指定实体手机上的真机冷启动、网络和交互验收。',
        '相册与文档选择已自动化；相机授权及真实拍照入口必须留到实体手机验收，未用 mock 冒充。',
        '微信订阅消息仍依赖尚未提供的养护提醒模板 ID；当前只验证小程序内提醒。'
      ]
    };
    fs.writeFileSync(path.join(evidenceDir, 'm7-devtools-result.json'), JSON.stringify(result, null, 2));
    console.log('M7 微信开发者工具完整闭环全部通过');
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    fs.writeFileSync(path.join(evidenceDir, 'm7-devtools-result.json'), JSON.stringify({
      status: 'FAIL',
      runAt: new Date().toISOString(),
      expectedOpenid,
      plantPetId,
      assertionCount: assertionResults.length,
      assertions: assertionResults,
      steps,
      performance,
      evidenceDir,
      automationPort,
      connectionEvidencePath: path.join(evidenceDir, 'devtools-connection-attempts.json'),
      screenshots,
      exceptions,
      error: error.message,
      errorStack: error.stack || ''
    }, null, 2));
    throw error;
  } finally {
    let storageRestoreFailed = false;
    if (plantPetId && token) {
      await request('POST', '/plant/pet-delete', { token, body: { plantPetId } }).catch(() => {});
    }
    if (token) {
      await request('POST', '/user/profile', {
        token,
        body: { nickName: '', avatarFileId: '', avatarUrl: '' }
      }).catch(() => {});
    }
    if (miniProgram) {
      if (originalStorage !== null) {
        try {
          await miniProgram.evaluate(restoreStorage, originalStorage);
          console.log('[RESTORED] 测试前的开发者工具缓存已恢复，内容未写入日志');
        } catch (error) {
          storageRestoreFailed = true;
        }
      }
      miniProgram.disconnect();
    }
    await closeAutomationProject('final-cleanup', false).catch(() => {});
    if (storageRestoreFailed) {
      const resultPath = path.join(evidenceDir, 'm7-devtools-result.json');
      const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : {};
      result.status = 'FAIL';
      result.error = '开发者工具缓存恢复失败，不能把本轮记为通过；请检查登录态和未发送草稿';
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      throw new Error(result.error);
    }
  }
})().catch((error) => {
  console.error(`[m7-devtools-e2e] ${error.stack || error.message}`);
  process.exit(1);
});
