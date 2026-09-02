Component({
  data: {
    selected: 0,
    // 模块加载时读全局主题：切 tab 首渲即正确主题，避免 tab 栏先浅后深闪一帧
    theme: (typeof getApp === 'function' && getApp() && getApp().globalData && getApp().globalData.theme) || 'light',
    color: '#6b7280',
    selectedColor: '#191923',
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '⌂' },
      { pagePath: '/pages/toysClub/toysClub', text: '潮玩', icon: '❖' },
      { pagePath: '/pages/assistant/assistant', text: '助手', icon: '✦' },
      { pagePath: '/pages/wiki/wiki', text: '知识库', icon: '◇' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: '○' }
    ]
  },
  attached() {
    // 修复：Component 的 data 初始值在模块加载时求值一次、逐实例复制，
    // 切主题后新 tab 页的新 tab 栏实例会先渲染旧主题，attached 里立即同步。
    const app = typeof getApp === 'function' ? getApp() : null;
    const theme = (app && app.globalData && app.globalData.theme) || 'light';
    if (theme !== this.data.theme) this.setData({ theme });
    this.syncSelected();
  },
  pageLifetimes: { show() { this.syncSelected(); } },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current ? `/${current.route}` : '';
      const selected = this.data.list.findIndex((item) => item.pagePath === route);
      const theme = (getApp().globalData && getApp().globalData.theme) || 'light';
      this.setData({ selected: selected >= 0 ? selected : 0, theme });
    },
    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      if (!path) return;
      wx.switchTab({
        url: path,
        fail: (err) => {
          console.error('[tab-bar] switchTab failed:', path, err);
          wx.showModal({
            title: '切换失败',
            content: path + '\n' + (err.errMsg || '未知错误'),
            showCancel: false
          });
        }
      });
    }
  }
});
