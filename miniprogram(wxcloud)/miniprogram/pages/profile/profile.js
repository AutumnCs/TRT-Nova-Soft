Page({
  data: {
    statusBarHeight: 20,
    user: {
      name: "园艺大师",
      level: "LV.5 种植专家",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop"
    },
    menu: [
      { icon: "🌿", title: "我的花园", desc: "管理植物" },
      { icon: "📦", title: "设备管理", desc: "2个在线" },
      { icon: "🔔", title: "通知设置", desc: "已开启" },
      { icon: "⚙️", title: "系统设置", desc: "" }
    ]
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
  },
  
  onMenuItemTap: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.menu[index];
    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: item.title + ' 开发中',
      icon: 'none'
    });
  }
})
