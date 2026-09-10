const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getCachedUserForOpenid,
  resolveCachedLoginState,
  isProfileForActiveOpenid
} = require('./auth-session-state');

test('账号切换时保留新 token 并丢弃旧账号资料缓存', () => {
  const state = resolveCachedLoginState({
    userInfo: { openid: 'account-a', nickName: '账号 A' },
    tokenMeta: { accessToken: 'token-b', openid: 'account-b', expiresAt: Date.now() + 60_000 }
  });

  assert.equal(state.hasLogin, true);
  assert.equal(state.openid, 'account-b');
  assert.equal(state.userInfo, null);
  assert.equal(state.clearLogin, false);
  assert.equal(state.clearUserInfo, true);
});

test('相同 openid 的缓存可以作为当前账号资料回退', () => {
  const userInfo = { openId: 'account-b', nickName: '账号 B' };
  const state = resolveCachedLoginState({
    userInfo,
    tokenMeta: { accessToken: 'token-b', openid: 'account-b' }
  });

  assert.equal(state.hasLogin, true);
  assert.equal(state.userInfo, userInfo);
  assert.equal(state.clearUserInfo, false);
  assert.equal(getCachedUserForOpenid(userInfo, 'account-b'), userInfo);
  assert.equal(getCachedUserForOpenid(userInfo, 'account-a'), null);
});

test('过期 token 清除整个登录态', () => {
  const state = resolveCachedLoginState({
    userInfo: { openid: 'account-a' },
    tokenMeta: { accessToken: 'token-a', openid: 'account-a', expiresAt: 1 },
    now: 2
  });

  assert.equal(state.hasLogin, false);
  assert.equal(state.clearLogin, true);
  assert.equal(state.userInfo, null);
});

test('资料响应必须同时匹配请求身份和当前 token 身份', () => {
  const tokenMeta = { accessToken: 'token-b', openid: 'account-b' };

  assert.equal(
    isProfileForActiveOpenid({ openid: 'account-b' }, 'account-b', tokenMeta),
    true
  );
  assert.equal(
    isProfileForActiveOpenid({ openid: 'account-a' }, 'account-b', tokenMeta),
    false
  );
  assert.equal(
    isProfileForActiveOpenid({ openid: 'account-b' }, 'account-a', tokenMeta),
    false
  );
});
