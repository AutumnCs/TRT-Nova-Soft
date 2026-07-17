const app = getApp()

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    appInfo: {
      name: "智能花盆",
      version: "1.0.0",
      description: "一款智能管理植物生长的小程序，帮助您轻松养护绿植。",
      features: [
        "智能监测植物生长环境",
        "自动控制通风扇等设备",
        "记录植物生长数据",
        "提供专业养护建议"
      ],
      developer: "TRT-Nova-Soft Team",
      contact: "support@trt-nova.com"
    }
  },

  onLoad: function (options) {
    this.setData({
      statusBarHeight: getStatusBarHeight()
    });
    
    // 检查登录状态
    this.checkLoginStatus();
  },

  onShow: function() {
    // 设置导航栏
    wx.setNavigationBarTitle({ title: '关于我们' });
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 先检查本地存储，确保状态最新
    app.checkLoginStatus();
    
    const { hasLogin } = app.globalData;
    if (!hasLogin) {
      // 如果未登录，跳转到登录页面
      // 使用setTimeout延迟跳转，避免渲染冲突
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/auth/auth'
        });
      }, 100);
      return false;
    }
    return true;
  },

  // 查看隐私协议
  viewPrivacyPolicy: function() {
    wx.vibrateShort({ type: 'light' });
    wx.showModal({
      title: '隐私协议',
      content: '我们重视您的隐私保护，所有数据仅用于提供更好的服务。我们不会收集或分享您的个人信息。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  // 查看用户协议
  viewUserAgreement: function() {
    wx.vibrateShort({ type: 'light' });
    wx.showModal({
      title: '用户协议',
      content: '使用本小程序即表示您同意遵守我们的用户协议。我们致力于为您提供优质的植物养护服务。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  // 分享小程序
  shareApp: function() {
    wx.vibrateShort({ type: 'light' });
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    });
  },

  // 返回上一页
  goBack: function() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateBack();
  }
})
