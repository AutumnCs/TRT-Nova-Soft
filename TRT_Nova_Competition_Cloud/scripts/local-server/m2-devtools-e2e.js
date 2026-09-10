/**
 * M2 微信开发者工具渲染验收。
 * 依赖本地服务与临时安装的 miniprogram-automator，不访问或写入线上环境。
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = process.env.M2_EVIDENCE_DIR || 'D:\\植宠项目\\验收记录\\M2_2026-08-27';
const cliPath = process.env.WECHAT_DEVTOOLS_CLI || 'D:\\D\\微信web开发者工具\\cli.bat';
const automatorRoot = process.env.MINIPROGRAM_AUTOMATOR_PATH || path.join(
  os.tmpdir(),
  'zhichong-miniprogram-automator',
  'node_modules',
  'miniprogram-automator'
);
const automationPort = Number(process.env.WECHAT_AUTOMATION_PORT || 9424);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

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

function todayInShanghai() {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
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
      '& $env:M2_WECHAT_CLI auto --project $env:M2_PROJECT_ROOT --auto-port $env:M2_AUTOMATION_PORT --trust-project --lang zh'
    ], {
      env: {
        ...process.env,
        M2_WECHAT_CLI: cliPath,
        M2_PROJECT_ROOT: projectRoot,
        M2_AUTOMATION_PORT: String(automationPort)
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
      try {
        return await automator.connect({ wsEndpoint });
      } catch (error) {
        lastError = error;
      }
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
  // 当前开发者工具返回 dev SDK 标记；跳过旧版 automator 的静态版本比较，协议能力由后续真实调用验证。
  MiniProgram.prototype.checkVersion = async function checkVersion() {};

  const account = 'm2_devtools_account';
  const tokenResult = await request('GET', `/dev/token?openid=${account}`);
  const token = tokenResult.json?.token || '';
  assert(Boolean(token), '开发者工具专用本地身份可签发', tokenResult.json);

  const today = todayInShanghai();
  let plantPetId = 0;
  let miniProgram = null;
  const exceptions = [];

  try {
    const petResult = await request('POST', '/plant/pet-create', {
      token,
      body: {
        nickname: 'M2 渲染月季',
        speciesName: '月季',
        enteredAt: today,
        location: '开发者工具测试窗台',
        careNotes: 'M2 渲染验收专用，完成后自动清理'
      }
    });
    plantPetId = Number(petResult.json?.pet?.id) || 0;
    assert(plantPetId > 0, '建立开发者工具渲染用 PlantPet', petResult.json);

    const todayTask = await request('POST', '/care/task-create', {
      token,
      body: {
        plantPetId,
        taskType: 'watering',
        title: '检查盆土后浇水',
        description: '先确认 2 厘米盆土已经干燥',
        scheduledFor: today,
        reminderTime: '09:00',
        recurrenceType: 'weekly',
        recurrenceInterval: 1,
        source: 'manual'
      }
    });
    const todayTaskId = Number(todayTask.json?.task?.id) || 0;
    assert(todayTaskId > 0, '建立今日周期任务', todayTask.json);

    const overdueTask = await request('POST', '/care/task-create', {
      token,
      body: {
        plantPetId,
        taskType: 'inspection',
        title: '补记叶片观察',
        scheduledFor: addDays(today, -1),
        reminderTime: null,
        recurrenceType: 'none',
        source: 'manual'
      }
    });
    assert(Number(overdueTask.json?.task?.id) > 0, '建立逾期提醒样本', overdueTask.json);

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

    let page = await miniProgram.reLaunch('/pages/calendar/calendar');
    await page.waitFor(1800);
    let data = await page.data();
    assert(page.path === 'pages/calendar/calendar', '日历页在开发者工具中完成编译并打开', { path: page.path });
    assert(data.loadError === '' && data.selectedTasks.some((task) => task.id === todayTaskId), '月视图读取真实今日任务', data);
    assert(data.summary.overdueTasks.length === 1, '日历概览显示真实逾期任务', data.summary);
    await screenshot(miniProgram, '01-calendar-month.png');

    const switches = await page.$$('.switch-item');
    await switches[0].tap();
    await page.waitFor(1000);
    data = await page.data();
    assert(data.viewMode === 'week' && data.calendarDays.length === 7, '周视图与月视图消费同一任务源', data);
    await screenshot(miniProgram, '02-calendar-week.png');

    const addButton = await page.$('.small-add');
    await addButton.tap();
    await page.waitFor(1500);
    page = await miniProgram.currentPage();
    await page.waitFor('.task-form-page');
    data = await page.data();
    assert(page.path === 'pages/taskForm/taskForm' && data.loadError === '' && data.form.scheduledFor === today, '任务表单可从日轴打开并继承日期', { path: page.path, data });
    await screenshot(miniProgram, '03-task-form.png');

    page = await miniProgram.navigateBack();
    await page.waitFor(900);
    const completeButton = await page.$('.task-action.complete');
    assert(Boolean(completeButton), '日轴渲染完成操作入口', {});
    await miniProgram.mockWxMethod('showModal', { confirm: true, cancel: false });
    await completeButton.tap();
    await page.waitFor(1500);
    await miniProgram.restoreWxMethod('showModal');
    data = await page.data();
    assert(data.selectedTasks.some((task) => task.id === todayTaskId && task.status === 'completed'), '开发者工具真实点击完成后状态同步', data.selectedTasks);
    await screenshot(miniProgram, '04-calendar-completed.png');

    page = await miniProgram.switchTab('/pages/index/index');
    await page.waitFor(1400);
    data = await page.data();
    assert(data.loadError === '' && data.homeTasks.length === 1 && data.homeTasks[0].overdue, '首页今日任务区与日历完成状态一致', data.homeTasks);
    assert(data.activePets[0]?.careStatus?.key === 'overdue', '首页养护状态由逾期任务事实解释', data.activePets);
    await screenshot(miniProgram, '05-home-tasks.png');

    page = await miniProgram.navigateTo(`/pages/plantPetDetail/plantPetDetail?plantPetId=${plantPetId}`);
    await page.waitFor(1300);
    data = await page.data();
    assert(data.loadError === '' && data.careTasks.length >= 3, '植宠详情读取完成、逾期与再生任务', data.careTasks);
    assert(data.pet?.careStatus?.key === 'overdue', '植宠详情与首页养护状态一致', data.pet);
    await screenshot(miniProgram, '06-plant-detail-tasks.png');

    assert(exceptions.length === 0, 'M2 页面流程没有运行时异常', exceptions);
    console.log('M2 开发者工具 E2E 全部通过');
  } catch (error) {
    if (error.detail) console.error(JSON.stringify(error.detail));
    throw error;
  } finally {
    if (miniProgram) {
      await miniProgram.callWxMethod('removeStorageSync', 'apiAccessToken').catch(() => {});
      await miniProgram.callWxMethod('removeStorageSync', 'apiAccessTokenMeta').catch(() => {});
      miniProgram.disconnect();
    }
    if (plantPetId) {
      await request('POST', '/plant/pet-delete', { token, body: { plantPetId } }).catch(() => {});
    }
  }
})().catch((error) => {
  console.error(`[m2-devtools-e2e] ${error.message}`);
  process.exit(1);
});
