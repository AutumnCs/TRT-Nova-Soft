// pages/device/device.js
Page({
  data: {
    deviceId: '',
    deviceName: '',
    deviceList: [],
    cmdInput: ''
  },

  onLoad() {
    this.refreshData();
  },

  // Input Handlers
  onIdInput(e) { this.setData({ deviceId: e.detail.value }) },
  onNameInput(e) { this.setData({ deviceName: e.detail.value }) },
  onCmdInput(e) { this.setData({ cmdInput: e.detail.value }) },

  // 1. Bind Device
  async bindDevice() {
    if (!this.data.deviceId) return wx.showToast({ title: 'Enter Device ID', icon: 'none' });

    wx.showLoading({ title: 'Binding...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'bindDevice',
        data: {
          deviceId: this.data.deviceId,
          deviceName: this.data.deviceName
        }
      });

      wx.hideLoading();
      if (res.result.success) {
        wx.showToast({ title: 'Bound Successfully' });
        this.refreshData();
      } else {
        wx.showToast({ title: res.result.msg || 'Failed', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: 'Error', icon: 'none' });
    }
  },

  // 2. Get Data
  async refreshData() {
    wx.showLoading({ title: 'Loading...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getDeviceData'
      });

      console.log('Device Data:', res.result);
      if (res.result && res.result.deviceData) {
        // Simple mapping, handling structure might need adjustment based on data shape
        this.setData({ deviceList: res.result.deviceData });
      }
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error(err);
    }
  },

  // 3. Send Command
  async sendCmd(e) {
    const deviceId = e.currentTarget.dataset.id;
    const cmd = this.data.cmdInput || 'default_cmd'; // Use input or default

    if (!cmd) return wx.showToast({ title: 'Enter Command', icon: 'none' });

    wx.showLoading({ title: 'Sending...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'sendDeviceCmd',
        data: {
          deviceId: deviceId,
          cmd: cmd
        }
      });

      wx.hideLoading();
      if (res.result.success) {
        wx.showToast({ title: 'Sent' });
        console.log('OneNET Resp:', res.result.oneNetResp);
      } else {
        wx.showToast({ title: 'Failed', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: 'Error', icon: 'none' });
    }
  }
});
