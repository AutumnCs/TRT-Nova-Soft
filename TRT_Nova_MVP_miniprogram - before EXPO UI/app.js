const { envList = [] } = require('./envList');
const { DEFAULT_RUNTIME_CONFIG } = require('./services/config/runtime');
const authService = require('./services/modules/AuthService');

const EXPLICIT_ENV = envList[0] || '';

function isAuthErrorMessage(message) {
  const text = typeof message === 'string' ? message : '';
  return text.includes('登录') && text.includes('重新登录');
}

App({
  globalData: {
    env: EXPLICIT_ENV,
    userInfo: null,
    hasLogin: false,
    runtimeConfig: {
      ...DEFAULT_RUNTIME_CONFIG,
      useCloudBase: false,
      scfApiBaseUrl: 'https://1395114552-hkiu70pwre.ap-shanghai.tencentscf.com',
      agentScfBaseUrl: 'https://1395114552-5acci5kbwy.ap-shanghai.tencentscf.com',
      authScfBaseUrl: 'https://1395114552-0etc4ugmnu.ap-shanghai.tencentscf.com'
    }
  },

  onLaunch() {
    this.checkLoginStatus();

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
