const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');
const authService = require('../../services/modules/AuthService');
const { resolveRuntimeConfig } = require('../../services/config/runtime');

const defaultAvatarUrl =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

Page({
  data: {
    statusBarHeight: 20,
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: ''
    },
    defaultAvatarUrl,
    canChooseAvatar: false,
    hasUserInfo: false,
    loadingLogin: false
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    const canChooseAvatar = typeof wx.canIUse === 'function'
      ? wx.canIUse('button.open-type.chooseAvatar')
      : false;
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 20,
      canChooseAvatar
    });
  },

  onChooseAvatar(e) {
    this.setData({
      'userInfo.avatarUrl': e.detail.avatarUrl
    });
    this.checkAndLogin();
  },

  async onPickAvatar() {
    try {
      const result = await new Promise((resolve, reject) => {
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject
        });
      });

      const filePath = result?.tempFilePaths?.[0] || '';
      if (!filePath) return;

      this.setData({
        'userInfo.avatarUrl': filePath
      });
      this.checkAndLogin();
    } catch (err) {
      wx.showToast({
        title: '请选择头像',
        icon: 'none'
      });
    }
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
    if (!this.data.hasUserInfo) return;
    this.setData({ loadingLogin: true });

    try {
      const config = resolveRuntimeConfig();
      const baseUrl = (config.authScfBaseUrl || config.scfApiBaseUrl || '').trim();
      if (!baseUrl) {
        throw new Error('authScfBaseUrl is not configured');
      }

      const tokenMeta = await authService.loginWithScf();
      const openid = tokenMeta?.openid || '';
      if (!openid) {
        throw new Error('无法获取 openid');
      }

      const userInfo = {
        avatarUrl: this.data.userInfo.avatarUrl,
        nickName: this.data.userInfo.nickName,
        openId: openid,
        openid,
        loginTime: Date.now()
      };

      wx.setStorageSync('userInfo', userInfo);
      app.globalData.userInfo = userInfo;
      app.globalData.hasLogin = true;

      try {
        await userProfileService.saveMyProfile({
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        });
      } catch (err) {
        // Keep login successful even if profile sync fails.
      }

      // 转场动画停留一下再跳转，视觉更流畅
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' });
      }, 800);
    } catch (error) {
      this.setData({ loadingLogin: false });
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none',
        duration: 1800
      });
    }
  }
});
