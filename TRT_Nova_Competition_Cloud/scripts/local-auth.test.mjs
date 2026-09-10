import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLocalAuthHandler } = require('./local-server/local-auth');
const { resolveAuthenticatedOpenid } = require('../dist/scf/api-scf/lib/security');

function parse(result) {
  return JSON.parse(result.body);
}

test('本地微信登录要求真实登录流程提供非空 code', async () => {
  const handler = createLocalAuthHandler({
    env: { LOCAL_DEV_AUTH_ENABLED: 'true', JWT_SECRET: 'test-secret' },
    getDb: async () => ({ execute: async () => { throw new Error('不应访问数据库'); } })
  });

  const result = await handler({ httpMethod: 'POST', path: '/auth/login', body: '{}' });
  assert.equal(result.statusCode, 400);
  assert.equal(parse(result).msg, '登录参数缺失');
});

test('本地微信登录签发稳定 JWT 且不信任客户端 openid', async () => {
  const writes = [];
  const env = {
    LOCAL_DEV_AUTH_ENABLED: 'true',
    LOCAL_DEV_OPENID: 'dev-wechat-owner',
    JWT_SECRET: 'test-secret',
    TOKEN_EXPIRES_IN_SECONDS: '600'
  };
  const handler = createLocalAuthHandler({
    env,
    getDb: async () => ({
      execute: async (sql, params) => writes.push({ sql, params })
    })
  });

  const result = await handler({
    httpMethod: 'POST',
    path: '/auth/login',
    body: JSON.stringify({ code: 'wx-login-code', openid: 'client-forged-owner' })
  });
  const body = parse(result);

  assert.equal(result.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.openid, 'dev-wechat-owner');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params[0], 'dev-wechat-owner');
  assert.equal(
    resolveAuthenticatedOpenid({
      headers: { authorization: `Bearer ${body.accessToken}` },
      jwtSecret: env.JWT_SECRET
    }),
    'dev-wechat-owner'
  );
});

test('关闭本地认证后不截获 auth-scf 登录路由', async () => {
  const handler = createLocalAuthHandler({ env: { LOCAL_DEV_AUTH_ENABLED: 'false' } });
  const result = await handler({
    httpMethod: 'POST',
    path: '/auth/login',
    body: JSON.stringify({ code: 'wx-login-code' })
  });

  assert.equal(result, null);
});
