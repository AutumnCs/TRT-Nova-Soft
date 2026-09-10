/**
 * M5 微信开发者工具端到端验收。
 * 登录凭证来自本地 /auth/login，不调用 /dev/token；可验证无凭据降级或真实和风天气链路。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M5_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M5_2026-08-27';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(), 'zhichong-miniprogram-automator', 'node_modules', 'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);
const realWeatherMode = process.argv.includes('--real') || process.env.M5_EXPECT_REAL_WEATHER === 'true';

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

function request(method, requestPath, body = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: Number(process.env.LOCAL_PORT || 3000),
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...extraHeaders
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`invalid JSON from ${requestPath}`));
        }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function connectAutomation(automator) {
  const wsEndpoint = `ws://127.0.0.1:${automationPort}`;
  try {
    return await automator.connect({ wsEndpoint });
  } catch (firstError) {
    const result = childProcess.spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '& $env:M5_WECHAT_CLI auto --project $env:M5_PROJECT_ROOT --auto-port $env:M5_AUTOMATION_PORT --trust-project --lang zh'
    ], {
      env: {
        ...process.env,
        M5_WECHAT_CLI: cliPath,
        M5_PROJECT_ROOT: projectRoot,
        M5_AUTOMATION_PORT: String(automationPort)
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
  await miniProgram.screenshot({ path: output });
  console.log(`[EVIDENCE] ${output}`);
}

(async () => {
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const login = await request('POST', '/auth/login', { code: 'm5-devtools-real-login' });
  assert(login.success && login.accessToken && login.openid, '通过本地真实登录契约取得 M5 验收身份');
  if (realWeatherMode) {
    const authHeaders = { 'x-access-token': login.accessToken };
    const cityResult = await request('POST', '/weather/cities', { query: '北京' }, authHeaders);
    assert(cityResult.success && cityResult.cities?.length, '真实和风城市搜索返回候选');
    const city = cityResult.cities.find((item) => item.locationId === '101010100') || cityResult.cities[0];
    const saved = await request('POST', '/weather/preference', {
      locationId: city.locationId,
      city: city.city,
      adm1: city.adm1,
      adm2: city.adm2,
      source: 'manual'
    }, authHeaders);
    assert(saved.success && saved.preference?.locationId === city.locationId, '通过受身份保护的接口保存真实天气城市');
  }

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  let miniProgram = null;
  const exceptions = [];
  try {
    miniProgram = await connectAutomation(automator);
    miniProgram.on('exception', (error) => exceptions.push(error));
    await miniProgram.callWxMethod('clearStorageSync');
    await miniProgram.callWxMethod('setStorageSync', 'apiAccessToken', login.accessToken);
    await miniProgram.callWxMethod('setStorageSync', 'apiAccessTokenMeta', {
      accessToken: login.accessToken,
      expiresIn: login.expiresIn,
      expiresAt: login.expiresAt,
      openid: login.openid,
      loginTime: Date.now()
    });
    await miniProgram.callWxMethod('setStorageSync', 'userInfo', {
      openid: login.openid,
      nickName: 'M5 验收用户'
    });
    let page = await miniProgram.reLaunch('/pages/index/index');
    await page.waitFor(500);
    const appLoginState = await miniProgram.evaluate(function refreshLoginState() {
      const app = getApp();
      app.checkLoginStatus();
      return { hasLogin: app.globalData.hasLogin, openid: app.globalData.userInfo?.openid || '' };
    });
    assert(appLoginState.hasLogin === true, '应用全局登录态已与 M5 验收身份同步', appLoginState);
    page = await miniProgram.reLaunch('/pages/index/index');
    await page.waitFor(1800);
    let data = await page.data();
    assert(page.path === 'pages/index/index', '首页可在开发者工具中编译并打开', { path: page.path });
    assert(data.solarTerm?.name === '处暑', '首页按 Asia/Shanghai 展示当前节气“处暑”', data.solarTerm);
    assert(/不代表本地实时物候/.test(data.solarTerm?.disclaimer || ''), '节气提示包含物候边界说明');
    if (realWeatherMode) {
      assert(data.weather?.available === true && data.weather?.temp !== '--', '首页展示后端返回的真实天气数值', data.weather);
      assert(data.weather?.cityLabel.includes('北京'), '首页显示已保存的北京城市偏好', data.weather);
      assert(data.weather?.sourceName === '和风天气', '首页标明真实天气来源为和风天气', data.weather);
      assert(Boolean(await page.$('.weather-facts')), '首页渲染真实天气卡片');
      await screenshot(miniProgram, '03-real-weather-home.png');
    } else {
      assert(data.weather?.available === false && data.weather?.temp === '--', '无真实天气时不显示示例温度', data.weather);
      assert(data.weather?.reason === 'location_required', '未设置城市时明确提示 location_required', data.weather);
      assert(Boolean(await page.$('.weather-unavailable')), '首页渲染天气不可用状态');
      await screenshot(miniProgram, '01-no-key-home.png');
    }

    await miniProgram.navigateTo('/pages/weatherSettings/weatherSettings');
    await wait(900);
    page = await miniProgram.currentPage();
    assert(page.path === 'pages/weatherSettings/weatherSettings', '天气城市设置页可打开', { path: page.path });
    const searchInput = await page.$('.search-input');
    assert(Boolean(searchInput), '找到手动城市搜索框');
    await page.callMethod('onQueryInput', { detail: { value: '北京' } });
    data = await page.data();
    assert(data.query === '北京', '手动城市输入已进入页面状态', data);
    if (realWeatherMode) {
      assert(data.currentPreference?.locationId === '101010100', '天气设置页显示当前北京城市偏好', data.currentPreference);
      await page.callMethod('submitSearch');
      await wait(1800);
      data = await page.data();
      assert(data.searchError === '' && data.results.length > 0, '天气设置页取得真实城市搜索候选', data);
      assert(data.results.some((item) => item.locationId === '101010100'), '真实城市候选包含北京 LocationID');
      await screenshot(miniProgram, '04-real-city-settings.png');
    } else {
      await page.callMethod('submitSearch');
      await wait(1200);
      data = await page.data();
      assert(/和风天气尚未配置/.test(data.searchError || ''), '无凭据时城市搜索明确提示未配置', data);
      assert(data.results.length === 0, '无凭据时不生成城市候选');
      await screenshot(miniProgram, '02-no-key-city-search.png');
    }
    assert(exceptions.length === 0, 'M5 天气与节气页面没有运行时异常', exceptions);
    console.log(`M5 ${realWeatherMode ? '真实天气' : '无凭据降级'}微信开发者工具 E2E 全部通过`);
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (miniProgram) {
      await miniProgram.callWxMethod('clearStorageSync').catch(() => {});
      miniProgram.disconnect();
    }
  }
})().catch((error) => {
  console.error(`[m5-devtools-e2e] ${error.message}`);
  process.exit(1);
});
