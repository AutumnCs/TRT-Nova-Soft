const test = require('node:test');
const assert = require('node:assert/strict');

test('SCF entry exposes main_handler through CommonJS', () => {
  const entry = require('../index.js');
  assert.equal(typeof entry.main_handler, 'function');
});
