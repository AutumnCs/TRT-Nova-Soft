const deviceService = require('../../services/modules/DeviceService');

const PLANT_OPTIONS = ['龟背竹', '绿萝', '多肉', '薄荷', '番茄', '其他'];

Page({
  data: {
    logicalKey: '',
    alias: '',
    location: '',
    plantOptions: PLANT_OPTIONS,
    plantTypeIndex: 0,
    saving: false
  },

  async onLoad(options) {
    const logicalKey = decodeURIComponent(options?.logicalKey || '');
    this.setData({ logicalKey });
    await this.loadCurrentInfo();
  },

  async loadCurrentInfo() {
    if (!this.data.logicalKey) return;
    wx.showLoading({ title: '加载中...' });
    try {
      const result = await deviceService.getDeviceData({
        logicalKey: this.data.logicalKey,
        withHistory: false
      });
      const row = (result.deviceData || [])[0];
      if (!row) return;
      const index = Math.max(0, this.data.plantOptions.indexOf(row.plantType || '其他'));
      this.setData({
        alias: row.alias || '',
        location: row.location || '',
        plantTypeIndex: index
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
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

  async onSave() {
    if (this.data.saving) return;
    if (!this.data.logicalKey) {
      wx.showToast({ title: '缺少设备标识', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    try {
      const result = await deviceService.updateBoundDeviceInfo({
        logicalKey: this.data.logicalKey,
        alias: this.data.alias.trim(),
        location: this.data.location.trim(),
        plantType: this.data.plantOptions[this.data.plantTypeIndex] || '其他'
      });
      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
      } else {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  }
});
