const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDeviceRows,
  buildTelemetryState,
  normalizeBooleanMetric,
  formatSoulStateByIr
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
