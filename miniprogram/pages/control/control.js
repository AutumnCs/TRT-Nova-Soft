const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    activeScene: 'auto',
    animatingCard: null,
    devices: [
      { id: 'light', name: '补光灯', icon: '💡', isOn: true, desc: '自动模式' },
      { id: 'pump', name: '水泵', icon: '💧', isOn: false, desc: '上次运行: 2小时前' },
      { id: 'mist', name: '加湿器', icon: '🌫️', isOn: true, desc: '持续保湿中' },
      { id: 'fan', name: '通风扇', icon: '🌪️', isOn: false, desc: '已关闭' }
    ],
    settings: {
      minMoisture: 20,
      targetTemp: 25,
      lightDuration: 8
    }
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
    
    // 检查登录状态
    this.checkLoginStatus();
  },

  onShow: function() {
    // 设置导航栏
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    
    // 每次显示页面都检查登录状态
    this.checkLoginStatus();
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

  switchScene: function(e) {
    const scene = e.currentTarget.dataset.scene;
    this.setData({ activeScene: scene });
    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: '已切换模式',
      icon: 'success'
    });
  },

  toggleDevice: function(e) {
    const index = e.currentTarget.dataset.index;
    const key = `devices[${index}].isOn`;
    this.setData({
      [key]: !this.data.devices[index].isOn
    });
    wx.vibrateShort(); // 触感反馈
  },

  sliderChange: function(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`settings.${key}`]: e.detail.value
    });
  },

  sliderChanging: function(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`settings.${key}`]: e.detail.value
    });
  }
})
