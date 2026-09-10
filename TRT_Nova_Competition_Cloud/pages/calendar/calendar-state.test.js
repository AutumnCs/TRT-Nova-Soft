const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startOfWeek,
  getViewRange,
  buildCalendarDays,
  tasksForDate,
  shiftAnchor
} = require('./calendar-state');

test('周视图从周一开始并覆盖七天', () => {
  assert.equal(startOfWeek('2026-08-26'), '2026-08-24');
  assert.deepEqual(getViewRange('2026-08-26', 'week'), {
    startDate: '2026-08-24',
    endDate: '2026-08-30'
  });
});

test('月视图固定生成 42 个日期格并保留跨月任务', () => {
  const tasks = [{ id: 1, scheduledFor: '2026-08-31', status: 'pending', taskType: 'watering' }];
  const days = buildCalendarDays('2026-08-12', 'month', tasks, '2026-08-12', '2026-08-12');
  assert.equal(days.length, 42);
  assert.equal(days[0].date, '2026-07-27');
  assert.equal(days.find((day) => day.date === '2026-08-31').pendingCount, 1);
});

test('日轴待完成排在已完成之前并标出逾期', () => {
  const tasks = tasksForDate([
    { id: 2, scheduledFor: '2026-08-25', status: 'completed', taskType: 'inspection' },
    { id: 1, scheduledFor: '2026-08-25', status: 'pending', taskType: 'watering', reminderTime: '09:00' }
  ], '2026-08-25', '2026-08-26');
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[0].overdue, true);
  assert.equal(tasks[1].statusLabel, '已完成');
});

test('周/月导航按各自周期移动并正确钳制月末', () => {
  assert.equal(shiftAnchor('2026-08-26', 'week', 1), '2026-09-02');
  assert.equal(shiftAnchor('2026-01-31', 'month', 1), '2026-02-28');
});
