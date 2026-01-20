// app.js
App({
  globalData: {
    // env 参数说明：
    //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
    //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
    //   如不填则使用默认环境（第一个创建的环境）
    env: "cloud1-6gfrptied648aa39",
    // 用户信息和登录状态管理
    userInfo: null,
    hasLogin: false
  },

  onLaunch: function () {
    // 初始化时检查登录状态
    this.checkLoginStatus();
    
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },

  // 检查登录状态
  checkLoginStatus: function() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.hasLogin = true;
      console.log('登录状态：已登录', userInfo);
    } else {
      this.globalData.userInfo = null;
      this.globalData.hasLogin = false;
      console.log('登录状态：未登录');
    }
  },
  
  // 跳转到登录页面 33333
  gotoLoginPage: function() {
    // 避免重复跳转
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (currentPage.route === 'pages/auth/auth') {
      return; // 当前已经在登录页面，不跳转
    }
    
    wx.redirectTo({
      url: '/pages/auth/auth'
    });
  }
});
