const {
  envList = [],
  runtimeProfile = 'prod',
  runtimeConfigOverrides = {}
} = require('./envList');
const {
  buildAppRuntimeConfig,
  validateRuntimeConfig
} = require('./services/config/runtime');
const authService = require('./services/modules/AuthService');

const EXPLICIT_ENV = envList[0] || '';
const APP_RUNTIME_CONFIG = buildAppRuntimeConfig({
  profileName: runtimeProfile,
  overrides: runtimeConfigOverrides
});
const APP_RUNTIME_WARNINGS = validateRuntimeConfig(APP_RUNTIME_CONFIG);

function isAuthErrorMessage(message) {
  const text = typeof message === 'string' ? message : '';
  const lowered = text.toLowerCase();
  return (
    lowered.includes('login') ||
    lowered.includes('auth expired') ||
    lowered.includes('token expired') ||
    lowered.includes('re-login')
  );
}

App({
  globalData: {
    env: EXPLICIT_ENV,
    userInfo: null,
    hasLogin: false,
    runtimeProfile,
    runtimeConfig: APP_RUNTIME_CONFIG
  },

  onLaunch() {
    this.checkLoginStatus();

    if (APP_RUNTIME_WARNINGS.length) {
      console.warn('[app] runtime config warnings:', APP_RUNTIME_WARNINGS.join('; '));
    }

    if (typeof wx.weixinMiniProgramLogin === 'function') {
      return;
    }

    if (!this.globalData.runtimeConfig.useCloudBase) {
      return;
    }

    if (!wx.cloud) {
      console.error('[app] wx.cloud is unavailable in current runtime');
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
    const isPhoneLogin = userInfo && userInfo.loginType === 'phone';
    const openId = userInfo && (userInfo.openId || userInfo.openid);
    const tokenOpenid = (tokenMeta && tokenMeta.openid) || '';
    const expiresAt = Number(tokenMeta && tokenMeta.expiresAt);

    if (isPhoneLogin && openId) {
      this.globalData.userInfo = userInfo;
      this.globalData.hasLogin = true;
      return;
    }

    if (expiresAt && expiresAt <= Date.now()) {
      this.clearLoginState();
      return;
    }

    if ((openId || tokenOpenid) && tokenMeta && tokenMeta.accessToken) {
      this.globalData.userInfo = userInfo;
      this.globalData.hasLogin = true;
      return;
    }

    if (openId && !tokenMeta?.accessToken) {
      this.clearLoginState();
      return;
    }

    this.globalData.userInfo = null;
    this.globalData.hasLogin = false;
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

    wx.redirectTo({
      url: '/pages/auth/auth'
    });
  }
});
