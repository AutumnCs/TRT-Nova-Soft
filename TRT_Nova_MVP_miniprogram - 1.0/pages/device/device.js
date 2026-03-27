const deviceService = require('../../services/modules/DeviceService');

const PLANT_OPTIONS = ['龟背竹', '绿萝', '多肉', '薄荷', '番茄', '其他'];

Page({
  _refreshTimer: null,
  _refreshing: false,

  data: {
    deviceCode: '',
    alias: '',
    location: '',
    plantTypeIndex: 0,
    plantOptions: PLANT_OPTIONS,
    deviceList: [],
    cmdInput: ''
  },

  onLoad() {
    this.refreshData();
  },

  onShow() {
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  onDeviceCodeInput(e) {
    this.setData({ deviceCode: e.detail.value });
  },

  onAliasInput(e) {
    this.setData({ alias: e.detail.value });
  },

  onLocationInput(e) {
    this.setData({ location: e.detail.value });
  },

  choosePlantType() {
    wx.showActionSheet({
      itemList: this.data.plantOptions,
      success: (res) => {
        this.setData({ plantTypeIndex: res.tapIndex });
      }
    });
  },

  onCmdInput(e) {
    this.setData({ cmdInput: e.detail.value });
  },

  async bindDevice() {
    if (!this.data.deviceCode) {
      return wx.showToast({ title: '请输入设备唯一码', icon: 'none' });
    }

    wx.showLoading({ title: '绑定中...' });
    try {
      const result = await deviceService.bindDeviceWithProfile({
        deviceCode: this.data.deviceCode,
        alias: this.data.alias,
        location: this.data.location,
        plantType: this.data.plantOptions[this.data.plantTypeIndex] || ''
      });
      wx.hideLoading();

      if (result.success) {
        wx.showToast({ title: '绑定成功' });
        this.setData({
          deviceCode: '',
          alias: '',
          location: '',
          plantTypeIndex: 0
        });
        this.refreshData({ silent: true });
      } else {
        wx.showToast({ title: result.msg || '绑定失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '请求错误', icon: 'none' });
    }
  },

  unbindDevice(e) {
    const logicalKey = e.currentTarget.dataset.logicalkey;
    if (!logicalKey) {
      return wx.showToast({ title: '设备标识缺失', icon: 'none' });
    }

    wx.showModal({
      title: '解绑设备',
      content: '确认解绑该设备吗？',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '解绑中...' });
        try {
          const result = await deviceService.unbindDevice(logicalKey);
          wx.hideLoading();

          if (result.success) {
            wx.showToast({ title: '解绑成功' });
            this.setData({
              deviceList: this.data.deviceList.filter((item) => item.logicalKey !== logicalKey)
            });
            this.refreshData({ silent: true });
          } else {
            wx.showToast({ title: result.msg || '解绑失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          console.error(err);
          wx.showToast({ title: '请求错误', icon: 'none' });
        }
      }
    });
  },

  async refreshData(options = {}) {
    const { silent = false } = options;
    if (this._refreshing) return;
    this._refreshing = true;

    if (!silent) wx.showLoading({ title: '加载中...' });
    try {
      const result = await deviceService.getDeviceData();
      const list = (result.deviceData || []).map((item) => ({
        ...item,
        hasData: !!item.hasLatest
      }));
      this.setData({ deviceList: list });
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) wx.hideLoading();
      this._refreshing = false;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      this.refreshData({ silent: true });
    }, 3000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  async sendCmd(e) {
    const logicalKey = e.currentTarget.dataset.logicalkey;
    const cmd = this.data.cmdInput || 'default_cmd';
    if (!logicalKey) return wx.showToast({ title: '设备标识缺失', icon: 'none' });
    if (!cmd) return wx.showToast({ title: '请输入命令', icon: 'none' });

    wx.showLoading({ title: '发送中...' });
    try {
      const result = await deviceService.sendDeviceCmd(logicalKey, cmd);
      wx.hideLoading();
      if (result.success) {
        wx.showToast({ title: '已发送' });
      } else {
        wx.showToast({ title: '发送失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '请求错误', icon: 'none' });
    }
  }
});
