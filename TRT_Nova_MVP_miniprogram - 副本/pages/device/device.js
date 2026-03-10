// pages/device/device.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    bindMethod: 'manual', // manual or auto
    deviceCode: '',
    deviceName: '智能花盆',
    deviceType: 'other',
    deviceTypeLabel: '其他设备',
    deviceTypes: [
      { value: 'flower_pot', label: '智能花盆' },
      { value: 'watering_system', label: '自动浇水系统' },
      { value: 'light_system', label: '补光系统' },
      { value: 'other', label: '其他设备' }
    ],
    isBinding: false
  },

  onLoad: function (options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight
    });
    
    // 检查登录状态
    this.checkLoginStatus();
  },

  onShow: function() {
    // 设置导航栏
    wx.setNavigationBarTitle({ title: '设备管理' });
  },
  
  // 检查登录状态
  checkLoginStatus: function() {
    // 先检查本地存储，确保状态最新
    app.checkLoginStatus();
    
    const { hasLogin } = app.globalData;
    if (!hasLogin) {
      // 如果未登录，跳转到登录页面
      setTimeout(() => {
        app.gotoLoginPage();
      }, 100);
      return false;
    }
    return true;
  },

  // 选择绑定方式
  chooseBindMethod: function(e) {
    const method = e.currentTarget.dataset.method;
    this.setData({
      bindMethod: method
    });
    wx.vibrateShort({ type: 'light' });
  },

  // 输入设备编码
  inputDeviceCode: function(e) {
    this.setData({
      deviceCode: e.detail.value
    });
  },

  // 输入设备名称
  inputDeviceName: function(e) {
    this.setData({
      deviceName: e.detail.value
    });
  },

  // 选择设备类型
  selectDeviceType: function(e) {
    const index = e.detail.value;
    const deviceType = this.data.deviceTypes[index].value;
    const deviceTypeLabel = this.data.deviceTypes[index].label;
    this.setData({
      deviceType: deviceType,
      deviceTypeLabel: deviceTypeLabel
    });
  },

  // 获取设备类型标签
  getDeviceTypeLabel: function() {
    const { deviceTypes, deviceType } = this.data;
    const type = deviceTypes.find(item => item.value === deviceType);
    return type ? type.label : '';
  },

  // 确认绑定设备
  confirmBindDevice: function() {
    const { deviceCode, deviceName, deviceType } = this.data;
    
    if (!deviceCode) {
      wx.showToast({
        title: '请输入设备编码',
        icon: 'none'
      });
      return;
    }
    
    if (deviceCode.length < 3) {
      wx.showToast({
        title: '设备编码至少3位',
        icon: 'none'
      });
      return;
    }
    
    this.setData({ isBinding: true });
    wx.showLoading({ title: '绑定中...', mask: true });
    
    // 模拟设备绑定过程
    setTimeout(() => {
      wx.hideLoading();
      this.setData({ isBinding: false });
      
      wx.showToast({
        title: '设备绑定成功',
        icon: 'success',
        duration: 1500
      });
      
      // 延迟返回首页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }, 2000);
  },

  // 返回到上一页
  goBack: function() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateBack();
  },

  // 自动发现设备
  autoDiscoverDevice: function() {
    wx.showToast({
      title: '自动发现功能开发中',
      icon: 'none'
    });
  }
});
