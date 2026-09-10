const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSolarTermState,
  solarTermDate,
  toShanghaiDate
} = require('./SolarTermService');

test('2026 年关键节气日期按中国标准时间确定', () => {
  assert.equal(solarTermDate(2026, 2), '2026-02-04');
  assert.equal(solarTermDate(2026, 15), '2026-08-23');
  assert.equal(solarTermDate(2026, 16), '2026-09-07');
});
test('处暑期间返回确定性名称、下一节气和通用提示边界', () => {
  const state = getSolarTermState('2026-08-27');
  assert.equal(state.name, '处暑');
  assert.equal(state.nextName, '白露');
  assert.equal(state.daysUntilNext, 11);
  assert.match(state.tip, /通风/);
  assert.match(state.disclaimer, /不代表本地实时物候/);
});

test('同一时刻按 Asia/Shanghai 日期解释，不依赖服务器时区', () => {
  assert.equal(toShanghaiDate(new Date('2026-08-22T16:30:00.000Z')), '2026-08-23');
  assert.equal(getSolarTermState(new Date('2026-08-22T16:30:00.000Z')).name, '处暑');
});
