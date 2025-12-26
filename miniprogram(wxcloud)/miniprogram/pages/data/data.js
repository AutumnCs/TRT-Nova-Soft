Page({
  data: {
    statusBarHeight: 20,
    currentTab: 'week',
    chartData: [45, 52, 48, 60, 55, 42, 50], // Initial values
    stats: {
      avgTemp: 24.5,
      avgMoisture: 52,
      totalWater: 1.2
    },
    logs: [
      { id: 1, time: '10:30', title: '自动浇水', desc: '土壤湿度低于 20%', type: 'water' },
      { id: 2, time: '08:00', title: '开启补光', desc: '定时任务', type: 'light' },
      { id: 3, time: '昨天', title: '添加营养液', desc: '手动操作', type: 'fert' },
      { id: 4, time: '昨天', title: '温度过高预警', desc: '环境温度 > 30°C', type: 'warn' }
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
      this.getTabBar().setData({ selected: 2 })
    }
  },

  switchTab: function(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab });
  }
})
