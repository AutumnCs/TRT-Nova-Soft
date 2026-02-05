// auth.js
const app = getApp()
const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Page({
  data: {
    statusBarHeight: 20,
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: '',
    },
    hasUserInfo: false
  },
  
  onLoad: function (options) {
    // 获取系统信息以适配状态栏
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
  },
  
  // 选择头像
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    this.setData({
      "userInfo.avatarUrl": avatarUrl
    });
    this.checkAndLogin();
  },
  
  // 输入昵称
  onInputChange(e) {
    const nickName = e.detail.value;
    this.setData({
      "userInfo.nickName": nickName
    });
    this.checkAndLogin();
  },
  
  // 检查信息完整性并登录
  checkAndLogin() {
    const { avatarUrl, nickName } = this.data.userInfo;
    if (nickName && avatarUrl && avatarUrl !== defaultAvatarUrl) {
      this.setData({ hasUserInfo: true });
      // 信息完整，执行登录
      this.loginSuccess();
    }
  },
  

  
  // 登录成功处理
  async loginSuccess() {
    // 显示加载提示
    wx.showLoading({
      title: '登录中',
      mask: true
    });
    
    try {
      // 调用登录云函数获取真实的openid
      const loginRes = await wx.cloud.callFunction({
        name: 'login',
        data: {}
      });
      
      console.log('登录云函数返回结果:', loginRes);
      
      // 提取openid
      let openid = '';
      if (loginRes && loginRes.result && loginRes.result.userInfo && (loginRes.result.userInfo.openId || loginRes.result.userInfo.openid)) {
        openid = loginRes.result.userInfo.openId || loginRes.result.userInfo.openid;
      } else if (loginRes && loginRes.result && loginRes.result.openid) {
        openid = loginRes.result.openid;
      } else if (loginRes && loginRes.result && loginRes.result.result && loginRes.result.result.openid) {
        openid = loginRes.result.result.openid;
      } else if (loginRes && loginRes.result && loginRes.result.result && loginRes.result.result.userInfo && (loginRes.result.result.userInfo.openId || loginRes.result.result.userInfo.openid)) {
        openid = loginRes.result.result.userInfo.openId || loginRes.result.result.userInfo.openid;
      } else {
        throw new Error('无法获取openid');
      }
      
      console.log('获取到的真实openid:', openid);
      
      // 保存用户信息
      const userInfo = {
        avatarUrl: this.data.userInfo.avatarUrl,
        nickName: this.data.userInfo.nickName,
        openId: openid,
        loginTime: new Date().getTime()
      };
      
      // 保存到本地存储
      wx.setStorageSync('userInfo', userInfo);
      
      // 保存到全局状态
      app.globalData.userInfo = userInfo;
      app.globalData.hasLogin = true;
      
      // 隐藏加载提示
      wx.hideLoading();
      
      // 登录成功提示
      wx.showToast({
        title: '登录成功',
        icon: 'success',
        duration: 1000
      });
      
      // 跳转到首页
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }, 1000);
    } catch (error) {
      console.error('登录失败:', error);
      
      // 隐藏加载提示
      wx.hideLoading();
      
      // 显示错误提示
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },
  

})
