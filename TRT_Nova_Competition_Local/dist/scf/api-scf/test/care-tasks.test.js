const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateTaskInput,
  normalizeTimeInput,
  shanghaiDateFromMs,
  getNextScheduledDate,
  mapCareTaskRow,
  calculateCareStreak,
  createCareTaskForUser
} = require('../lib/care-tasks');

test('任务输入覆盖植宠、排程、提醒、重复与来源', () => {
  const result = validateTaskInput({
    plantPetId: 8,
    taskType: 'watering',
    title: '检查盆土后浇水',
    description: '先摸表土，再决定是否浇水',
    scheduledFor: '2026-08-27',
    recurrenceType: 'weekly',
    recurrenceInterval: 2,
    source: 'manual'
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.reminderTime, '09:00');
  assert.equal(result.value.recurrenceInterval, 2);
});

test('底层字段校验不把客户端 confirmed 当作公开创建权限', async () => {
  const base = {
    plantPetId: 1,
    taskType: 'inspection',
    title: '观察叶片',
    scheduledFor: '2026-08-27',
    source: 'ai'
  };
  assert.equal(validateTaskInput(base).ok, false);
  assert.equal(validateTaskInput({ ...base, confirmed: true }).ok, true);
  const db = { execute: async () => { throw new Error('公开入口不应访问数据库'); } };
  const directCreate = await createCareTaskForUser(db, 'owner-a', { ...base, confirmed: true });
  assert.equal(directCreate.success, false);
  assert.match(directCreate.msg, /待确认候选/);
});

test('提醒时间和日期拒绝无效值', () => {
  assert.equal(normalizeTimeInput('24:00').ok, false);
  assert.equal(normalizeTimeInput('09:30').value, '09:30');
  assert.equal(validateTaskInput({
    plantPetId: 1,
    taskType: 'watering',
    title: '浇水',
    scheduledFor: '2026-02-30'
  }).ok, false);
});

test('Asia/Shanghai 日期不依赖服务器本地时区', () => {
  assert.equal(shanghaiDateFromMs(Date.parse('2026-08-26T15:59:59Z')), '2026-08-26');
  assert.equal(shanghaiDateFromMs(Date.parse('2026-08-26T16:00:00Z')), '2026-08-27');
});

test('重复任务从实际完成日推算并正确处理月末', () => {
  assert.equal(getNextScheduledDate('2026-08-26', 'daily', 2), '2026-08-28');
  assert.equal(getNextScheduledDate('2026-08-26', 'weekly', 2), '2026-09-09');
  assert.equal(getNextScheduledDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(getNextScheduledDate('2028-01-31', 'monthly', 1), '2028-02-29');
});

test('连续打卡忽略无任务日，今天未完成不提前中断，过期未完成会中断', () => {
  const today = '2026-08-26';
  assert.equal(calculateCareStreak([
    { date: '2026-08-26', pending: 1, total: 1 },
    { date: '2026-08-24', pending: 0, total: 2 },
    { date: '2026-08-21', pending: 0, total: 1 }
  ], today), 2);
  assert.equal(calculateCareStreak([
    { date: '2026-08-26', pending: 0, total: 1 },
    { date: '2026-08-24', pending: 1, total: 1 },
    { date: '2026-08-21', pending: 0, total: 1 }
  ], today), 1);
});

test('任务行映射保留完成状态和 PlantPet 归属', () => {
  const task = mapCareTaskRow({
    id: 12,
    openid: 'owner-a',
    plant_pet_id: 3,
    plant_pet_name: '小月亮',
    task_type: 'watering',
    title: '浇水',
    scheduled_for: '2026-08-26',
    reminder_time: '09:00',
    status: 'completed',
    completed_at: '2026-08-26 10:00:00'
  });
  assert.equal(task.ownerOpenid, 'owner-a');
  assert.equal(task.plantPetId, 3);
  assert.equal(task.plantPetName, '小月亮');
  assert.equal(task.status, 'completed');
});
