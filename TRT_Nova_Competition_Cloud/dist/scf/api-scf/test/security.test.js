const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  resolveAuthenticatedOpenid
} = require('../lib/security');

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

test('resolveAuthenticatedOpenid prefers JWT over legacy openid fields', () => {
  const token = createJwt({ openid: 'openid-from-jwt', exp: Math.floor(Date.now() / 1000) + 60 }, 'secret');
  const result = resolveAuthenticatedOpenid({
    headers: {
      'x-access-token': token
    },
    body: {
      openid: 'body-openid'
    },
    jwtSecret: 'secret'
  });

  assert.equal(result, 'openid-from-jwt');
});

test('resolveAuthenticatedOpenid rejects legacy openid fallback when disabled', () => {
  assert.throws(
    () => resolveAuthenticatedOpenid({
      headers: {},
      body: {
        openid: 'body-openid'
      },
      jwtSecret: 'secret',
      allowLegacyOpenidFallback: false
    }),
    /Missing bearer token/
  );
});
