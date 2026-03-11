const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');

const DEFAULT_AVATAR =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

Page({
  data: {
    statusBarHeight: 20,
    isDeveloper: true,
    user: {
      name: '',
      level: '',
      avatar: DEFAULT_AVATAR
    },
    menu: [
      { key: 'garden', icon: '🌿', title: '我的花园', desc: '植物管理' },
      { key: 'notice', icon: '🔔', title: '通知设置', desc: '已开启' },
      { key: 'setting', icon: '⚙️', title: '系统设置', desc: '' },
      { key: 'about', icon: 'ℹ️', title: '关于我们', desc: '小程序信息' }
    ]
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    this.checkLoginStatus();
    this.loadUserProfile();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.checkLoginStatus();
    this.loadUserProfile();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => wx.redirectTo({ url: '/pages/auth/auth' }), 80);
      return false;
    }
    return true;
  },

  normalizeAvatar(url) {
    if (!url || typeof url !== 'string') return DEFAULT_AVATAR;
    return url;
  },

  resolveUserName(cloudProfile, localUser) {
    return (cloudProfile && cloudProfile.nickName) || (localUser && localUser.nickName) || '';
  },

  resolveAvatar(cloudProfile, localUser) {
    const cloudAvatar = cloudProfile && cloudProfile.avatarUrl;
    const localAvatar = localUser && localUser.avatarUrl;
    return this.normalizeAvatar(cloudAvatar || localAvatar || DEFAULT_AVATAR);
  },

  async loadUserProfile() {
    if (!this.checkLoginStatus()) return;
    const localUser = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};

    try {
      const profile = await userProfileService.getMyProfile();
      this.setData({
        user: {
          name: this.resolveUserName(profile, localUser),
          level: '',
          avatar: this.resolveAvatar(profile, localUser)
        }
      });
      return;
    } catch (err) {
      // 云端失败回退本地
    }

    this.setData({
      user: {
        name: this.resolveUserName(null, localUser),
        level: '',
        avatar: this.resolveAvatar(null, localUser)
      }
    });
  },

  onAvatarError() {
    this.setData({ 'user.avatar': DEFAULT_AVATAR });
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profileEdit/profileEdit' });
  },

  onMenuItemTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.menu[index];
    if (!item) return;

    if (item.key === 'about') {
      wx.navigateTo({ url: '/pages/about/about' });
      return;
    }

    if (item.key === 'garden') {
      wx.navigateTo({ url: '/pages/garden/garden' });
      return;
    }

    wx.showToast({
      title: `${item.title}开发中`,
      icon: 'none'
    });
  },

  onOpenDeviceAdmin() {
    wx.navigateTo({ url: '/pages/deviceAdmin/deviceAdmin' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出登录吗？',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync('userInfo');
        app.globalData.userInfo = null;
        app.globalData.hasLogin = false;
        this.setData({
          user: { name: '', level: '', avatar: DEFAULT_AVATAR }
        });
        wx.showToast({ title: '已退出登录', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
      }
    });
  }
});
