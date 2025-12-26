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
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
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
