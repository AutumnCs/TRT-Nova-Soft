const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');

const defaultAvatarUrl =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

Page({
  data: {
    statusBarHeight: 20,
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: ''
    },
    hasUserInfo: false
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
  },

  onChooseAvatar(e) {
    this.setData({
      'userInfo.avatarUrl': e.detail.avatarUrl
    });
    this.checkAndLogin();
  },

  onInputChange(e) {
    this.setData({
      'userInfo.nickName': (e.detail.value || '').trim()
    });
    this.checkAndLogin();
  },

  checkAndLogin() {
    const { avatarUrl, nickName } = this.data.userInfo;
    const ok = Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl);
    this.setData({ hasUserInfo: ok });
    if (ok) this.loginSuccess();
  },

  async loginSuccess() {
    wx.showLoading({
      title: '登录中',
      mask: true
    });

    try {
      const loginRes = await wx.cloud.callFunction({
        name: 'login',
        data: {}
      });

      let openid = '';
      if (loginRes?.result?.openid) {
        openid = loginRes.result.openid;
      } else if (loginRes?.result?.userInfo?.openId || loginRes?.result?.userInfo?.openid) {
        openid = loginRes.result.userInfo.openId || loginRes.result.userInfo.openid;
      } else if (loginRes?.result?.result?.openid) {
        openid = loginRes.result.result.openid;
      } else if (loginRes?.result?.result?.userInfo?.openId || loginRes?.result?.result?.userInfo?.openid) {
        openid = loginRes.result.result.userInfo.openId || loginRes.result.result.userInfo.openid;
      }

      if (!openid) {
        throw new Error('无法获取 openid');
      }

      const userInfo = {
        avatarUrl: this.data.userInfo.avatarUrl,
        nickName: this.data.userInfo.nickName,
        openId: openid,
        loginTime: Date.now()
      };

      wx.setStorageSync('userInfo', userInfo);
      app.globalData.userInfo = userInfo;
      app.globalData.hasLogin = true;

      // Sync login avatar/nickname to canonical users collection.
      try {
        await userProfileService.saveMyProfile({
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        });
      } catch (err) {
        // Keep login successful even if profile sync fails.
      }

      wx.hideLoading();
      wx.showToast({
        title: '登录成功',
        icon: 'success',
        duration: 800
      });

      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }, 850);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none',
        duration: 1800
      });
    }
  }
});
