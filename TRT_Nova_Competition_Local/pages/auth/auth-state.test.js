const test = require('node:test');
const assert = require('node:assert/strict');

const { isDevPhoneLoginEnabled } = require('./auth-state');

test('development phone login is disabled unless explicitly enabled', () => {
  assert.equal(isDevPhoneLoginEnabled(), false);
  assert.equal(isDevPhoneLoginEnabled({}), false);
  assert.equal(isDevPhoneLoginEnabled({ enableDevPhoneLogin: false }), false);
  assert.equal(isDevPhoneLoginEnabled({ enableDevPhoneLogin: 'true' }), false);
  assert.equal(isDevPhoneLoginEnabled({ enableDevPhoneLogin: true }), true);
});
