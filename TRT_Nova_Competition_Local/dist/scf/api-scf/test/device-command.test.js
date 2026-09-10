const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveDeviceCommandRequest
} = require('../lib/device-command');

test('resolveDeviceCommandRequest maps fan.on to a controlled payload', () => {
  const result = resolveDeviceCommandRequest({
    logicalKey: 'device-1',
    action: 'fan.on'
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'fan.on');
  assert.deepEqual(result.params, { test: true });
});

test('resolveDeviceCommandRequest rejects unsupported actions', () => {
  const result = resolveDeviceCommandRequest({
    logicalKey: 'device-1',
    action: 'invalid.action'
  });

  assert.equal(result.ok, false);
  assert.match(result.msg, /Unsupported device action/);
});
