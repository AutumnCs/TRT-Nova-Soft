const { envList = [] } = require('./envList');
const { resolveAppRuntimeConfig } = require('./services/config/runtime-profile');
const authService = require('./services/modules/AuthService');
const { resolveCachedLoginState } = require('./services/modules/auth-session-state');

const EXPLICIT_ENV = envList[0] || '';
const RUNTIME_CONFIG = resolveAppRuntimeConfig();

function isAuthErrorMessage(message) {
  const text = typeof message === 'string' ? message : '';
  return text.includes('登录') && text.includes('重新登录');
}

App({
  globalData: {
    env: EXPLICIT_ENV,
    userInfo: null,
    hasLogin: false,
    runtimeConfig: RUNTIME_CONFIG
  },

  onLaunch() {
    this.checkLoginStatus();

    if (!this.globalData.runtimeConfig.useCloudBase) {
      return;
    }

    if (typeof wx.weixinMiniProgramLogin === 'function') {
      return;
    }

    if (!wx.cloud) {
      console.error('请使用基础库 2.2.3 及以上版本以启用云能力');
      return;
    }

    try {
      wx.cloud.init({
        env: this.globalData.env || 'cloud1-6gfrptied648aa39',
        traceUser: true
      });
    } catch (err) {
      console.warn('[app] wx.cloud.init failed:', err);
    }
  },

  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    const tokenMeta = authService.getTokenMeta();
    const state = resolveCachedLoginState({
      userInfo,
      tokenMeta,
      allowPhoneLogin: this.globalData.runtimeConfig.enableDevPhoneLogin === true
    });

    if (state.clearLogin) {
      this.clearLoginState();
      return;
    }

    if (state.clearUserInfo) {
      wx.removeStorageSync('userInfo');
    }

    this.globalData.userInfo = state.userInfo;
    this.globalData.hasLogin = state.hasLogin;
  },

  clearLoginState() {
    wx.removeStorageSync('userInfo');
    authService.clearToken();
    this.globalData.userInfo = null;
    this.globalData.hasLogin = false;
  },

  handleAuthExpired() {
    this.clearLoginState();
    this.gotoLoginPage();
  },

  isAuthError(error) {
    if (!error) return false;
    if (typeof error === 'string') {
      return isAuthErrorMessage(error);
    }
    return isAuthErrorMessage(error.message || error.errMsg || '');
  },

  gotoLoginPage() {
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (currentPage && currentPage.route === 'pages/auth/auth') {
      return;
    }

    wx.reLaunch({
      url: '/pages/auth/auth'
    });
  }
});
