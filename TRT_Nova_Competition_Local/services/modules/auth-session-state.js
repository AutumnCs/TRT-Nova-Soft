function normalizeOpenid(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getUserOpenid(userInfo = {}) {
  return normalizeOpenid(userInfo?.openid || userInfo?.openId || '');
}

function getTokenOpenid(tokenMeta = {}) {
  return normalizeOpenid(tokenMeta?.openid || '');
}

function getCachedUserForOpenid(userInfo, openid) {
  const expectedOpenid = normalizeOpenid(openid);
  if (!userInfo || !expectedOpenid) return null;
  return getUserOpenid(userInfo) === expectedOpenid ? userInfo : null;
}

function resolveCachedLoginState(options = {}) {
  const userInfo = options.userInfo || null;
  const tokenMeta = options.tokenMeta || {};
  const now = Number(options.now) || Date.now();
  const allowPhoneLogin = options.allowPhoneLogin === true;
  const userOpenid = getUserOpenid(userInfo);
  const tokenOpenid = getTokenOpenid(tokenMeta);
  const accessToken = typeof tokenMeta.accessToken === 'string' ? tokenMeta.accessToken.trim() : '';
  const expiresAt = Number(tokenMeta.expiresAt) || 0;

  if (allowPhoneLogin && userInfo?.loginType === 'phone' && userOpenid) {
    return {
      hasLogin: true,
      openid: userOpenid,
      userInfo,
      clearLogin: false,
      clearUserInfo: false
    };
  }

  if (expiresAt && expiresAt <= now) {
    return {
      hasLogin: false,
      openid: '',
      userInfo: null,
      clearLogin: true,
      clearUserInfo: Boolean(userInfo)
    };
  }

  if (!accessToken || !tokenOpenid) {
    return {
      hasLogin: false,
      openid: '',
      userInfo: null,
      clearLogin: Boolean(accessToken || tokenOpenid || userInfo),
      clearUserInfo: Boolean(userInfo)
    };
  }

  const cachedUser = getCachedUserForOpenid(userInfo, tokenOpenid);
  return {
    hasLogin: true,
    openid: tokenOpenid,
    userInfo: cachedUser,
    clearLogin: false,
    clearUserInfo: Boolean(userInfo) && !cachedUser
  };
}

function isProfileForActiveOpenid(profile, expectedOpenid, tokenMeta) {
  const expected = normalizeOpenid(expectedOpenid);
  return Boolean(
    expected &&
    getTokenOpenid(tokenMeta) === expected &&
    getUserOpenid(profile) === expected
  );
}

module.exports = {
  normalizeOpenid,
  getUserOpenid,
  getTokenOpenid,
  getCachedUserForOpenid,
  resolveCachedLoginState,
  isProfileForActiveOpenid
};
