Component({
  data: {
    selected: 0,
    color: '#6b7280',
    selectedColor: '#39ff88',
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: '⌂'
      },
      {
        pagePath: '/pages/assistant/assistant',
        text: '助手',
        icon: '⌘'
      },
      {
        pagePath: '/pages/wiki/wiki',
        text: '植物库',
        icon: '◫'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: '◌'
      }
    ]
  },

  attached() {
    this.syncSelected();
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current ? `/${current.route}` : '';
      const selected = this.data.list.findIndex((item) => item.pagePath === route);
      this.setData({
        selected: selected >= 0 ? selected : 0
      });
    },

    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      if (!path) return;
      wx.switchTab({ url: path });
    }
  }
});
