/**
 * M4 微信开发者工具端到端验收。
 * 登录凭证来自本地 /auth/login，不使用 /dev/token；默认验收当前 10/17 发布态，也可通过环境变量覆盖数量做草稿门禁回归。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M4_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M4_2026-08-27';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(), 'zhichong-miniprogram-automator', 'node_modules', 'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);
const expectedArticles = Number(process.env.M4_EXPECT_ARTICLES || 10);
const expectedPlants = Number(process.env.M4_EXPECT_PLANTS || 17);
const expectedReviewer = String(process.env.M4_EXPECT_REVIEWER || 'dola').trim();
const captureAllEvidence = process.env.M4_CAPTURE_ALL !== 'false';

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

function request(method, requestPath, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: Number(process.env.LOCAL_PORT || 3000),
      path: requestPath,
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (err) { reject(new Error(`invalid JSON from ${requestPath}`)); }
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
      '& $env:M4_WECHAT_CLI auto --project $env:M4_PROJECT_ROOT --auto-port $env:M4_AUTOMATION_PORT --trust-project --lang zh'
    ], {
      env: {
        ...process.env,
        M4_WECHAT_CLI: cliPath,
        M4_PROJECT_ROOT: projectRoot,
        M4_AUTOMATION_PORT: String(automationPort)
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

  const login = await request('POST', '/auth/login', { code: 'm4-devtools-e2e' });
  assert(login.success && login.accessToken && login.openid, '通过本地真实登录契约取得 M4 验收身份');

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  let miniProgram = null;
  const exceptions = [];
  try {
    miniProgram = await connectAutomation(automator);
    console.log('[STEP] 已连接微信开发者工具自动化');
    miniProgram.on('exception', (error) => exceptions.push(error));
    await miniProgram.callWxMethod('clearStorageSync');
    console.log('[STEP] 已清空旧登录缓存');
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
      nickName: 'M4 验收用户'
    });
    const storedMeta = await miniProgram.callWxMethod('getStorageSync', 'apiAccessTokenMeta');
    const storedUser = await miniProgram.callWxMethod('getStorageSync', 'userInfo');
    assert(storedMeta?.openid === login.openid && storedUser?.openid === login.openid, '本地验收身份已写入当前小程序存储', { storedMeta, storedUser });
    const appLoginState = await miniProgram.evaluate(function refreshLoginState() {
      const app = getApp();
      app.checkLoginStatus();
      return { hasLogin: app.globalData.hasLogin, openid: app.globalData.userInfo?.openid || '' };
    });
    assert(appLoginState.hasLogin === true, '应用全局登录态已与当前验收身份同步', appLoginState);
    console.log('[STEP] 已写入 /auth/login 返回的本地验收身份');

    let page = await miniProgram.reLaunch('/pages/wiki/wiki');
    console.log('[STEP] 已请求打开知识库页面');
    await page.waitFor(1600);
    let data = await page.data();
    assert(page.path === 'pages/wiki/wiki', '知识库页面可在开发者工具中编译并打开', { path: page.path });
    assert(data.articles.length === expectedArticles, `知识文章只显示 ${expectedArticles} 条已发布内容`, data.articles);
    assert(data.filteredArticles.length === expectedArticles, '知识文章筛选结果与发布门禁一致');
    if (captureAllEvidence) {
      await screenshot(miniProgram, expectedArticles ? '03-published-articles.png' : '01-draft-articles-hidden.png');
    }

    if (expectedArticles > 0) {
      const roseArticle = data.articles.find((item) => item.slug === 'rose-container-care');
      assert(Boolean(roseArticle), '已发布文章中包含月季盆栽养护');
      assert(
        data.articles.every((item) => item.status === 'published' && item.sourcePublisher && item.sourceUrl),
        '所有文章均带已发布状态和可读来源',
        data.articles
      );
      if (expectedReviewer) {
        assert(data.articles.every((item) => item.reviewedBy === expectedReviewer), `所有文章审核人均为 ${expectedReviewer}`);
      }
      const searchInput = await page.$('.search-input');
      assert(Boolean(searchInput), '找到知识库搜索框');
      await searchInput.input('月季');
      await wait(400);
      data = await page.data();
      assert(data.filteredArticles.length === 1 && data.filteredArticles[0].slug === roseArticle.slug, '页面搜索可定位月季文章');
      const roseCard = await page.$('.article-card');
      assert(Boolean(roseCard), '找到月季文章卡片');
      await miniProgram.navigateTo(`/pages/wikiDetail/wikiDetail?articleId=${encodeURIComponent(roseArticle.id)}`);
      await wait(1000);
      const detailPage = await miniProgram.currentPage();
      const detailData = await detailPage.data();
      assert(detailPage.path === 'pages/wikiDetail/wikiDetail', '月季文章详情页可打开', { path: detailPage.path });
      assert(
        detailData.article?.sourceUrl && detailData.article?.sourcePublisher && detailData.article?.reviewedBy,
        '文章详情展示来源和审核信息',
        detailData.article
      );
      if (captureAllEvidence) await screenshot(miniProgram, '04-published-article-detail.png');
      page = await miniProgram.reLaunch('/pages/wiki/wiki');
      await page.waitFor(1200);
    }

    await page.callMethod('switchToPlants');
    await page.waitFor(1000);
    data = await page.data();
    assert(data.plants.length === expectedPlants, `植物图鉴只显示 ${expectedPlants} 条已发布内容`, data.plants);
    assert(data.filteredPlants.length === expectedPlants, '植物图鉴筛选结果与发布门禁一致');

    if (expectedPlants > 0) {
      const rosePlant = data.plants.find((item) => item.name === '月季');
      assert(Boolean(rosePlant), '已发布植物档案中包含月季');
      assert(
        data.plants.every((item) => item.status === 'published' && item.sourcePublisher && item.sourceUrl),
        '所有植物档案均带已发布状态和可读来源',
        data.plants
      );
      if (expectedReviewer) {
        assert(data.plants.every((item) => item.reviewedBy === expectedReviewer), `所有植物档案审核人均为 ${expectedReviewer}`);
      }
      const plantSearchInput = await page.$('.search-input');
      assert(Boolean(plantSearchInput), '找到植物图鉴搜索框');
      await plantSearchInput.input('月季');
      await wait(400);
      data = await page.data();
      assert(data.filteredPlants.length === 1 && data.filteredPlants[0].name === '月季', '页面搜索可定位月季植物档案');
      await page.callMethod('togglePlant', { currentTarget: { dataset: { id: rosePlant.viewId } } });
      data = await page.data();
      assert(data.expandedPlantId === rosePlant.viewId, '月季植物档案可展开养护参数和来源');
    }
    await screenshot(miniProgram, expectedPlants ? '05-published-plants.png' : '02-draft-plants-hidden.png');
    assert(exceptions.length === 0, 'M4 知识页没有运行时异常', exceptions);
    console.log('M4 微信开发者工具 E2E 全部通过');
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
  console.error(`[m4-devtools-e2e] ${error.message}`);
  process.exit(1);
});
