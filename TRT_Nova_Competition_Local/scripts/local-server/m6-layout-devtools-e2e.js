/**
 * M6 助手布局回归：使用固定长消息验证消息区延伸到浮动 composer 下方，
 * 同时在滚动末尾为最后一条回答保留可读安全区。
 *
 * 该脚本不调用 Chat/Vision 模型，只通过本地 /auth/login 建立真实客户端身份，
 * 再在微信开发者工具中注入可重复的长消息场景并保存截图。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M6_LAYOUT_EVIDENCE_DIR
  || 'D:\\植宠项目\\验收记录\\M6_2026-08-28\\11-layout-agent-architecture';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(), 'zhichong-miniprogram-automator', 'node_modules', 'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);
const labelArg = process.argv.find((item) => item.startsWith('--label='));
const evidenceLabel = String(labelArg ? labelArg.slice('--label='.length) : 'layout').replace(/[^a-z0-9_-]/gi, '-');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function request(method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: Number(process.env.LOCAL_PORT || 3000),
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      },
      timeout: 10000
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

async function measureLayout(miniProgram) {
  return miniProgram.evaluate(function queryAssistantLayout() {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    const windowInfo = wx.getWindowInfo();
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(page)
        .select('.assistant-header').boundingClientRect()
        .select('.message-scroll').boundingClientRect()
        .select('#msg-2').boundingClientRect()
        .select('#message-end').boundingClientRect()
        .select('.input-panel').boundingClientRect()
        .select('.input-card').boundingClientRect()
        .exec((rects) => resolve({
          window: { width: windowInfo.windowWidth, height: windowInfo.windowHeight },
          header: rects[0] || null,
          messageScroll: rects[1] || null,
          lastMessage: rects[2] || null,
          messageEnd: rects[3] || null,
          inputPanel: rects[4] || null,
          inputCard: rects[5] || null
        }));
    });
  });
}

async function screenshot(miniProgram, output) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await wait(800);
      await miniProgram.screenshot({ path: output });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

(async () => {
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const login = await request('POST', '/auth/login', { code: `m6-layout-${evidenceLabel}` });
  const token = login.json?.accessToken || '';
  assert(login.status === 200 && login.json?.success && token, '通过本地真实登录契约取得布局验收身份', login);

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
      userInfo: { openid: login.json.openid, nickName: 'M6 布局验收用户' }
    });
    await miniProgram.evaluate(function refreshLoginState() {
      const app = getApp();
      app.checkLoginStatus();
      return app.globalData.hasLogin;
    });

    const page = await miniProgram.reLaunch('/pages/assistant/assistant');
    await page.waitFor(11000);
    await page.setData({
      loadingSession: false,
      loadError: '',
      selectedPlantPet: { id: 1, nickname: '1', speciesName: '龟背竹' },
      plantPets: [{ id: 1, nickname: '1', speciesName: '龟背竹' }],
      messages: [
        {
          id: 'layout-welcome', role: 'assistant', timeLabel: '',
          text: '你好，我是 NOVA。把一盆植宠交给我后，我会结合它的档案、养护记录和已发布知识陪你判断下一步；证据不够时，我会直接说不确定。',
          summary: '我只提出建议，不会未经确认替你写任务或修改档案。',
          suggestions: ['你记得这盆植物什么？', '这盆植物平时怎么浇水？'],
          sources: [], taskSuggestions: []
        },
        {
          id: 'layout-user-1', role: 'user', timeLabel: '13:38',
          text: '月季怎么浇水，并帮我安排一个观察任务？',
          summary: '', suggestions: [], sources: [], taskSuggestions: []
        },
        {
          id: 'layout-answer', role: 'assistant', timeLabel: '', loading: true,
          text: 'NOVA 正在整理档案、记忆和知识依据…',
          summary: '', suggestions: [], sources: [], taskSuggestions: []
        }
      ],
      inputValue: '',
      canSend: false,
      scrollAnchor: ''
    });
    await page.callMethod('scrollToBottomSoon');
    await wait(500);
    await page.setData({
      messages: [
        ...((await page.data()).messages.slice(0, 2)),
        {
          id: 'layout-answer', role: 'assistant', timeLabel: '13:39',
          text: [
            '我先陪你把浇水判断拆成三步：看盆土表层、感受盆体重量、检查排水。',
            '盆土表层变干且盆体明显变轻时，再一次浇透并排掉积水；如果仍然潮湿，就先继续观察。',
            '浇水后记录盆土重新变干所需的天数，比照搬固定周期更可靠。遇到持续黄叶、根部异味或积水时，先停止追加浇水。',
            '观察任务会先作为待确认建议交给你修改，不会直接写入日历。'
          ].join('\n\n'),
          summary: '这是一条用于验证加载占位被长回答替换后滚动边界的固定文本。',
          suggestions: [], sources: [], taskSuggestions: []
        }
      ]
    });
    await page.callMethod('scrollToBottomSoon');
    await wait(1200);

    const metrics = await measureLayout(miniProgram);
    assert(Boolean(metrics.messageEnd), '消息流存在独立末端锚点', metrics);
    assert(
      metrics.lastMessage && metrics.inputPanel && metrics.lastMessage.bottom <= metrics.inputPanel.top + 1,
      '加载占位替换成长回答后，回答末端可滚动到浮动输入区上方',
      metrics
    );
    assert(
      metrics.messageEnd.bottom <= metrics.inputPanel.top + 1,
      '末端锚点停在浮动输入区上方，没有落入遮挡区',
      metrics
    );
    assert(
      metrics.messageScroll.bottom >= metrics.inputPanel.bottom + 1,
      '消息滚动区延伸到透明输入浮层下方，不再为输入区铺设独立矩形底板',
      metrics
    );
    const tabShellHeight = 132 * metrics.window.width / 750;
    const composerGap = metrics.window.height - tabShellHeight - metrics.inputPanel.bottom;
    assert(metrics.header.height <= 230, '紧凑头部把主要高度还给对话区', metrics);
    assert(metrics.messageScroll.height >= 320, '对话区保留足够的可视高度', metrics);
    assert(composerGap >= -1 && composerGap <= 10, '输入区紧贴自定义底栏且没有大片纯色间隔', { composerGap, metrics });
    assert(metrics.inputPanel.height <= 105 && metrics.inputCard.height <= 55, '快捷提问与 composer 保持紧凑', metrics);
    const output = path.join(evidenceDir, `${evidenceLabel}-long-message-layout.png`);
    await screenshot(miniProgram, output);
    fs.writeFileSync(
      path.join(evidenceDir, `${evidenceLabel}-long-message-layout.json`),
      `${JSON.stringify(metrics, null, 2)}\n`,
      'utf8'
    );
    console.log(`[EVIDENCE] ${output}`);
    console.log(`[METRICS] ${JSON.stringify(metrics)}`);
    assert(exceptions.length === 0, '布局场景没有运行时异常', exceptions);
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (miniProgram) {
      await miniProgram.callWxMethod('clearStorageSync').catch(() => {});
      await miniProgram.reLaunch('/pages/auth/auth').catch(() => {});
      miniProgram.disconnect();
    }
  }
})().catch((error) => {
  console.error(`[m6-layout-devtools-e2e] ${error.message}`);
  process.exit(1);
});
