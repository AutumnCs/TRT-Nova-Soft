const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { resolveOpenid } = require('../lib/auth');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const content = `${header}.${body}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${content}.${signature}`;
}

test('resolveOpenid accepts a valid JWT without legacy fallback', () => {
  const token = createJwt(
    { openid: 'jwt-user', exp: Math.floor(Date.now() / 1000) + 60 },
    'test-secret'
  );

  const result = resolveOpenid(
    { headers: { 'x-access-token': token } },
    { openid: 'untrusted-body-user' },
    { jwtSecret: 'test-secret', allowLegacyOpenidFallback: false }
  );

  assert.equal(result, 'jwt-user');
});

test('resolveOpenid rejects client supplied openid by default', () => {
  assert.throws(
    () => resolveOpenid(
      { headers: {} },
      { openid: 'untrusted-body-user' },
      { jwtSecret: 'test-secret', allowLegacyOpenidFallback: false }
    ),
    /Missing bearer token/
  );
});

test('resolveOpenid permits legacy openid only when explicitly enabled', () => {
  const result = resolveOpenid(
    { headers: { 'x-openid': 'legacy-user' } },
    {},
    { jwtSecret: 'test-secret', allowLegacyOpenidFallback: true }
  );

  assert.equal(result, 'legacy-user');
});

test('resolveOpenid does not enable legacy fallback for truthy strings', () => {
  assert.throws(
    () => resolveOpenid(
      { headers: { 'x-openid': 'legacy-user' } },
      {},
      { jwtSecret: 'test-secret', allowLegacyOpenidFallback: '1' }
    ),
    /Missing bearer token/
  );
});
