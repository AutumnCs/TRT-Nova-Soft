const deviceService = require('../../services/modules/DeviceService');

Page({
  data: {
    physicalCode: '',
    productId: '',
    deviceName: '',
    externalDeviceId: '',
    alias: '',
    adminKey: '',
    deviceRegistry: [],
    labels: {
      title: '开发者设备登记',
      physicalCode: '实体设备码',
      alias: '别名(可选)',
      externalDeviceId: 'externalDeviceId(可选)',
      adminKey: 'adminKey(如启用)',
      submit: '登记 / 更新设备',
      registryTitle: '已登记设备',
      empty: '暂无已登记设备',
      rowPhysicalCode: '设备码',
      rowProductId: 'productId',
      rowDeviceName: 'deviceName',
      rowLogicalKey: 'logicalKey'
    }
  },

  onLoad() {
    this.loadRegistry();
  },

  onShow() {
    this.loadRegistry();
  },

  onPhysicalCodeInput(e) {
    this.setData({ physicalCode: e.detail.value });
  },

  onProductIdInput(e) {
    this.setData({ productId: e.detail.value });
  },

  onDeviceNameInput(e) {
    this.setData({ deviceName: e.detail.value });
  },

  onExternalDeviceIdInput(e) {
    this.setData({ externalDeviceId: e.detail.value });
  },

  onAliasInput(e) {
    this.setData({ alias: e.detail.value });
  },

  onAdminKeyInput(e) {
    this.setData({ adminKey: e.detail.value });
  },

  async loadRegistry() {
    try {
      const result = await deviceService.listRegistry();
      this.setData({ deviceRegistry: result.devices || [] });
    } catch (err) {
      console.error('loadRegistry error:', err);
    }
  },

  async registerDevice() {
    const { physicalCode, productId, deviceName, externalDeviceId, alias, adminKey } = this.data;

    if (!physicalCode || !productId || !deviceName) {
      wx.showToast({
        title: '请填写设备码、productId、deviceName',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      const result = await deviceService.upsertRegistry({
        physicalCode,
        productId,
        deviceName,
        externalDeviceId,
        alias,
        adminKey
      });
      wx.hideLoading();

      if (result.success) {
        wx.showToast({
          title: result.action === 'updated' ? '已存在，已更新映射' : '登记成功',
          icon: 'success'
        });
        this.loadRegistry();
      } else {
        wx.showModal({
          title: '保存失败',
          content: result.msg || result.error || '未知错误',
          showCancel: false
        });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '请求错误',
        content: err?.errMsg || err?.message || '调用云函数失败',
        showCancel: false
      });
      console.error(err);
    }
  }
});
