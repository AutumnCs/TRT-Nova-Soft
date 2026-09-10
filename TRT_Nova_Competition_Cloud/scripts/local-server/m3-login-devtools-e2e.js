/**
 * M3 登录修复的微信开发者工具端到端验收。
 * 从登录页点击真实按钮，执行 wx.login -> 本地 /auth/login -> JWT，禁止注入 /dev/token。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M3_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M3_2026-08-27';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(),
  'zhichong-miniprogram-automator',
  'node_modules',
  'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  console.log(`[PASS] ${message}`);
}

function request(method, requestPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      host: '127.0.0.1',
      port: Number(process.env.LOCAL_PORT || 3000),
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
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
    req.on('error', reject);
    req.end(payload);
  });
}

async function screenshot(miniProgram, fileName) {
  const output = path.join(evidenceDir, fileName);
  await miniProgram.screenshot({ path: output });
  console.log(`[EVIDENCE] ${output}`);
}

async function connectAutomation(automator) {
  const wsEndpoint = `ws://127.0.0.1:${automationPort}`;
  try {
    return await automator.connect({ wsEndpoint });
  } catch (firstError) {
    const result = childProcess.spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '& $env:M3_WECHAT_CLI auto --project $env:M3_PROJECT_ROOT --auto-port $env:M3_AUTOMATION_PORT --trust-project --lang zh'
    ], {
      env: {
        ...process.env,
        M3_WECHAT_CLI: cliPath,
        M3_PROJECT_ROOT: projectRoot,
        M3_AUTOMATION_PORT: String(automationPort)
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

async function waitForLoginState(page, expected, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const data = await page.data();
    if (data.loginState === expected) return data;
    await wait(250);
  }
  return page.data();
}

(async () => {
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  let miniProgram = null;
  let authenticatedToken = '';
  const exceptions = [];

  try {
    miniProgram = await connectAutomation(automator);
    miniProgram.on('exception', (error) => exceptions.push(error));
    let page = await miniProgram.reLaunch('/pages/auth/auth');
    await page.waitFor(500);
    await miniProgram.callWxMethod('clearStorageSync');
    page = await miniProgram.reLaunch('/pages/auth/auth');
    await page.waitFor(800);
    let data = await page.data();
    const tokenBefore = await miniProgram.callWxMethod('getStorageSync', 'apiAccessToken');
    assert(page.path === 'pages/auth/auth' && data.loginState === 'choose' && !tokenBefore, '从无登录态的真实登录页开始', { path: page.path, data, tokenBefore });
    await screenshot(miniProgram, '06-login-page.png');

    const loginButton = await page.$('.wechat-login-btn');
    assert(Boolean(loginButton), '找到“微信一键登录”按钮');
    await loginButton.tap();
    data = await waitForLoginState(page, 'wechat-profile');

    const token = await miniProgram.callWxMethod('getStorageSync', 'apiAccessToken');
    const tokenMeta = await miniProgram.callWxMethod('getStorageSync', 'apiAccessTokenMeta');
    authenticatedToken = token;
    assert(
      data.loginState === 'wechat-profile' && Boolean(token) && tokenMeta?.accessToken === token && Boolean(tokenMeta?.openid),
      '点击真实按钮完成 wx.login、/auth/login 与 JWT 落盘',
      { data, tokenPresent: Boolean(token), tokenMeta }
    );

    const profile = await request('GET', '/user/profile', { token });
    assert(profile.status === 200 && profile.json?.success === true, '登录页签发的 JWT 可访问受保护接口', profile);
    assert(profile.json?.profile?.openid === tokenMeta.openid, '登录用户写入本地 users 且身份与 JWT 一致', { profile: profile.json?.profile, tokenMeta });
    await screenshot(miniProgram, '07-wechat-login-success.png');

    const fixtureBase64 = fs.readFileSync(path.join(projectRoot, 'images', 'plant-default.jpg')).toString('base64');
    const tempAvatarPath = await miniProgram.evaluate(function writeLoginAvatar(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m3-login-avatar.jpg`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, fixtureBase64);
    await page.callMethod('onChooseAvatar', { detail: { avatarUrl: tempAvatarPath } });
    await page.callMethod('onNickNameChange', { detail: { value: 'M3 登录验收用户' } });
    data = await page.data();
    assert(data.canSave === true, '登录后可以继续完成头像昵称设置', data.userInfo);

    const enterButton = await page.$('.login-btn');
    await enterButton.tap();
    await wait(2200);
    const currentPage = await miniProgram.currentPage();
    const userInfo = await miniProgram.callWxMethod('getStorageSync', 'userInfo');
    assert(currentPage.path === 'pages/index/index' && userInfo?.openid === tokenMeta.openid, '从登录页完成资料保存并进入花园首页', { path: currentPage.path, userInfo, tokenMeta });
    await screenshot(miniProgram, '08-login-home.png');

    assert(exceptions.length === 0, '真实登录流程没有运行时异常', exceptions);
    console.log('M3 登录页真实开发者工具 E2E 全部通过');
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (authenticatedToken) {
      await request('POST', '/user/profile', {
        token: authenticatedToken,
        body: { nickName: '', avatarFileId: '', avatarUrl: '' }
      }).catch(() => {});
    }
    if (miniProgram) {
      await miniProgram.callWxMethod('clearStorageSync').catch(() => {});
      miniProgram.disconnect();
    }
  }
})().catch((error) => {
  console.error(`[m3-login-devtools-e2e] ${error.message}`);
  process.exit(1);
});
