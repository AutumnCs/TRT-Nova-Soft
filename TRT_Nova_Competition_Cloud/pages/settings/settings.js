const app = getApp();
const mediaStorageService = require('../../services/modules/MediaStorageService');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function getVersionView() {
  let miniProgram = {};
  try { miniProgram = wx.getAccountInfoSync()?.miniProgram || {}; } catch (err) { miniProgram = {}; }
  return {
    environment: { develop: '开发版', trial: '体验版', release: '正式版' }[miniProgram.envVersion] || '未知环境',
    version: miniProgram.version || '未设置'
  };
}

Page({
  data: {
    statusBarHeight: 20,
    noticeFocused: false,
    clearingCache: false,
    versionView: getVersionView()
  },

  onLoad(options = {}) {
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      noticeFocused: options.section === 'notice',
      versionView: getVersionView()
    });
  },

  onShow() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },

  openProfile() {
    wx.navigateTo({ url: '/pages/profileEdit/profileEdit' });
  },

  openWeather() {
    wx.navigateTo({ url: '/pages/weatherSettings/weatherSettings' });
  },

  openCalendar() {
    wx.switchTab({ url: '/pages/calendar/calendar' });
  },

  openAiMemory() {
    wx.navigateTo({ url: '/pages/aiMemory/aiMemory' });
  },

  showDataUse() {
    wx.showModal({
      title: '图片与数据使用',
      content: '头像、植宠封面、成长照片、图片对话附件和主动另存的观察记录按当前账号私有保存。本地开发阶段只写入本地测试服务。首次发送图片或文档前会另行说明第三方 AI 处理与本轮会话附件保存范围。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  clearCache() {
    if (this.data.clearingCache) return;
    wx.showModal({
      title: '清理图片缓存？',
      content: '只清理本机展示缓存，不会删除账号中已保存的头像、封面、会话附件和成长照片。',
      confirmText: '确认清理',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ clearingCache: true });
        try {
          await mediaStorageService.clearDisplayCache();
          wx.showToast({ title: '缓存已清理', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: error.message || '缓存清理失败', icon: 'none' });
        } finally {
          this.setData({ clearingCache: false });
        }
      }
    });
  },

  openAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号吗？本地登录状态会清除，已保存的业务数据不会因此删除。',
      cancelText: '取消',
      confirmText: '确认退出',
      success: (result) => {
        if (!result.confirm) return;
        if (typeof app.clearLoginState === 'function') app.clearLoginState();
        wx.reLaunch({ url: '/pages/auth/auth' });
      }
    });
  }
});
