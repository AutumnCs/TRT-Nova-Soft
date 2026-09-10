/**
 * M3 微信开发者工具渲染验收。
 * 验证成长时间线图文持久化、头像实际格式兼容、详情预览和菜单震动语义。
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
        ...(token ? { 'x-access-token': token } : {})
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

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  console.log(`[PASS] ${message}`);
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

(async () => {
  assert(fs.existsSync(cliPath), '找到微信开发者工具 CLI', { cliPath });
  assert(fs.existsSync(automatorRoot), '找到本地 miniprogram-automator', { automatorRoot });
  fs.mkdirSync(evidenceDir, { recursive: true });

  const automator = require(automatorRoot);
  const MiniProgram = require(path.join(automatorRoot, 'out', 'MiniProgram')).default;
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  const fixtureBase64 = fs.readFileSync(path.join(projectRoot, 'images', 'plant-default.jpg')).toString('base64');
  const account = 'm3_devtools_account';
  const tokenResult = await request('GET', `/dev/token?openid=${account}`);
  const token = tokenResult.json?.token || '';
  assert(Boolean(token), '开发者工具专用本地身份可签发', tokenResult.json);

  let plantPetId = 0;
  let avatarFileId = '';
  let miniProgram = null;
  const exceptions = [];

  try {
    const avatarUpload = await request('POST', '/media/upload', {
      token,
      body: { purpose: 'profile_avatar', originalName: 'avatar.heic', dataBase64: fixtureBase64 }
    });
    avatarFileId = avatarUpload.json?.media?.fileId || '';
    assert(avatarUpload.json?.media?.mimeType === 'image/jpeg' && avatarFileId, '头像使用错误后缀仍按真实 JPEG 格式保存', avatarUpload.json);
    const profile = await request('POST', '/user/profile', {
      token,
      body: { nickName: 'M3 渲染用户', avatarFileId, avatarUrl: '' }
    });
    assert(profile.json?.profile?.avatarFileId === avatarFileId, '头像永久标识已绑定当前账号', profile.json);

    const petResult = await request('POST', '/plant/pet-create', {
      token,
      body: {
        nickname: 'M3 渲染月季',
        speciesName: '月季',
        enteredAt: '2026-08-27',
        location: '开发者工具测试窗台',
        careNotes: 'M3 渲染验收专用，完成后自动清理'
      }
    });
    plantPetId = Number(petResult.json?.pet?.id) || 0;
    assert(plantPetId > 0, '建立开发者工具渲染用 PlantPet', petResult.json);

    miniProgram = await connectAutomation(automator);
    miniProgram.on('exception', (error) => exceptions.push(error));
    await miniProgram.callWxMethod('setStorageSync', 'apiAccessToken', token);
    await miniProgram.callWxMethod('setStorageSync', 'apiAccessTokenMeta', {
      accessToken: token,
      openid: account,
      loginTime: Date.now()
    });
    await miniProgram.evaluate(function refreshLoginState() {
      const app = getApp();
      app.checkLoginStatus();
      return app.globalData.hasLogin;
    });

    let page = await miniProgram.reLaunch(`/pages/plantJournal/plantJournal?plantPetId=${plantPetId}&compose=1`);
    await page.waitFor(1800);
    let data = await page.data();
    assert(page.path === 'pages/plantJournal/plantJournal' && data.loadError === '' && data.showComposer, '成长时间线完成编译并打开新增面板', { path: page.path, data });
    await screenshot(miniProgram, '01-journal-composer.png');

    const tempPhotoPath = await miniProgram.evaluate(function writeFixture(base64) {
      const output = `${wx.env.USER_DATA_PATH}/m3-growth-photo.jpg`;
      wx.getFileSystemManager().writeFileSync(output, base64, 'base64');
      return output;
    }, fixtureBase64);
    await page.setData({
      draft: {
        ...data.draft,
        plantPetId,
        title: '长出了第一片新叶',
        content: '叶片已经展开，颜色正常。',
        photos: [{ key: 'm3-fixture', fileId: '', tempPath: tempPhotoPath, displayUrl: tempPhotoPath }]
      }
    });
    const saveButton = await page.$('.save-btn');
    await saveButton.tap();
    await page.waitFor(2200);
    data = await page.data();
    assert(!data.showComposer && data.records.length === 1 && data.records[0].photos.length === 1, '在小程序端上传并渲染一条图文成长记录', data.records);
    await screenshot(miniProgram, '02-journal-timeline.png');

    page = await miniProgram.reLaunch(`/pages/plantJournal/plantJournal?plantPetId=${plantPetId}`);
    await page.waitFor(1800);
    data = await page.data();
    assert(data.records.length === 1 && data.records[0].title === '长出了第一片新叶' && data.records[0].photos.length === 1, '重载小程序后文字、照片与排序仍持久存在', data.records);

    page = await miniProgram.navigateTo(`/pages/plantPetDetail/plantPetDetail?plantPetId=${plantPetId}`);
    await page.waitFor(1500);
    data = await page.data();
    assert(data.loadError === '' && data.recentJournal.length === 1 && data.recentJournal[0].coverPhoto, '植宠详情展示最近图文成长记录', data.recentJournal);
    await screenshot(miniProgram, '03-plant-detail-journal.png');

    page = await miniProgram.switchTab('/pages/profile/profile');
    await page.waitFor(1800);
    data = await page.data();
    assert(data.user.name === 'M3 渲染用户' && data.user.avatar.includes('zhichong-media-cache') && data.recentGrowth.length === 1, '“我的”正确显示真实格式头像与跨植宠最近成长', { user: data.user, recentGrowth: data.recentGrowth });
    await screenshot(miniProgram, '04-profile-growth-avatar.png');

    page = await miniProgram.navigateTo('/pages/profileEdit/profileEdit');
    await page.waitFor(1500);
    data = await page.data();
    assert(data.form.avatarFileId === avatarFileId && data.form.avatarUrl.includes('zhichong-media-cache'), '个人资料页正确回填字节识别后的头像', data.form);
    await screenshot(miniProgram, '05-profile-edit-avatar.png');
    page = await miniProgram.navigateBack();
    await page.waitFor(800);
    page = await miniProgram.switchTab('/pages/profile/profile');
    await page.waitFor(1000);

    await miniProgram.evaluate(function installVibrationCounter() {
      getApp().globalData.__m3VibrateCount = 0;
      wx.vibrateShort = function vibrateShort(options) {
        getApp().globalData.__m3VibrateCount += 1;
        if (options && typeof options.success === 'function') options.success({ errMsg: 'vibrateShort:ok' });
      };
    });
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 6 } } });
    const afterAvailable = await miniProgram.evaluate(function getVibrationCount() {
      return getApp().globalData.__m3VibrateCount;
    });
    await miniProgram.restoreWxMethod('showModal');
    await page.waitFor(300);
    await page.callMethod('onMenuItemTap', { currentTarget: { dataset: { index: 9 } } });
    await page.waitFor(1200);
    const settingsPage = await miniProgram.currentPage();
    const afterSettings = await miniProgram.evaluate(function getVibrationCount() {
      return getApp().globalData.__m3VibrateCount;
    });
    assert(
      afterAvailable === 0 && afterSettings === 0 && settingsPage.path === 'pages/settings/settings',
      '可用栏目与已开放的系统设置均不震动，系统设置可实际进入',
      { afterAvailable, afterSettings, settingsPath: settingsPage.path }
    );

    assert(exceptions.length === 0, 'M3 页面流程没有运行时异常', exceptions);
    console.log('M3 开发者工具 E2E 全部通过');
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (miniProgram) {
      await miniProgram.callWxMethod('removeStorageSync', 'apiAccessToken').catch(() => {});
      await miniProgram.callWxMethod('removeStorageSync', 'apiAccessTokenMeta').catch(() => {});
      miniProgram.disconnect();
    }
    if (plantPetId) await request('POST', '/plant/pet-delete', { token, body: { plantPetId } }).catch(() => {});
    if (avatarFileId) await request('POST', '/user/profile', {
      token,
      body: { nickName: 'M3 渲染用户', avatarFileId: '', avatarUrl: '' }
    }).catch(() => {});
  }
})().catch((error) => {
  console.error(`[m3-devtools-e2e] ${error.message}`);
  process.exit(1);
});
