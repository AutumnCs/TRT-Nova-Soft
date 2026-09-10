const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');
const authService = require('../../services/modules/AuthService');
const plantJournalService = require('../../services/modules/PlantJournalService');
const mediaStorageService = require('../../services/modules/MediaStorageService');
const {
  getCachedUserForOpenid,
  getTokenOpenid,
  isProfileForActiveOpenid
} = require('../../services/modules/auth-session-state');

const DEFAULT_AVATAR_URL =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

function createEmptyUser() {
  return {
    name: '未命名用户',
    level: 'LV.1 新手指南',
    avatar: DEFAULT_AVATAR_URL
  };
}

function createUserView(profile = {}) {
  return {
    name: profile.nickName || '未命名用户',
    level: 'LV.1 新手指南',
    avatar: profile.avatarUrl || DEFAULT_AVATAR_URL
  };
}

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    user: createEmptyUser(),
    profileLoading: false,
    profileRefreshing: false,
    profileLoaded: false,
    recentGrowth: [],
    growthLoading: false,
    growthRefreshing: false,
    growthLoaded: false,
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
        key: 'wiki',
        icon: '📚',
        title: '养护知识库',
        desc: '植物百科与养护指南',
        tail: '去看看'
      },
      {
        key: 'journal',
        icon: '🌱',
        title: '成长时间线',
        desc: '汇总所有植宠的图文记录',
        tail: '去记录'
      },
      {
        key: 'notice',
        icon: '🔔',
        title: '通知设置',
        desc: '任务提醒状态与外部依赖',
        tail: '查看'
      },
      {
        key: 'aiMemory',
        icon: '🧠',
        title: 'AI 伙伴记忆',
        desc: '查看、修正或删除 NOVA 的结构化记忆',
        tail: '可管理'
      },
      {
        key: 'dataUse',
        icon: '🖼️',
        title: '图片与数据使用',
        desc: '了解照片的存储和使用方式',
        tail: '查看'
      },
      {
        key: 'cache',
        icon: '🧹',
        title: '清理图片缓存',
        desc: '不删除已保存的成长照片',
        tail: '清理'
      },
      {
        key: 'version',
        icon: '🏷️',
        title: '版本信息',
        desc: '当前小程序环境与版本',
        tail: '查看'
      },
      {
        key: 'setting',
        icon: '⚙️',
        title: '系统设置',
        desc: '资料、城市、通知、隐私与版本',
        tail: '进入'
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
    this.setData({ statusBarHeight: getStatusBarHeight() });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadUserProfile();
    this.loadRecentGrowth();
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

    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const localUser = getCachedUserForOpenid(
      app.globalData.userInfo || wx.getStorageSync('userInfo'),
      expectedOpenid
    );
    const preserveSnapshot = Boolean(
      this.data.profileLoaded &&
      this._profileLoadedOpenid === expectedOpenid
    );
    const requestId = (this._profileRequestId || 0) + 1;
    this._profileRequestId = requestId;
    this.setData(preserveSnapshot
      ? { profileRefreshing: true }
      : {
          user: localUser ? createUserView(localUser) : createEmptyUser(),
          profileLoading: !localUser,
          profileRefreshing: Boolean(localUser),
          profileLoaded: Boolean(localUser)
        });
    if (localUser && !preserveSnapshot) this._profileLoadedOpenid = expectedOpenid;

    try {
      const profile = await userProfileService.getMyProfile();
      if (
        this._profileRequestId === requestId &&
        isProfileForActiveOpenid(profile, expectedOpenid, authService.getTokenMeta())
      ) {
        this._profileLoadedOpenid = expectedOpenid;
        this.setData({
          user: createUserView(profile),
          profileLoading: false,
          profileRefreshing: false,
          profileLoaded: true
        });
        return;
      }
    } catch (err) {
      console.error('loadUserProfile failed:', err);
    }

    if (this._profileRequestId !== requestId) return;

    if (preserveSnapshot) {
      this.setData({ profileLoading: false, profileRefreshing: false });
      return;
    }

    this.setData({
      user: localUser ? createUserView(localUser) : createEmptyUser(),
      profileLoading: false,
      profileRefreshing: false,
      profileLoaded: Boolean(localUser)
    });
  },

  async loadRecentGrowth() {
    if (!this.checkLoginStatus()) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveSnapshot = Boolean(
      this.data.growthLoaded &&
      this._growthLoadedOpenid === expectedOpenid
    );
    const requestId = (this._growthRequestId || 0) + 1;
    this._growthRequestId = requestId;
    this.setData(preserveSnapshot
      ? { growthRefreshing: true }
      : { recentGrowth: [], growthLoading: true, growthRefreshing: false, growthLoaded: false });
    try {
      const result = await plantJournalService.listTimeline({ limit: 3 });
      if (result?.success === false) throw new Error(result.msg || '成长记录加载失败');
      if (this._growthRequestId !== requestId || getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid) return;
      const records = (result.records || []).filter((item) => item.ownerOpenid === expectedOpenid).map((item) => ({
        ...item,
        dateLabel: String(item.eventDate || '').slice(5).replace('-', '.'),
        coverPhoto: item.photos?.[0] || ''
      }));
      this._growthLoadedOpenid = expectedOpenid;
      this.setData({
        recentGrowth: records,
        growthLoading: false,
        growthRefreshing: false,
        growthLoaded: true
      });
    } catch (err) {
      if (this._growthRequestId === requestId) {
        this.setData(preserveSnapshot
          ? { growthRefreshing: false }
          : { recentGrowth: [], growthLoading: false, growthRefreshing: false, growthLoaded: true });
      }
    }
  },

  onUnload() {
    this._profileRequestId = (this._profileRequestId || 0) + 1;
    this._growthRequestId = (this._growthRequestId || 0) + 1;
  },

  onEditProfile() {
    wx.navigateTo({ url: '/pages/profileEdit/profileEdit' });
  },

  onMenuItemTap(e) {
    const { index } = e.currentTarget.dataset;
    const item = this.data.menu[index];
    if (!item) return;

    if (item.key === 'edit') {
      this.onEditProfile();
      return;
    }

    if (item.key === 'garden') {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    if (item.key === 'wiki') {
      wx.navigateTo({ url: '/pages/wiki/wiki' });
      return;
    }

    if (item.key === 'journal') {
      wx.navigateTo({ url: '/pages/plantJournal/plantJournal' });
      return;
    }

    if (item.key === 'notice') {
      wx.navigateTo({ url: '/pages/settings/settings?section=notice' });
      return;
    }

    if (item.key === 'aiMemory') {
      wx.navigateTo({ url: '/pages/aiMemory/aiMemory' });
      return;
    }

    if (item.key === 'dataUse') {
      wx.showModal({
        title: '图片与数据使用',
        content: '头像、植宠封面、成长照片、图片对话附件和主动另存的观察记录按当前账号私有保存。本地开发阶段只写入本地测试服务，不会写入已过期的云开发环境。首次发送图片前会另行告知：图片会发送给第三方 AI 模型处理，并保存为本轮对话附件。',
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }

    if (item.key === 'cache') {
      wx.showModal({
        title: '清理图片缓存？',
        content: '只清理本机展示缓存，不会删除账号中已保存的头像、封面和成长照片。',
        confirmText: '确认清理',
        success: async (res) => {
          if (!res.confirm) return;
          await mediaStorageService.clearDisplayCache();
          wx.showToast({ title: '缓存已清理', icon: 'success' });
        }
      });
      return;
    }

    if (item.key === 'version') {
      let miniProgram = {};
      try { miniProgram = wx.getAccountInfoSync()?.miniProgram || {}; } catch (err) { miniProgram = {}; }
      const environment = { develop: '开发版', trial: '体验版', release: '正式版' }[miniProgram.envVersion] || '未知环境';
      wx.showModal({
        title: '版本信息',
        content: `${environment}\n版本号：${miniProgram.version || '未设置'}`,
        showCancel: false,
        confirmText: '关闭'
      });
      return;
    }

    if (item.key === 'about') {
      wx.navigateTo({ url: '/pages/about/about' });
      return;
    }

    if (item.key === 'setting') {
      wx.navigateTo({ url: '/pages/settings/settings' });
      return;
    }

    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: `${item.title}开发中`,
      icon: 'none'
    });
  },

  openGrowthTimeline() {
    wx.navigateTo({ url: '/pages/plantJournal/plantJournal' });
  },

  onAvatarError() {
    if (this.data.user.avatar === DEFAULT_AVATAR_URL) return;
    this.setData({ 'user.avatar': DEFAULT_AVATAR_URL });
    wx.showToast({ title: '头像图片无法显示，请重新选择', icon: 'none' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出登录吗？',
      cancelText: '取消',
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) return;

        this._profileRequestId = (this._profileRequestId || 0) + 1;
        app.clearLoginState();

        this.setData({
          user: createEmptyUser(),
          profileLoading: false,
          profileRefreshing: false,
          profileLoaded: false,
          recentGrowth: [],
          growthLoading: false,
          growthRefreshing: false,
          growthLoaded: false
        });

        wx.showToast({
          title: '已退出登录',
          icon: 'success',
          duration: 1000
        });

        setTimeout(() => {
          wx.reLaunch({ url: '/pages/auth/auth' });
        }, 1000);
      }
    });
  }
});
