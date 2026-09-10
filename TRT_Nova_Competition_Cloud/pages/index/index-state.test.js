const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDeviceRows,
  buildTelemetryState,
  normalizeBooleanMetric,
  formatSoulStateByIr,
  normalizeTodoTitle,
  derivePlantStatus
} = require('./index-state');

test('normalizeBooleanMetric accepts device-like truthy and falsy values', () => {
  assert.equal(normalizeBooleanMetric(true), true);
  assert.equal(normalizeBooleanMetric('1'), true);
  assert.equal(normalizeBooleanMetric('alive'), false);
  assert.equal(normalizeBooleanMetric('dead'), true);
  assert.equal(normalizeBooleanMetric('unknown'), null);
});

test('formatSoulStateByIr maps IR state to soul status text', () => {
  assert.equal(formatSoulStateByIr(true), '外');
  assert.equal(formatSoulStateByIr(false), '内');
  assert.equal(formatSoulStateByIr(null), '--');
});

test('buildDeviceRows marks the previous logical key active', () => {
  const result = buildDeviceRows(
    [
      { logicalKey: 'a', alias: 'A', deviceName: 'DevA' },
      { logicalKey: 'b', alias: 'B', deviceName: 'DevB' }
    ],
    'b'
  );

  assert.equal(result.selectedLogicalKey, 'b');
  assert.equal(result.devices[0].active, false);
  assert.equal(result.devices[1].active, true);
  assert.equal(result.devices[0].summary, '未设置植物类型和位置');
});

test('buildTelemetryState keeps defaults when no rows are available', () => {
  const result = buildTelemetryState([], '', { formatTs: () => '--' });
  assert.equal(result.shouldReset, true);
});

test('normalizeTodoTitle trims input and rejects blank titles', () => {
  assert.equal(normalizeTodoTitle('  给绿萝浇水  '), '给绿萝浇水');
  assert.equal(normalizeTodoTitle('   '), '');
  assert.equal(normalizeTodoTitle(null), '');
});

test('derivePlantStatus covers empty, healthy, stale, offline and dry soil states', () => {
  assert.equal(derivePlantStatus({}).key, 'empty');

  const healthy = derivePlantStatus({
    device: { hasLatest: true, updatedAt: 9 * 60 * 1000 },
    soilValue: '48',
    nowTs: 10 * 60 * 1000,
    isOffline: false
  });
  assert.equal(healthy.key, 'normal');
  assert.equal(healthy.growthText, '成长记录待解锁');

  const stale = derivePlantStatus({
    device: { hasLatest: true, updatedAt: 7 * 60 * 1000 },
    soilValue: '48',
    nowTs: 10 * 60 * 1000,
    isOffline: false
  });
  assert.equal(stale.key, 'stale');

  const offline = derivePlantStatus({
    device: { hasLatest: false, updatedAt: 9 * 60 * 1000 },
    soilValue: '48',
    nowTs: 10 * 60 * 1000,
    isOffline: true
  });
  assert.equal(offline.key, 'offline');

  const dry = derivePlantStatus({
    device: { hasLatest: true, updatedAt: 9 * 60 * 1000 },
    soilValue: '12',
    nowTs: 10 * 60 * 1000,
    isOffline: false
  });
  assert.equal(dry.key, 'attention');
  assert.equal(dry.careSuggestion, '浇水');
});

test('buildTelemetryState exposes reported fan confirmation state', () => {
  const result = buildTelemetryState([
    {
      logicalKey: 'pot-1',
      hasLatest: true,
      updatedAt: 10 * 60 * 1000,
      plantType: '绿萝',
      params: {
        soil_percent: { value: 46 },
        fan_switch: { value: true, time: 10 * 60 * 1000 }
      }
    }
  ], 'pot-1', {
    nowTs: 10 * 60 * 1000,
    isDeviceOffline: () => false,
    formatTs: (ts) => String(ts),
    computeBubbles: () => [],
    computeMoodEmoji: () => '🙂'
  });
  assert.equal(result.fan.hasReportedState, true);
  assert.equal(result.fan.isOn, true);
  assert.equal(result.fan.statusText, '风扇已开启');
});
