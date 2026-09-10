/**
 * M6 微信开发者工具端到端：NOVA 会话/RAG 来源、建议任务预览、真实 Vision、
 * 诊断保存和 AI 记忆治理。身份通过本地 /auth/login 取得，不使用 /dev/token。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M6_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M6_2026-08-28';
const rosePath = process.env.M6_ROSE_IMAGE || path.join(evidenceDir, 'known-rosa-chinensis.jpg');
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(), 'zhichong-miniprogram-automator', 'node_modules', 'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function request(method, requestPath, { token, body } = {}) {
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
      timeout: 60000
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (err) { /* 由断言报告 */ }
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
  console.log(`[PASS] ${message}`);
}

async function connectAutomation(automator) {
  const wsEndpoint = `ws://127.0.0.1:${automationPort}`;
  try {
    return await automator.connect({ wsEndpoint });
  } catch (firstError) {
    const result = childProcess.spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '& $env:M6_WECHAT_CLI auto --project $env:M6_PROJECT_ROOT --auto-port $env:M6_AUTOMATION_PORT --trust-project --lang zh'
    ], {
      env: {
        ...process.env,
        M6_WECHAT_CLI: cliPath,
        M6_PROJECT_ROOT: projectRoot,
        M6_AUTOMATION_PORT: String(automationPort)
      },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000
    });
    if (result.status !== 0) {
      const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`微信开发者工具自动化启动失败${detail ? `：${detail}` : ''}`);
    }
    let lastError = firstError;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(500);
      try { return await automator.connect({ wsEndpoint }); } catch (error) { lastError = error; }
    }
    throw lastError;
  }
}

async function screenshot(miniProgram, fileName) {
  const output = path.join(evidenceDir, fileName);
  let lastError = null;
  await wait(800);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await miniProgram.screenshot({ path: output });
      console.log(`[EVIDENCE] ${output}`);
      return;
    } catch (error) {
      lastError = error;
      await wait(800);
    }
  }
  throw lastError;
}

async function waitForData(page, predicate, timeoutMs = 15000) {
  const startedAt = Date.now();
  let data = await page.data();
  while (!predicate(data) && Date.now() - startedAt < timeoutMs) {
    await wait(300);
    data = await page.data();
  }
  return data;
}

async function waitForPage(miniProgram, expectedPath, timeoutMs = 15000) {
  const startedAt = Date.now();
  let page = await miniProgram.currentPage();
  while (page?.path !== expectedPath && Date.now() - startedAt < timeoutMs) {
    await wait(300);
    page = await miniProgram.currentPage();
  }
  return page;
}

