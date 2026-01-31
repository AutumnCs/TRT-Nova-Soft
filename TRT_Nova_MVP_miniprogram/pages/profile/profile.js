const app = getApp()
const userProfileService = require('../../services/modules/UserProfileService');

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
      { icon: "⚙️", title: "系统设置", desc: "" },
      { icon: "ℹ️", title: "关于我们", desc: "小程序信息" }
    ]
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
    
    // 检查登录状态
    this.checkLoginStatus();

    this.loadUserProfile();
  },

  onShow: function() {
    // 设置导航栏 - 根据custom-tab-bar配置，我的页是第3个tab，索引为2
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }

    // 每次显示页面都检查登录状态
    this.checkLoginStatus();
    this.loadUserProfile();
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 先检查本地存储，确保状态最新
    app.checkLoginStatus();
    
    const { hasLogin } = app.globalData;
    if (!hasLogin) {
      // 如果未登录，跳转到登录页面
      // 使用setTimeout延迟跳转，避免渲染冲突
      setTimeout(() => {
        wx.redirectTo({
          url: '/pages/auth/auth'
        });
      }, 100);
      return false;
    }
    return true;
  },

  /**
   * 加载用户资料（优先云端资料，其次本地 userInfo）
   */
  loadUserProfile: async function() {
    if (!this.checkLoginStatus()) return;

    try {
      const profile = await userProfileService.getMyProfile();
      if (profile) {
        this.setData({
          user: {
            name: profile.nickName || '未命名用户',
            level: "LV.1 新手指南",
            avatar: profile.avatarUrl || this.data.user.avatar
          }
        });
        return;
      }
    } catch (err) {
      // ignore，降级到本地 userInfo
    }

    const { userInfo } = app.globalData;
    if (userInfo) {
      this.setData({
        user: {
          name: userInfo.nickName,
          level: "LV.1 新手指南",
          avatar: userInfo.avatarUrl
        }
      });
    }
  },

  /**
   * 跳转到个人资料编辑页
   */
  onEditProfile: function() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({
      url: '/pages/profileEdit/profileEdit'
    });
  },
  
  onMenuItemTap: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.menu[index];
    wx.vibrateShort({ type: 'light' });
    
    if (item.title === '关于我们') {
      // 导航到关于我们页面
      wx.navigateTo({
        url: '/pages/about/about'
      });
    } else {
      wx.showToast({
        title: item.title + ' 开发中',
        icon: 'none'
      });
    }
  },
  
  // 退出登录
  onLogout: function() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      cancelText: '取消',
      confirmText: '确定',
      success: (res) => {
        if (res.confirm) {
          // 清除本地存储的用户信息
          wx.removeStorageSync('userInfo');
          
          // 更新全局登录状态
          app.globalData.userInfo = null;
          app.globalData.hasLogin = false;
          
          // 清空页面用户数据
          this.setData({
            user: {
              name: "",
              level: "",
              avatar: ""
            }
          });
          
          // 显示退出成功提示
          wx.showToast({
            title: '已退出登录',
            icon: 'success',
            duration: 1000
          });
          
          // 跳转到首页，首页会自动检测登录状态并重定向到登录页面
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }, 1000);
        }
      }
    });
  }
})
