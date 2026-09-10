const test = require('node:test');
const assert = require('node:assert/strict');

test('个人资料 warm refresh 失败时不回退到较旧的本地昵称', async () => {
  const previous = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  const userProfileService = require('../../services/modules/UserProfileService');
  const originalGetProfile = userProfileService.getMyProfile;
  let pageDefinition;
  global.getApp = () => ({
    globalData: { hasLogin: true, userInfo: { openid: 'owner-a', nickName: '旧本地昵称' } },
    checkLoginStatus() {}
  });
  global.wx = {
    getStorageSync(key) {
      if (key === 'apiAccessTokenMeta') return { openid: 'owner-a' };
      if (key === 'userInfo') return { openid: 'owner-a', nickName: '旧本地昵称' };
      return null;
    },
    getWindowInfo() { return { statusBarHeight: 20 }; }
  };
  global.Page = (definition) => { pageDefinition = definition; };
  userProfileService.getMyProfile = async () => { throw new Error('profile offline'); };

  const modulePath = require.resolve('./profile.js');
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const page = {
      ...pageDefinition,
      data: {
        ...pageDefinition.data,
        user: { name: '服务端新昵称', level: 'LV.1 新手指南', avatar: 'fresh.png' },
        profileLoaded: true
      },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page._profileLoadedOpenid = 'owner-a';

    await page.loadUserProfile();

    assert.equal(page.data.user.name, '服务端新昵称');
    assert.equal(page.data.user.avatar, 'fresh.png');
    assert.equal(page.data.profileRefreshing, false);
    assert.equal(page.data.profileLoaded, true);
  } finally {
    userProfileService.getMyProfile = originalGetProfile;
    delete require.cache[modulePath];
    global.getApp = previous.getApp;
    global.wx = previous.wx;
    global.Page = previous.Page;
  }
});
