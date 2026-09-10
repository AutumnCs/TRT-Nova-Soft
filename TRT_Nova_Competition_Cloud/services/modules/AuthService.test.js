const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  }
};

const authService = require('./AuthService');

test.after(() => {
  delete global.wx;
});

test('saveToken 在 openid 改变时清除旧 userInfo', () => {
  storage.clear();
  storage.set('userInfo', { openid: 'account-a', nickName: '账号 A' });

  const meta = authService.saveToken({
    accessToken: 'token-b',
    openid: 'account-b'
  });

  assert.equal(meta.openid, 'account-b');
  assert.equal(storage.has('userInfo'), false);
  assert.equal(storage.get('apiAccessToken'), 'token-b');
});

test('saveToken 在同一 openid 刷新 token 时保留资料缓存', () => {
  storage.clear();
  const userInfo = { openid: 'account-b', nickName: '账号 B' };
  storage.set('userInfo', userInfo);

  authService.saveToken({
    accessToken: 'token-b-new',
    openid: 'account-b'
  });

  assert.equal(storage.get('userInfo'), userInfo);
});

test('saveToken 拒绝没有 openid 的登录凭证', () => {
  storage.clear();
  assert.throws(
    () => authService.saveToken({ accessToken: 'token-without-openid' }),
    /登录身份缺失/
  );
});
