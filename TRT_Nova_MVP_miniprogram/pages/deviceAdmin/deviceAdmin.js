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
      title: '\u5f00\u53d1\u8005\u8bbe\u5907\u767b\u8bb0',
      physicalCode: '\u5b9e\u4f53\u8bbe\u5907\u7801',
      alias: '\u522b\u540d\uff08\u53ef\u9009\uff09',
      externalDeviceId: 'externalDeviceId\uff08\u53ef\u9009\uff09',
      adminKey: 'adminKey\uff08\u5982\u542f\u7528\uff09',
      submit: '\u767b\u8bb0 / \u66f4\u65b0\u8bbe\u5907',
      registryTitle: '\u5df2\u767b\u8bb0\u8bbe\u5907',
      empty: '\u6682\u65e0\u5df2\u767b\u8bb0\u8bbe\u5907',
      rowPhysicalCode: '\u8bbe\u5907\u7801',
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

  onPhysicalCodeInput(e) { this.setData({ physicalCode: e.detail.value }); },
  onProductIdInput(e) { this.setData({ productId: e.detail.value }); },
  onDeviceNameInput(e) { this.setData({ deviceName: e.detail.value }); },
  onExternalDeviceIdInput(e) { this.setData({ externalDeviceId: e.detail.value }); },
  onAliasInput(e) { this.setData({ alias: e.detail.value }); },
  onAdminKeyInput(e) { this.setData({ adminKey: e.detail.value }); },

  async loadRegistry() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'registerDevice',
        data: { action: 'list' }
      });
      this.setData({
        deviceRegistry: (res.result && res.result.devices) || []
      });
    } catch (err) {
      console.error('loadRegistry error:', err);
    }
  },

  async registerDevice() {
    const { physicalCode, productId, deviceName, externalDeviceId, alias, adminKey } = this.data;
    if (!physicalCode || !productId || !deviceName) {
      wx.showToast({ title: '请填写设备码、productId、deviceName', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'registerDevice',
        data: {
          action: 'upsert',
          physicalCode,
          productId,
          deviceName,
          externalDeviceId,
          alias,
          adminKey
        }
      });

      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({
          title: res.result.action === 'updated' ? '已存在，已更新映射' : '登记成功',
          icon: 'success'
        });
        this.loadRegistry();
      } else {
        const detail = (res.result && (res.result.msg || res.result.error)) || JSON.stringify(res.result || {});
        wx.showModal({
          title: '保存失败',
          content: detail || '未知错误',
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
