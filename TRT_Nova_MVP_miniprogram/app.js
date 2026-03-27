const { envList = [] } = require('./envList');
const { DEFAULT_RUNTIME_CONFIG } = require('./services/config/runtime');
const authService = require('./services/modules/AuthService');

const EXPLICIT_ENV = envList[0] || '';

App({
  globalData: {
    env: EXPLICIT_ENV,
    userInfo: null,
    hasLogin: false,
    runtimeConfig: {
      ...DEFAULT_RUNTIME_CONFIG,
      scfApiBaseUrl: 'https://1395114552-hkiu70pwre.ap-shanghai.tencentscf.com',
      authScfBaseUrl: 'https://1395114552-0etc4ugmnu.ap-shanghai.tencentscf.com'
    }
  },

  onLaunch() {
    this.checkLoginStatus();

    if (!wx.cloud) {
      console.error('请使用基础库 2.2.3 及以上版本以启用云能力');
      return;
    }

    const initOptions = { traceUser: true };
    if (this.globalData.env) {
      initOptions.env = this.globalData.env;
    }
    wx.cloud.init(initOptions);
  },

  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    const openId = userInfo && (userInfo.openId || userInfo.openid);
    const tokenMeta = authService.getTokenMeta();
    const tokenOpenid = tokenMeta?.openid || '';

    if (openId || tokenOpenid) {
      this.globalData.userInfo = userInfo;
      this.globalData.hasLogin = true;
      return;
    }

    this.globalData.userInfo = null;
    this.globalData.hasLogin = false;
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
