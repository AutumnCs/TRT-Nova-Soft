/**
 * M2 本地冒烟：任务排程、确认门、打卡事件、重复再生、延期、删除与双账号隔离。
 * 使用专用本地测试账号；不输出 JWT，不访问线上环境。
 */

const http = require('http');

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3000);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      host,
      port,
      path,
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

let failures = 0;
function check(name, condition, detail) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}`);
  if (!condition) {
    failures += 1;
    console.log(JSON.stringify(detail));
  }
}

async function getDevToken(openid) {
  const response = await request('GET', `/dev/token?openid=${encodeURIComponent(openid)}`);
  check(`${openid} 本地 token 签发`, response.status === 200 && Boolean(response.json?.token), {
    status: response.status,
    success: response.json?.success
  });
  return response.json?.token || '';
}

async function createPlantPet(token, nickname) {
  const response = await request('POST', '/plant/pet-create', {
    token,
    body: {
      nickname,
      speciesName: '月季',
      enteredAt: todayInShanghai(),
      location: 'M2 本地测试区',
      careNotes: '仅用于 M2 本地冒烟，结束后清理'
    }
  });
  return { response, id: Number(response.json?.pet?.id) || 0 };
}

(async () => {
  const suffix = String(Date.now()).slice(-6);
  const accountA = 'm2_isolation_account_a';
  const accountB = 'm2_isolation_account_b';
  let tokenA = '';
  let tokenB = '';
  let petAId = 0;
  let petBId = 0;

  try {
    tokenA = await getDevToken(accountA);
    tokenB = await getDevToken(accountB);
    const petA = await createPlantPet(tokenA, `M2 月季 A ${suffix}`);
    const petB = await createPlantPet(tokenB, `M2 月季 B ${suffix}`);
    petAId = petA.id;
    petBId = petB.id;
    check('双账号分别建立测试植宠', petAId > 0 && petBId > 0, { petA: petA.response.json, petB: petB.response.json });

    const today = todayInShanghai();
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);

    const unconfirmed = await request('POST', '/care/task-create', {
      token: tokenA,
      body: {
        plantPetId: petAId,
        taskType: 'inspection',
        title: 'AI 未确认建议',
        scheduledFor: today,
        source: 'ai'
      }
    });
    check('AI 建议未经确认不能写入', unconfirmed.json?.success === false && /确认/.test(unconfirmed.json?.msg || ''), unconfirmed.json);

    const crossPlant = await request('POST', '/care/task-create', {
      token: tokenA,
      body: {
        plantPetId: petBId,
        taskType: 'watering',
        title: '不应写入 B 的任务',
        scheduledFor: today,
        source: 'manual'
      }
    });
    check('任务不能写入其他账号的植宠', crossPlant.json?.success === false, crossPlant.json);

    const recurring = await request('POST', '/care/task-create', {
      token: tokenA,
      body: {
        plantPetId: petAId,
        taskType: 'watering',
        title: '检查盆土后浇水',
        description: '确认盆土干燥后再浇',
        scheduledFor: today,
        recurrenceType: 'weekly',
        recurrenceInterval: 1,
        source: 'manual'
      }
    });
    const recurringId = Number(recurring.json?.task?.id) || 0;
    check(
      '手动周期任务使用默认 09:00 并保留完整字段',
      recurring.json?.success === true && recurringId > 0 &&
        recurring.json?.task?.plantPetId === petAId &&
        recurring.json?.task?.reminderTime === '09:00' &&
        recurring.json?.task?.recurrenceType === 'weekly',
      recurring.json
    );

    const confirmedAi = await request('POST', '/care/task-create', {
      token: tokenA,
      body: {
        plantPetId: petAId,
        taskType: 'inspection',
        title: '观察新叶',
        scheduledFor: today,
        reminderTime: null,
        recurrenceType: 'none',
        source: 'ai',
        confirmed: true
      }
    });
    check('伪造 confirmed 标志不能绕过待确认候选', confirmedAi.json?.success === false && /待确认候选/.test(confirmedAi.json?.msg || ''), confirmedAi.json);
    // M7 replaced the old client-only confirmed flag with server-side proposals.
    // Real proposal confirmation is covered by M7 and the built-cloud rehearsal.
    const oneOff = await request('POST', '/care/task-create', {
      token: tokenA,
      body: { plantPetId: petAId, taskType: 'inspection', title: '观察新叶', scheduledFor: today,
        reminderTime: null, recurrenceType: 'none', source: 'manual' }
    });
    const aiTaskId = Number(oneOff.json?.task?.id) || 0;
    check('手动单次任务可保留无提醒设置', oneOff.json?.success === true && aiTaskId > 0 && oneOff.json?.task?.reminderTime === '', oneOff.json);

    const edited = await request('POST', '/care/task-update', {
      token: tokenA,
      body: {
        taskId: recurringId,
        plantPetId: petAId,
        taskType: 'watering',
        title: '检查 2 厘米盆土后浇水',
        description: '编辑后的判断标准',
        scheduledFor: today,
        reminderTime: '08:30',
        recurrenceType: 'weekly',
        recurrenceInterval: 1
      }
    });
    check('任务编辑持久化', edited.json?.task?.title === '检查 2 厘米盆土后浇水' && edited.json?.task?.reminderTime === '08:30', edited.json);

    const postponed = await request('POST', '/care/task-postpone', {
      token: tokenA,
      body: { taskId: aiTaskId, scheduledFor: tomorrow }
    });
    check('任务可延期且仍保持待完成', postponed.json?.task?.scheduledFor === tomorrow && postponed.json?.task?.status === 'pending', postponed.json);

    const forbiddenResults = await Promise.all([
      request('POST', '/care/task-update', { token: tokenB, body: { taskId: recurringId, plantPetId: petBId, taskType: 'watering', title: '越权编辑', scheduledFor: today } }),
      request('POST', '/care/task-postpone', { token: tokenB, body: { taskId: recurringId, scheduledFor: tomorrow } }),
      request('POST', '/care/task-complete', { token: tokenB, body: { taskId: recurringId } }),
      request('POST', '/care/task-delete', { token: tokenB, body: { taskId: recurringId } })
    ]);
    check('编辑、延期、完成和删除都拒绝跨账号操作', forbiddenResults.every((item) => item.json?.success === false), forbiddenResults.map((item) => item.json));

    const completed = await request('POST', '/care/task-complete', {
      token: tokenA,
      body: { taskId: recurringId }
    });
    const nextTaskId = Number(completed.json?.nextTask?.id) || 0;
    check(
      '完成任务保留完成状态、写事件并从实际完成日生成下一次',
      completed.json?.task?.status === 'completed' &&
        Boolean(completed.json?.task?.completedAt) &&
        nextTaskId > 0 &&
        completed.json?.nextTask?.scheduledFor === addDays(today, 7),
      completed.json
    );

    const duplicateComplete = await request('POST', '/care/task-complete', {
      token: tokenA,
      body: { taskId: recurringId }
    });
    const events = await request('POST', '/care/events', {
      token: tokenA,
      body: { plantPetId: petAId }
    });
    check(
      '重复打卡不会重复生成事件或下一次任务',
      duplicateComplete.json?.success === false &&
        events.json?.events?.filter((event) => event.taskId === recurringId).length === 1,
      { duplicateComplete: duplicateComplete.json, events: events.json }
    );

    const overdue = await request('POST', '/care/task-create', {
      token: tokenA,
      body: {
        plantPetId: petAId,
        taskType: 'inspection',
        title: '逾期边界任务',
        scheduledFor: yesterday,
        reminderTime: '09:00',
        recurrenceType: 'none',
        source: 'manual'
      }
    });
    const overdueId = Number(overdue.json?.task?.id) || 0;
    const summary = await request('GET', '/care/summary', { token: tokenA });
    check(
      '今日/逾期提醒、连续记录和首批徽章来自真实任务事实',
      summary.json?.overdueTasks?.some((task) => task.id === overdueId) &&
        summary.json?.badges?.some((badge) => badge.key === 'first_plant_pet' && badge.earned) &&
        summary.json?.badges?.some((badge) => badge.key === 'first_checkin' && badge.earned),
      summary.json
    );

    const listA = await request('POST', '/care/tasks', { token: tokenA, body: { plantPetId: petAId, status: 'all', includeArchivedPlants: true } });
    const listB = await request('POST', '/care/tasks', { token: tokenB, body: { status: 'all', includeArchivedPlants: true } });
    check(
      '任务列表按 JWT owner 隔离并保留已完成任务',
      listA.json?.tasks?.some((task) => task.id === recurringId && task.status === 'completed') &&
        listA.json?.tasks?.some((task) => task.id === nextTaskId && task.status === 'pending') &&
        !listB.json?.tasks?.some((task) => task.plantPetId === petAId),
      { listA: listA.json, listB: listB.json }
    );

    const deletedTask = await request('POST', '/care/task-delete', { token: tokenA, body: { taskId: aiTaskId } });
    const afterTaskDelete = await request('POST', '/care/task', { token: tokenA, body: { taskId: aiTaskId } });
    check('单条任务删除后所有任务入口均不可读取', deletedTask.json?.success === true && afterTaskDelete.json?.success === false, { deletedTask: deletedTask.json, afterTaskDelete: afterTaskDelete.json });

    const deletedPet = await request('POST', '/plant/pet-delete', { token: tokenA, body: { plantPetId: petAId } });
    const tasksAfterPetDelete = await request('POST', '/care/tasks', { token: tokenA, body: { plantPetId: petAId, status: 'all', includeArchivedPlants: true } });
    const eventsAfterPetDelete = await request('POST', '/care/events', { token: tokenA, body: { plantPetId: petAId } });
    check(
      '永久删除植宠同步清理任务与养护事件',
      deletedPet.json?.success === true && tasksAfterPetDelete.json?.tasks?.length === 0 && eventsAfterPetDelete.json?.events?.length === 0,
      { deletedPet: deletedPet.json, tasksAfterPetDelete: tasksAfterPetDelete.json, eventsAfterPetDelete: eventsAfterPetDelete.json }
    );
    petAId = 0;
  } finally {
    if (tokenA && petAId) await request('POST', '/plant/pet-delete', { token: tokenA, body: { plantPetId: petAId } }).catch(() => {});
    if (tokenB && petBId) await request('POST', '/plant/pet-delete', { token: tokenB, body: { plantPetId: petBId } }).catch(() => {});
  }

  console.log(failures ? `M2 冒烟失败 ${failures} 项` : 'M2 冒烟全部通过');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('[m2-smoke] 运行异常:', err.message);
  process.exit(1);
});
