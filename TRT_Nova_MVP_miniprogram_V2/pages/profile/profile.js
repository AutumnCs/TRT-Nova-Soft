const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');
const authService = require('../../services/modules/AuthService');
const themeBehavior = require('../../services/modules/ThemeBehavior');

Page({
  behaviors: [themeBehavior],

  data: {
    user: {
      name: 'Fourier',
      level: 'LV.1 新手指南',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=100&auto=format&fit=crop'
    },
    menu: [
      {
        key: 'edit',
        icon: '📝',
        title: '资料编辑',
        desc: '编辑头像 / 昵称 / 资料',
        tail: '去修改'
      },
      {
        key: 'garden',
        icon: '🌿',
        title: '我的花园',
        desc: '植物管理',
        tail: '植物管理'
      },
      {
        key: 'notice',
        icon: '🔔',
        title: '通知设置',
        desc: '已开启',
        tail: '已开启'
      },
      {
        key: 'setting',
        icon: '⚙️',
        title: '系统设置',
        desc: '浅色 / 深色主题',
        tail: '浅色'
      },
      {
        key: 'about',
        icon: 'ℹ️',
        title: '关于我们',
        desc: '小程序信息',
        tail: '小程序信息'
      }
    ]
  },

  onLoad() {
    this.setData({ statusBarHeight: this.getHeaderTop(), theme: app.globalData.theme || 'light' });
    this.checkLoginStatus();
    this.loadUserProfile();
  },

  onShow() {
    this.syncTheme();
    this.refreshSettingThemeLabel();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    this.checkLoginStatus();
    this.loadUserProfile();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth/auth' });
      }, 100);
      return false;
    }
    return true;
  },

  async loadUserProfile() {
    if (!this.checkLoginStatus()) return;

    try {
      const profile = await userProfileService.getMyProfile();
      if (profile) {
        this.setData({
          user: {
            name: profile.nickName || '未命名用户',
            level: 'LV.1 新手指南',
            avatar: profile.avatarUrl || this.data.user.avatar
          }
        });
        return;
      }
    } catch (err) {
      console.error('loadUserProfile failed:', err);
    }

    const localUser = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    this.setData({
      user: {
        name: localUser.nickName || '未命名用户',
        level: 'LV.1 新手指南',
        avatar: localUser.avatarUrl || this.data.user.avatar
      }
    });
  },

  onEditProfile() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/profileEdit/profileEdit' });
  },

  // 同步「系统设置」项右侧显示的当前主题名
  refreshSettingThemeLabel() {
    const label = (app.globalData.theme === 'dark') ? '深色' : '浅色';
    const idx = this.data.menu.findIndex((m) => m.key === 'setting');
    if (idx > -1 && this.data.menu[idx].tail !== label) {
      this.setData({ ['menu[' + idx + '].tail']: label });
    }
  },

  onMenuItemTap(e) {
    const { index } = e.currentTarget.dataset;
    const item = this.data.menu[index];
    wx.vibrateShort({ type: 'light' });

    if (!item) return;

    if (item.key === 'edit') {
      this.onEditProfile();
      return;
    }

    if (item.key === 'garden') {
      wx.navigateTo({ url: '/pages/garden/garden' });
      return;
    }

    if (item.key === 'about') {
      wx.navigateTo({ url: '/pages/about/about' });
      return;
    }

    // 系统设置：浅色 / 深色切换（reLaunch 清栈重建，首帧即新主题）
    if (item.key === 'setting') {
      this.toggleTheme();
      return;
    }

    wx.showToast({
      title: `${item.title}开发中`,
      icon: 'none'
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出登录吗？',
      cancelText: '取消',
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) return;

        wx.removeStorageSync('userInfo');
        authService.clearToken();
        app.globalData.userInfo = null;
        app.globalData.hasLogin = false;

        this.setData({
          user: {
            name: '',
            level: '',
            avatar: ''
          }
        });

        wx.showToast({
          title: '已退出登录',
          icon: 'success',
          duration: 1000
        });

        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 1000);
      }
    });
  }
});