(async () => {
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  assert(fs.existsSync(rosePath), '找到已知月季验收图片', { rosePath });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const login = await request('POST', '/auth/login', { body: { code: 'm6-devtools-real-login' } });
  const token = login.json?.accessToken || '';
  assert(login.status === 200 && login.json?.success && token, '通过本地真实登录契约取得 M6 开发者工具身份', login);

  const petResult = await request('POST', '/plant/pet-create', {
    token,
    body: {
      nickname: `M6 工具月季 ${Date.now()}`,
      speciesName: '月季',
      enteredAt: '2026-08-28',
      location: '开发者工具南窗台',
      careNotes: 'M6 开发者工具验收，完成后自动清理'
    }
  });
  const plantPetId = Number(petResult.json?.pet?.id) || 0;
  assert(plantPetId > 0, '建立开发者工具专用 PlantPet', petResult);
  const mismatchPetResult = await request('POST', '/plant/pet-create', {
    token,
    body: {
      nickname: `M6 工具龟背竹 ${Date.now()}`,
      speciesName: '龟背竹',
      enteredAt: '2026-08-28',
      location: '开发者工具客厅',
      careNotes: 'M6 植物主题错配回归，完成后自动清理'
    }
  });
  const mismatchPlantPetId = Number(mismatchPetResult.json?.pet?.id) || 0;
  assert(mismatchPlantPetId > 0, '建立龟背竹错配回归 PlantPet', mismatchPetResult);
  const preference = await request('POST', '/ai/memory-create', {
    token,
    body: { plantPetId, content: '我习惯周末检查植物', confirmed: true }
  });
  assert(preference.json?.success, '准备用户确认偏好样本', preference);
  const globalPreference = await request('POST', '/ai/memory-create', {
    token,
    body: { content: 'M6 范围清空隔离对照', confirmed: true }
  });
  const globalPreferenceId = Number(globalPreference.json?.memoryId) || 0;
  assert(globalPreference.json?.success && globalPreferenceId > 0, '准备账号级记忆隔离对照', globalPreference);

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};
  let miniProgram = null;
  const exceptions = [];

  try {
    miniProgram = await connectAutomation(automator);
    miniProgram.on('exception', (error) => exceptions.push(error));
    await miniProgram.evaluate(function prepareStorage(payload) {
      wx.clearStorageSync();
      wx.setStorageSync('apiAccessToken', payload.token);
      wx.setStorageSync('apiAccessTokenMeta', payload.tokenMeta);
      wx.setStorageSync('userInfo', payload.userInfo);
    }, {
      token,
      tokenMeta: {
        accessToken: token,
        expiresAt: login.json.expiresAt,
        openid: login.json.openid,
        loginTime: Date.now()
      },
      userInfo: {
        openid: login.json.openid,
        nickName: 'M6 开发者工具用户'
      }
    });
    await miniProgram.evaluate(function refreshLoginState() {
      const app = getApp();
      app.checkLoginStatus();
      return app.globalData.hasLogin;
    });

    let page = await miniProgram.reLaunch('/pages/assistant/assistant');
    // 当前开发者工具自动化模式会在页面已显示后继续等待 navigateTo 的 10 秒回调窗口。
    await page.waitFor(11000);
    let data = await waitForData(page, (value) => !value.loadingSession, 10000);
    const petIndex = data.plantPets.findIndex((item) => item.id === plantPetId);
    const mismatchPetIndex = data.plantPets.findIndex((item) => item.id === mismatchPlantPetId);
    assert(page.path === 'pages/assistant/assistant' && petIndex >= 0 && mismatchPetIndex >= 0, 'NOVA 页面完成编译并读取真实植宠列表', { path: page.path, data });
    const legacyVisionButton = await page.$('.vision-button');
    const attachmentButton = await page.$('.input-side-button');
    assert(!legacyVisionButton && Boolean(attachmentButton), '图片入口已从顶部独立按钮收回到输入框旁加号');
    await attachmentButton.tap();
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    let attachmentItems = await page.$$('.attachment-menu-item');
    assert(
      data.attachmentMenuView === 'root' && attachmentItems.length === 2,
      '加号根菜单只保留“添加附件”和“选择功能”两个清晰入口',
      data
    );
    await screenshot(miniProgram, '00-attachment-composer-menu.png');

    await attachmentItems[1].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'function', 3000);
    const functionItems = await page.$$('.function-menu-item');
    assert(functionItems.length === 5, '选择功能列出当前真实可用的三项只读能力和两个确认式页面入口', data.functionOptions);
    await screenshot(miniProgram, '00a-function-selection-menu.png');
    await functionItems[0].tap();
    data = await waitForData(page, (value) => value.selectedFunction?.key === 'plant_status', 3000);
    assert(
      data.selectedFunction?.key === 'plant_status' && /当前植宠档案/.test(data.inputValue),
      '选择只读功能后以功能 chip 和可继续编辑的标准问题进入输入框',
      data
    );
    await screenshot(miniProgram, '00b-function-chip-draft.png');
    await page.callMethod('removeSelectedFunction');
    await page.callMethod('onInput', { detail: { value: '' } });

    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    attachmentItems = await page.$$('.attachment-menu-item');
    await attachmentItems[1].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'function', 3000);
    const taskFunctionItems = await page.$$('.function-menu-item');
    await taskFunctionItems[3].tap();
    page = await waitForPage(miniProgram, 'pages/taskForm/taskForm', 15000);
    data = await waitForData(page, (value) => !value.loading, 10000);
    assert(
      page.path === 'pages/taskForm/taskForm' && data.form.source === 'ai' && data.suggestionSource === 'ai',
      '“创建养护任务”功能只打开待确认表单，不会在对话中直接写任务',
      data
    );
    await miniProgram.evaluate(function backFromFunctionForm() { wx.navigateBack(); });
    page = await waitForPage(miniProgram, 'pages/assistant/assistant', 15000);
    await page.waitFor(800);
    data = await waitForData(page, (value) => !value.loadingSession, 10000);

    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    attachmentItems = await page.$$('.attachment-menu-item');
    await attachmentItems[0].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'attachment', 3000);
    const attachmentChoiceItems = await page.$$('.attachment-menu-item');
    assert(attachmentChoiceItems.length === 3, '添加附件子菜单同时保留拍照、相册和植物文档', data);
    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => !value.attachmentMenuOpen, 3000);

    const firstConversationId = data.activeSessionId;
    const firstConversationCount = data.conversations.length;
    await page.callMethod('createNewConversation');
    data = await waitForData(page, (value) =>
      !value.loadingSession && value.activeSessionId && value.activeSessionId !== firstConversationId,
    10000);
    assert(
      data.conversations.length === firstConversationCount + 1 && data.activeSessionId !== firstConversationId,
      '同一植宠可以新建并切换到独立会话',
      data.conversations
    );
    await screenshot(miniProgram, '00c-multiple-conversations.png');
    const messageCountBeforeLineBreak = data.messages.length;
    await page.callMethod('onInputConfirm', { detail: { value: '第一行\n第二行', shiftKey: true } });
    data = await page.data();
    assert(data.inputValue === '第一行\n第二行' && data.messages.length === messageCountBeforeLineBreak, 'Shift+Enter 只换行，不发送消息', data);
    await page.callMethod('onInput', { detail: { value: '' } });
    const memoryCountBeforeScopeBoundary = data.memoryCount;
    await page.callMethod('onInputConfirm', { detail: { value: '请你证明哥德巴赫猜想' } });
    data = await waitForData(page, (value) => !value.sending, 15000);
    const scopeBoundaryAnswer = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
    assert(
      /哥德巴赫猜想.*植宠养护职责/.test(scopeBoundaryAnswer?.text || ''),
      '域外数学问题由 NOVA 明确说明职责边界',
      scopeBoundaryAnswer
    );
    assert((scopeBoundaryAnswer?.sources || []).length === 0, '域外问题不展示植物知识或模型来源', scopeBoundaryAnswer);
    assert((scopeBoundaryAnswer?.taskSuggestions || []).length === 0, '域外问题不生成任务候选', scopeBoundaryAnswer);
    assert(!/Monstera|龟背竹|Rosa|月季/.test(scopeBoundaryAnswer?.text || ''), '域外问题没有混入当前植宠资料', scopeBoundaryAnswer);
    assert(data.memoryCount === memoryCountBeforeScopeBoundary, '域外问题不增加结构化摘要记忆', data);
    await screenshot(miniProgram, '00a-out-of-scope-boundary.png');
    for (const incidentalPlantMath of ['1+2是多少个月季啊？', '1+2是多少朵玫瑰花呢']) {
      await page.callMethod('onInputConfirm', { detail: { value: incidentalPlantMath } });
      data = await waitForData(page, (value) => !value.sending, 15000);
      const incidentalAnswer = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
      assert(
        /植物名.*不是植宠养护问题/.test(incidentalAnswer?.text || ''),
        '夹带月季或玫瑰词的算术问题仍停在职责域边界',
        incidentalAnswer
      );
      assert((incidentalAnswer?.sources || []).length === 0, '夹带植物词的算术问题不展示 RAG 或模型来源', incidentalAnswer);
      assert((incidentalAnswer?.taskSuggestions || []).length === 0, '夹带植物词的算术问题不生成任务候选', incidentalAnswer);
      assert(data.memoryCount === memoryCountBeforeScopeBoundary, '夹带植物词的算术问题不增加结构化摘要记忆', data);
    }
    await screenshot(miniProgram, '00aa-incidental-plant-math-boundary.png');
    await page.callMethod('onInputConfirm', { detail: { value: '你好?' } });
    data = await waitForData(page, (value) => !value.sending, 15000);
    const punctuatedGreeting = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
    await page.callMethod('onInputConfirm', { detail: { value: '你好' } });
    data = await waitForData(page, (value) => !value.sending, 15000);
    const plainGreeting = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
    assert(
      punctuatedGreeting?.text === plainGreeting?.text && /你好呀，我在呢/.test(plainGreeting?.text || ''),
      '带问号和不带问号的你好进入同一条轻量社交路由',
      { punctuatedGreeting, plainGreeting }
    );
    assert(
      (punctuatedGreeting?.sources || []).length === 0 && (plainGreeting?.sources || []).length === 0,
      '简单问候不展示植物知识或模型来源',
      { punctuatedGreeting, plainGreeting }
    );
    assert(
      !/哥德巴赫|数学题|Monstera|龟背竹|Rosa|月季/.test(`${punctuatedGreeting?.text || ''}\n${plainGreeting?.text || ''}`),
      '问候回复没有继承域外历史或当前植宠资料',
      { punctuatedGreeting, plainGreeting }
    );
    assert(data.memoryCount === memoryCountBeforeScopeBoundary, '简单问候不增加结构化摘要记忆', data);
    await screenshot(miniProgram, '00b-social-punctuation-consistency.png');
    if (data.selectedPlantPet?.id !== mismatchPlantPetId) {
      await page.callMethod('onPlantPetChange', { detail: { value: mismatchPetIndex } });
      data = await waitForData(page, (value) => !value.loadingSession && value.selectedPlantPet?.id === mismatchPlantPetId, 10000);
    }
    const memoryCountBeforeMismatch = data.memoryCount;
    await page.callMethod('onInputConfirm', { detail: { value: '月季怎么浇水，并帮我安排一个观察任务？' } });
    data = await waitForData(page, (value) => !value.sending, 45000);
    const mismatchAnswer = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
    const mismatchSourceText = (mismatchAnswer?.sources || [])
      .map((item) => `${item.title || ''} ${item.ref || ''}`)
      .join(' ');
    assert(
      /龟背竹/.test(mismatchAnswer?.text || '') && /月季/.test(mismatchAnswer?.text || ''),
      'Enter 直接发送，且页面以 NOVA 口吻提示龟背竹与月季不匹配',
      mismatchAnswer
    );
    assert(!/知识库|RAG|已复核并发布|任务绑定|不会套用/.test(mismatchAnswer?.text || ''), 'NOVA 回答不暴露内部治理措辞', mismatchAnswer);
    assert(
      /月季|Rose|Rosa/.test(mismatchSourceText) && !/龟背竹|Monstera/.test(mismatchSourceText),
      '页面错配回答只展示月季来源',
      mismatchAnswer?.sources
    );
    assert((mismatchAnswer?.taskSuggestions || []).length === 0, '页面错配回答不显示任务候选', mismatchAnswer);
    assert(data.memoryCount === memoryCountBeforeMismatch, '错配回答不增加龟背竹结构化记忆计数', data);
    const mismatchTaskButton = await page.$('.task-suggestion button');
    assert(!mismatchTaskButton, '错配回答没有可误点的任务预览按钮');
    await screenshot(miniProgram, '02a-plant-topic-mismatch.png');

    if (data.selectedPlantPet?.id !== plantPetId) {
      await page.callMethod('onPlantPetChange', { detail: { value: petIndex } });
      data = await waitForData(page, (value) => !value.loadingSession && value.selectedPlantPet?.id === plantPetId, 10000);
    }
    assert(
      data.memoryCount >= 2 && data.quota?.unlimited === true &&
        data.quota?.chat?.limit === null && data.quota?.vision?.limit === null,
      '助手页展示跨会话记忆，Chat/Vision 对所有账户不限次数',
      data
    );
    await screenshot(miniProgram, '01-nova-session-memory.png');

    await page.callMethod('onInput', { detail: { value: '月季怎么浇水，并帮我安排一个观察任务？' } });
    await page.callMethod('sendMessage');
    data = await waitForData(page, (value) => !value.sending, 45000);
    const answered = data.messages.filter((item) => item.role === 'assistant').slice(-1)[0];
    assert(answered?.text?.length > 10, 'NOVA 在开发者工具端返回真实对话', answered);
    assert(answered.sources.some((item) => item.title && item.publisher && item.url && item.ref), '回答渲染可读知识来源', answered.sources);
    assert(answered.taskSuggestions?.[0]?.source === 'ai', '页面收到只读待确认任务候选', answered.taskSuggestions);
    await screenshot(miniProgram, '02-chat-rag-task-suggestion.png');

    const taskPreviewButton = await page.$('.task-suggestion button');
    assert(Boolean(taskPreviewButton), '页面实际渲染 AI 任务预览按钮');
    await taskPreviewButton.tap();
    page = await waitForPage(miniProgram, 'pages/taskForm/taskForm', 15000);
    data = await waitForData(page, (value) => !value.loading, 10000);
    assert(page.path === 'pages/taskForm/taskForm' && data.form.source === 'ai' && data.suggestionSource === 'ai', 'AI 建议进入可编辑预览表单且尚未自动写入', { path: page.path, data });
    // 当前开发者工具自动化模式会在页面已显示后继续等待 navigateTo 的 10 秒回调窗口。
    await wait(11000);
    await screenshot(miniProgram, '03-ai-task-confirmation-form.png');
    await miniProgram.evaluate(function backToAssistant() {
      wx.navigateBack();
    });
    page = await waitForPage(miniProgram, 'pages/assistant/assistant', 15000);
    await page.waitFor(800);

    const documentText = '# 月季观察记录\n\n盆土下两厘米干燥后再浇透，托盘不要长期积水。';
    const tempDocumentPath = await miniProgram.evaluate(function writeDocumentFixture(content) {
      const output = `${wx.env.USER_DATA_PATH}/m6-rose-care.md`;
      wx.getFileSystemManager().writeFileSync(output, content, 'utf8');
      return output;
    }, documentText);
    await miniProgram.mockWxMethod('chooseMessageFile', {
      tempFiles: [{
        path: tempDocumentPath,
        name: 'm6-rose-care.md',
        size: Buffer.byteLength(documentText, 'utf8'),
        type: 'file'
      }]
    });
    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    let composerMenuItems = await page.$$('.attachment-menu-item');
    await composerMenuItems[0].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'attachment', 3000);
    composerMenuItems = await page.$$('.attachment-menu-item');
    await composerMenuItems[2].tap();
    data = await waitForData(page, (value) => Boolean(value.pendingDocument), 5000);
    await miniProgram.restoreWxMethod('chooseMessageFile');
    assert(
      data.pendingDocument?.name === 'm6-rose-care.md' && !data.documentBusy,
      '选择文档只进入输入草稿，不会立即上传或分析',
      data.pendingDocument
    );
    await page.callMethod('onInput', { detail: { value: '概括这份记录里的浇水判断方法，不要创建任务。' } });
    await screenshot(miniProgram, '03a-document-and-text-ready.png');
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('onInputConfirm', { detail: { value: '概括这份记录里的浇水判断方法，不要创建任务。' } });
    data = await waitForData(page, (value) =>
      !value.documentBusy && value.messages.some((item) => item.documentAnalysis),
    45000);
    await miniProgram.restoreWxMethod('showModal');
    const documentUser = data.messages.filter((item) => item.role === 'user' && item.documentInput).slice(-1)[0];
    const documentAnswer = data.messages.filter((item) => item.role === 'assistant' && item.documentAnalysis).slice(-1)[0];
    assert(
      documentUser?.documentAttachment?.originalPersisted && documentAnswer?.text?.length > 8,
      '文档与配文作为同一轮发送，原件引用和真实分析结果都进入对话',
      { documentUser, documentAnswer }
    );
    assert((documentAnswer.taskSuggestions || []).length === 0, '普通文档分析不会自动安排任务', documentAnswer);
    await screenshot(miniProgram, '03b-document-analysis-result.png');
    await page.callMethod('loadSession', data.activeSessionId);
    data = await waitForData(page, (value) =>
      !value.loadingSession && value.messages.some((item) => item.documentInput),
    15000);
    const restoredDocument = data.messages.filter((item) => item.role === 'user' && item.documentInput).slice(-1)[0];
    assert(
      restoredDocument?.documentAttachment?.originalName === 'm6-rose-care.md' &&
        restoredDocument.documentAttachment.originalPersisted,
      '重新载入当前会话后仍恢复文档名称、大小和已保存状态',
      restoredDocument
    );

    const roseBase64 = fs.readFileSync(rosePath).toString('base64');
    const tempRosePath = await miniProgram.evaluate(function writeFixture(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m6-known-rose`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, roseBase64);
    await miniProgram.mockWxMethod('chooseMedia', {
      tempFiles: [{ tempFilePath: tempRosePath, size: Buffer.byteLength(roseBase64, 'base64'), fileType: 'image' }]
    });
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    const composerAttachmentButton = await page.$('.input-side-button');
    await composerAttachmentButton.tap();
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    let composerAttachmentItems = await page.$$('.attachment-menu-item');
    await composerAttachmentItems[0].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'attachment', 3000);
    composerAttachmentItems = await page.$$('.attachment-menu-item');
    await composerAttachmentItems[1].tap();
    data = await waitForData(page, (value) => Boolean(value.pendingImage), 5000);
    await miniProgram.restoreWxMethod('chooseMedia');
    const noticeBeforeSend = await miniProgram.evaluate(function readVisionNoticeBeforeSend() {
      return wx.getStorageSync('nvp_vision_notice_ack_v2');
    });
    assert(Boolean(data.pendingImage) && !data.visionBusy && !data.messages.some((item) => item.visionResult), '选择图片只加入输入草稿，不会立即调用 Vision', data);
    assert(!noticeBeforeSend, '选图阶段尚未请求第三方图片处理同意，也未发送图片', noticeBeforeSend);
    await screenshot(miniProgram, '04a-image-attached-before-send.png');

    await page.callMethod('removePendingImage');
    data = await waitForData(page, (value) => !value.pendingImage, 3000);
    assert(!data.pendingImage && data.canSend === false, '待发送图片可移除，空草稿恢复不可发送状态', data);

    await miniProgram.mockWxMethod('chooseMedia', {
      tempFiles: [{ tempFilePath: tempRosePath, size: Buffer.byteLength(roseBase64, 'base64'), fileType: 'image' }]
    });
    await page.callMethod('toggleAttachmentMenu');
    data = await waitForData(page, (value) => value.attachmentMenuOpen, 3000);
    let secondAttachmentItems = await page.$$('.attachment-menu-item');
    await secondAttachmentItems[0].tap();
    data = await waitForData(page, (value) => value.attachmentMenuView === 'attachment', 3000);
    secondAttachmentItems = await page.$$('.attachment-menu-item');
    await secondAttachmentItems[1].tap();
    data = await waitForData(page, (value) => Boolean(value.pendingImage), 5000);
    await miniProgram.restoreWxMethod('chooseMedia');
    await page.callMethod('onInput', { detail: { value: '请告诉我这是什么植物，并观察叶片状态。' } });
    await screenshot(miniProgram, '04b-image-and-text-ready-to-send.png');
    await page.callMethod('onInputConfirm', { detail: { value: '请告诉我这是什么植物，并观察叶片状态。' } });
    data = await waitForData(page, (value) =>
      !value.visionBusy &&
      value.scrollAnchor === 'message-end' &&
      value.messages.some((item) => item.visionResult),
    45000);
    await miniProgram.restoreWxMethod('showModal');
    const visionMessageIndex = data.messages.findLastIndex((item) => item.role === 'assistant' && item.visionResult);
    const visionMessage = data.messages[visionMessageIndex];
    assert(!visionMessage.visionError && visionMessage.visionResult?.isPlant && visionMessage.visionResult?.candidates?.some((item) => /月季|玫瑰|蔷薇/.test(item.name)), '加号相册入口可读取无扩展名临时图片，并完成真实月季分析', visionMessage.visionResult);
    const sentImageMessage = data.messages.filter((item) => item.role === 'user' && item.imagePreview).slice(-1)[0];
    assert(sentImageMessage?.text === '请告诉我这是什么植物，并观察叶片状态。', '图片与配文作为同一轮用户消息发送并显示在对话流', sentImageMessage);
    assert(!data.pendingImage, '图片草稿可由 Enter/confirm 事件发出，不停留在输入框', data);
    assert(Boolean(await page.$('.message-image')), '已发送图片以用户消息附件呈现在对话流中');
    assert((visionMessage.visionResult?.reply || '').length > 6, 'NOVA 针对随图配文给出自然回复', visionMessage.visionResult);
    assert(data.scrollAnchor === 'message-end', '真实图片分析完成后保持在对话流底部', data);
    const notice = await miniProgram.evaluate(function readVisionNotice() {
      return wx.getStorageSync('nvp_vision_notice_ack_v2');
    });
    assert(Boolean(notice?.acceptedAt) && notice.version === 2, '首次图片发送告知已由用户确认并记录会话保存版本', notice);
    assert(visionMessage.visionMediaFileId && !visionMessage.diagnosisSaved, '发送成功即保存会话图片，但不会自动另存为植宠观察记录', visionMessage);
    assert(visionMessage.taskSuggestions.length === 0, '普通图片问答和模型建议动作不会自动变成任务候选', visionMessage.taskSuggestions);
    await screenshot(miniProgram, '04-real-vision-structured-result.png');

    await page.callMethod('loadSession');
    data = await waitForData(page, (value) => !value.loadingSession && value.messages.some((item) => item.visionResult && item.visionPreview), 15000);
    const autoSavedVisionIndex = data.messages.findLastIndex((item) => item.role === 'assistant' && item.visionResult);
    const autoSavedVision = data.messages[autoSavedVisionIndex];
    const autoSavedImagePrompt = data.messages.filter((item) => item.role === 'user' && item.text === '请告诉我这是什么植物，并观察叶片状态。').slice(-1)[0];
    const tasksBeforeDiagnosis = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(autoSavedVision?.visionPreview && !autoSavedVision.diagnosisSaved, '未另存观察记录前重新加载，仍恢复会话原图和结构化分析', autoSavedVision);
    assert(autoSavedImagePrompt?.imagePreview && !autoSavedImagePrompt.imageOriginalUnavailable, '发送后的会话图片和配文无需另存诊断也能恢复', autoSavedImagePrompt);
    assert(
      autoSavedVision.taskSuggestions.length === 0 &&
        tasksBeforeDiagnosis.json?.success && tasksBeforeDiagnosis.json.tasks.length === 0,
      '没有明确任务意图时，Vision 建议动作既不显示任务候选也不落库',
      { taskSuggestions: autoSavedVision.taskSuggestions, persistedTasks: tasksBeforeDiagnosis.json?.tasks }
    );
    await screenshot(miniProgram, '05a-conversation-image-auto-saved.png');

    await page.callMethod('saveVisionDiagnosis', { currentTarget: { dataset: { messageIndex: autoSavedVisionIndex } } });
    data = await waitForData(page, (value) => !value.savingDiagnosis && value.messages[autoSavedVisionIndex]?.diagnosisSaved, 20000);
    assert(data.messages[autoSavedVisionIndex].diagnosisSaved === true, '用户主动点击后才把结构化观察另存到植宠档案', data.messages[autoSavedVisionIndex]);
    await screenshot(miniProgram, '05-diagnosis-saved.png');

    await page.callMethod('loadSession');
    data = await waitForData(page, (value) => !value.loadingSession && value.messages.some((item) => item.visionResult && item.diagnosisSaved), 15000);
    const restoredVision = data.messages.filter((item) => item.role === 'assistant' && item.visionResult).slice(-1)[0];
    const restoredImagePrompt = data.messages.filter((item) => item.role === 'user' && item.text === '请告诉我这是什么植物，并观察叶片状态。').slice(-1)[0];
    const tasksAfterVision = await request('POST', '/care/tasks', {
      token,
      body: { plantPetId, status: 'all', includeArchivedPlants: true }
    });
    assert(restoredVision?.diagnosisSaved && restoredVision?.visionPreview, '重新加载页面后仍保留结构化图片分析和已保存原图', restoredVision);
    assert(restoredImagePrompt?.imagePreview && !restoredImagePrompt.imageOriginalUnavailable, '重新加载页面后图片和配文仍作为同一轮用户消息恢复', restoredImagePrompt);
    assert(
      restoredVision.taskSuggestions?.length === 0 &&
        tasksAfterVision.json?.success && tasksAfterVision.json.tasks.length === 0,
      '另存观察记录也不会把建议动作转换为任务或自动落库',
      { taskSuggestions: restoredVision.taskSuggestions, persistedTasks: tasksAfterVision.json?.tasks }
    );
    await screenshot(miniProgram, '05b-vision-conversation-restored.png');

    const originalImageSessionId = data.activeSessionId;
    assert(restoredImagePrompt?.canRewrite, '已保存原图的图片消息具备重新编辑能力', restoredImagePrompt);
    const restoredImageBubble = await page.$(`.user-bubble[data-id="${restoredImagePrompt.backendId}"]`);
    await restoredImageBubble.longpress();
    data = await waitForData(page, (value) => value.messageActionMenuOpen && value.messageActionMessageId === restoredImagePrompt.backendId, 3000);
    const imageRewriteButton = await page.$('.message-action-menu-item[data-action="rewrite"]');
    assert(imageRewriteButton, '图片消息长按菜单明确显示重新编辑', data.messageActionMenuActions);
    await imageRewriteButton.tap();
    data = await waitForData(page, (value) => value.rewriteSourceMessageId === restoredImagePrompt.backendId && Boolean(value.pendingImage), 10000);
    assert(
      data.inputValue === '请告诉我这是什么植物，并观察叶片状态。' && data.pendingImage?.tempFilePath,
      '重新编辑图片消息会把原配文和已保存原图一起恢复到 composer',
      { inputValue: data.inputValue, pendingImage: data.pendingImage }
    );
    await screenshot(miniProgram, '05ba-image-rewrite-draft.png');
    await page.callMethod('onInput', { detail: { value: '请重新判断这张图是不是月季。' } });
    await page.callMethod('sendMessage');
    data = await waitForData(page, (value) =>
      !value.visionBusy && value.activeSessionId !== originalImageSessionId &&
      value.messages.some((item) => item.role === 'user' && item.text === '请重新判断这张图是不是月季。' && item.imagePreview),
    45000);
    assert(
      data.conversations.some((item) => item.sessionId === originalImageSessionId),
      '重新编辑图片消息创建新分支并保留原会话',
      { activeSessionId: data.activeSessionId, originalImageSessionId, conversations: data.conversations }
    );
    await screenshot(miniProgram, '05bb-image-rewrite-created-branch.png');

    const conversationCountBeforeRewrite = data.conversations.length;
    await page.callMethod('createNewConversation');
    data = await waitForData(page, (value) =>
      !value.loadingSession && value.conversations.length === conversationCountBeforeRewrite + 1,
    10000);
    const originalRewriteSessionId = data.activeSessionId;
    await page.callMethod('onInputConfirm', { detail: { value: '你好' } });
    data = await waitForData(page, (value) => !value.sending, 15000);
    const originalGreeting = data.messages.filter((item) => item.role === 'user' && item.text === '你好').slice(-1)[0];
    assert(originalGreeting?.backendId > 0 && originalGreeting.canRewrite, '普通文字消息具备重新编辑能力', originalGreeting);

    const greetingBubble = await page.$(`.user-bubble[data-id="${originalGreeting.backendId}"]`);
    assert(greetingBubble && !(await page.$('.message-action-menu')), '默认态不常驻消息操作图标或菜单', { backendId: originalGreeting.backendId });
    await screenshot(miniProgram, '05b-message-actions-default-hidden.png');
    await greetingBubble.longpress();
    data = await waitForData(page, (value) => value.messageActionMenuOpen && value.messageActionMessageId === originalGreeting.backendId, 3000);
    const copyGreetingButton = await page.$('.message-action-menu-item[data-action="copy"]');
    const rewriteGreetingButton = await page.$('.message-action-menu-item[data-action="rewrite"]');
    assert(copyGreetingButton && rewriteGreetingButton, '长按用户消息后在附近显示带文字的复制与重新编辑菜单', data.messageActionMenuActions);
    await screenshot(miniProgram, '05c-message-actions-longpress-menu.png');
    let copiedGreeting = '';
    await miniProgram.exposeFunction('captureM6Clipboard', (value) => {
      copiedGreeting = value;
    });
    await miniProgram.mockWxMethod('setClipboardData', function captureClipboard(options) {
      globalThis.captureM6Clipboard(options && options.data ? options.data : '');
      if (options && typeof options.success === 'function') options.success({ errMsg: 'setClipboardData:ok' });
      return { errMsg: 'setClipboardData:ok' };
    });
    await copyGreetingButton.tap();
    await wait(100);
    await miniProgram.restoreWxMethod('setClipboardData');
    assert(copiedGreeting === '你好', '长按菜单的复制操作把当前用户消息交给微信剪贴板接口', { copiedGreeting });
    await greetingBubble.longpress();
    data = await waitForData(page, (value) => value.messageActionMenuOpen && value.messageActionMessageId === originalGreeting.backendId, 3000);
    const reopenedRewriteButton = await page.$('.message-action-menu-item[data-action="rewrite"]');
    assert(reopenedRewriteButton, '复制后菜单关闭，下一次长按可重新打开');
    await reopenedRewriteButton.tap();
    data = await waitForData(page, (value) => value.rewriteSourceMessageId === originalGreeting.backendId, 3000);
    assert(/你好/.test(data.inputValue) && data.rewriteSourceMessageId > 0, '重新编写先回填原文并明确提示将创建分支', data);
    await screenshot(miniProgram, '05d-rewrite-draft-compact.png');
    await page.callMethod('onInput', { detail: { value: '你好?' } });
    await page.callMethod('sendMessage');
    data = await waitForData(page, (value) =>
      !value.sending && value.activeSessionId !== originalRewriteSessionId,
    15000);
    const rewrittenGreeting = data.messages.filter((item) => item.role === 'user' && item.text === '你好?').slice(-1)[0];
    assert(
      rewrittenGreeting?.backendId > 0 &&
        data.conversations.some((item) => item.sessionId === originalRewriteSessionId),
      '重新编写创建新会话分支，原会话仍保留在切换列表',
      { rewrittenGreeting, conversations: data.conversations }
    );
    await screenshot(miniProgram, '05e-rewrite-created-branch.png');

    const rewrittenGreetingBubble = await page.$(`.user-bubble[data-id="${rewrittenGreeting.backendId}"]`);
    assert(rewrittenGreetingBubble && !(await page.$('.message-action-menu')), '新分支默认态仍不常驻撤回入口', { backendId: rewrittenGreeting.backendId });
    await rewrittenGreetingBubble.longpress();
    data = await waitForData(page, (value) => value.messageActionMenuOpen && value.messageActionMessageId === rewrittenGreeting.backendId, 3000);
    const withdrawGreetingButton = await page.$('.message-action-menu-item[data-action="withdraw"]');
    assert(withdrawGreetingButton, '最后一轮用户消息长按菜单显示撤回本轮', data.messageActionMenuActions);
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await withdrawGreetingButton.tap();
    data = await waitForData(page, (value) =>
      !value.sending && !value.messages.some((item) => item.backendId === rewrittenGreeting.backendId),
    10000);
    await miniProgram.restoreWxMethod('showModal');
    assert(
      !data.messages.some((item) => item.backendId === rewrittenGreeting.backendId),
      '撤回只删除当前分支最后一组用户消息与 NOVA 回复',
      data.messages
    );

    const originalRewriteIndex = data.conversations.findIndex((item) => item.sessionId === originalRewriteSessionId);
    await page.callMethod('onConversationChange', { detail: { value: originalRewriteIndex } });
    data = await waitForData(page, (value) =>
      !value.loadingSession && value.activeSessionId === originalRewriteSessionId,
    10000);
    assert(
      data.messages.some((item) => item.role === 'user' && item.text === '你好'),
      '切回原会话后原始消息仍完整存在',
      data.messages
    );
    await screenshot(miniProgram, '05f-original-conversation-preserved.png');

    await page.callMethod('openAiMemory');
    page = await waitForPage(miniProgram, 'pages/aiMemory/aiMemory', 15000);
    data = await waitForData(page, (value) => !value.loading, 10000);
    const memoryFilterIndex = data.filterOptions.findIndex((item) => item.id === plantPetId);
    assert(memoryFilterIndex >= 0, 'AI 记忆页可按本次隔离植宠筛选');
    await page.callMethod('onFilterChange', { detail: { value: memoryFilterIndex } });
    data = await waitForData(page, (value) => !value.loading && value.selectedPlantPetId === plantPetId, 10000);
    const preferenceIndex = data.memories.findIndex((item) => item.type === 'user_preference');
    const preferenceId = Number(data.memories[preferenceIndex]?.id) || 0;
    assert(page.path === 'pages/aiMemory/aiMemory' && preferenceIndex >= 0 && data.memories.some((item) => item.sourceType === 'diagnosis'), 'AI 记忆页显示偏好、来源、时间和诊断派生记忆', { path: page.path, memories: data.memories });
    await screenshot(miniProgram, '06-ai-memory-governance.png');

    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false, content: '我习惯每周六检查植物' });
    await page.callMethod('editMemory', { currentTarget: { dataset: { id: preferenceId } } });
    data = await waitForData(page, (value) => value.memories.some((item) => /每周六/.test(item.content)), 10000);
    await miniProgram.restoreWxMethod('showModal');
    assert(data.memories.some((item) => /每周六/.test(item.content) && item.userConfirmed), '用户可修正并确认一条 AI 记忆', data.memories);

    const editedIndex = data.memories.findIndex((item) => /每周六/.test(item.content));
    const editedId = data.memories[editedIndex].id;
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('deleteMemory', { currentTarget: { dataset: { id: editedId } } });
    data = await waitForData(page, (value) => !value.memories.some((item) => item.id === editedId), 10000);
    await miniProgram.restoreWxMethod('showModal');
    assert(!data.memories.some((item) => item.id === editedId), '用户可逐条删除 AI 记忆', data.memories);

    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('clearAllMemories');
    data = await waitForData(page, (value) => value.memories.length === 0, 10000);
    await miniProgram.restoreWxMethod('showModal');
    assert(data.memories.length === 0, '用户可在明确影响范围后清除全部结构化 AI 记忆', data);
    const remainingMemories = await request('POST', '/ai/memories', { token, body: {} });
    assert(remainingMemories.json?.memories?.some((item) => item.id === globalPreferenceId), '按植宠清空不会删除账号级或其他植宠记忆', remainingMemories);
    await screenshot(miniProgram, '07-ai-memory-cleared.png');

    assert(exceptions.length === 0, 'M6 NOVA、Vision、记忆与任务页面没有运行时异常', exceptions);
    console.log('M6 微信开发者工具 E2E 全部通过');
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (miniProgram) {
      await miniProgram.callWxMethod('clearStorageSync').catch(() => {});
      await miniProgram.reLaunch('/pages/auth/auth').catch(() => {});
      miniProgram.disconnect();
    }
    if (globalPreferenceId) {
      await request('POST', '/ai/memory-delete', { token, body: { memoryId: globalPreferenceId } }).catch(() => {});
    }
    await request('POST', '/plant/pet-delete', { token, body: { plantPetId: mismatchPlantPetId } }).catch(() => {});
    await request('POST', '/plant/pet-delete', { token, body: { plantPetId } }).catch(() => {});
  }
})().catch((error) => {
  console.error(`[m6-devtools-e2e] ${error.message}`);
  process.exit(1);
});
