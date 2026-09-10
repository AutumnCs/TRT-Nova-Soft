const {
  getCurrentPagePath,
  resolveTabSelection,
  canStartTabSwitch
} = require('./navigation-state');

Component({
  data: {
    selected: 0,
    switching: false,
    color: '#6b7280',
    selectedColor: '#191923',
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: '⌂' },
      { pagePath: '/pages/assistant/assistant', text: 'AI助手', icon: '✦' },
      { pagePath: '/pages/calendar/calendar', text: '日历', icon: '▦' },
      { pagePath: '/pages/profile/profile', text: '我的', icon: '○' }
    ]
  },
  attached() { this.syncSelected(); },
  pageLifetimes: { show() { this.syncSelected(); } },
  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const selected = resolveTabSelection(this.data.list, getCurrentPagePath(pages));
      this._switching = false;
      if (this.data.selected !== selected || this.data.switching) {
        this.setData({ selected, switching: false });
      }
    },
    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      const targetIndex = Number(e.currentTarget.dataset.index);
      const currentPath = getCurrentPagePath(getCurrentPages());
      if (!canStartTabSwitch({
        switching: this._switching,
        currentPath,
        targetPath: path
      })) {
        // During an in-flight switch the old page is still returned by
        // getCurrentPages(). Re-syncing here would release the lock early and
        // allow a third tap to dispatch another wx.switchTab request.
        if (!this._switching) this.syncSelected();
        return;
      }

      const previousSelected = this.data.selected;
      this._switching = true;
      this.setData({
        selected: Number.isInteger(targetIndex) ? targetIndex : previousSelected,
        switching: true
      }, () => {
        wx.switchTab({
          url: path,
          fail: () => {
            this._switching = false;
            this.setData({ selected: previousSelected, switching: false });
          },
          complete: () => {
            this._switching = false;
            if (this.data.switching) this.setData({ switching: false });
          }
        });
      });
    },
    noop() {}
  }
});
