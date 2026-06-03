Component({
  data: {
    selected: 0,
    color: '#9CA3AF',
    selectedColor: '#10B981',
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: '🏠'
      },
      {
        pagePath: '/pages/assistant/assistant',
        text: '助手',
        icon: '🌿'
      },
      {
        pagePath: '/pages/wiki/wiki',
        text: '植物库',
        icon: '📚'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: '👤'
      }
    ]
  },
  methods: {
    switchTab(e) {
      const url = e.currentTarget.dataset.path;
      wx.switchTab({ url });
    }
  }
});
