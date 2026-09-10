const deviceService = require('../../services/modules/DeviceService');
const plantService = require('../../services/modules/PlantService');
const alertService = require('../../services/modules/AlertService');

const FALLBACK_PLANT_OPTIONS = plantService.buildPlantOptions(plantService.getFallbackPlants());

Page({
  _refreshTimer: null,
  _refreshing: false,

  data: {
    deviceCode: '',
    alias: '',
    location: '',
    plantTypeIndex: 0,
    plantOptions: FALLBACK_PLANT_OPTIONS,
    deviceList: [],
    cmdInput: ''
  },

  onLoad() {
    this.loadPlantOptions();
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

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },

  async loadPlantOptions() {
    const buildOptions = (plants) => plantService.buildPlantOptions(plants);

    try {
      const cachedPlants = plantService.getCachedPlants();
      if (cachedPlants.length > 0) {
        this.setData({ plantOptions: buildOptions(cachedPlants), plantTypeIndex: 0 });
      }

      const result = await plantService.getPlants({ useCache: true });
      this.setData({ plantOptions: buildOptions(result?.plants), plantTypeIndex: 0 });
    } catch (err) {
      console.warn('[device] loadPlantOptions failed, use fallback:', err);
      this.setData({ plantOptions: FALLBACK_PLANT_OPTIONS, plantTypeIndex: 0 });
    }
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
      return wx.showToast({ title: 'Enter device code', icon: 'none' });
    }

    wx.showLoading({ title: 'Binding...' });
    try {
      const result = await deviceService.bindDeviceWithProfile({
        deviceCode: this.data.deviceCode,
        alias: this.data.alias,
        location: this.data.location,
        plantType: this.data.plantOptions[this.data.plantTypeIndex] || 'Other'
      });
      wx.hideLoading();

      if (result.success) {
        wx.showToast({ title: 'Bound' });
        this.setData({
          deviceCode: '',
          alias: '',
          location: '',
          plantTypeIndex: 0
        });
        this.refreshData({ silent: true });
      } else {
        wx.showToast({ title: result.msg || 'Bind failed', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: 'Request failed', icon: 'none' });
    }
  },

  unbindDevice(e) {
    const logicalKey = e.currentTarget.dataset.logicalkey;
    if (!logicalKey) {
      return wx.showToast({ title: 'Missing device key', icon: 'none' });
    }

    wx.showModal({
      title: 'Unbind Device',
      content: 'Confirm unbinding this device?',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: 'Unbinding...' });
        try {
          const result = await deviceService.unbindDevice(logicalKey);
          wx.hideLoading();

          if (result.success) {
            wx.showToast({ title: 'Unbound' });
            this.setData({
              deviceList: this.data.deviceList.filter((item) => item.logicalKey !== logicalKey)
            });
            this.refreshData({ silent: true });
          } else {
            wx.showToast({ title: result.msg || 'Unbind failed', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          console.error(err);
          wx.showToast({ title: 'Request failed', icon: 'none' });
        }
      }
    });
  },

  async refreshData(options = {}) {
    const { silent = false } = options;
    if (this._refreshing) return;
    this._refreshing = true;

    if (!silent) wx.showLoading({ title: 'Loading...' });
    try {
      const result = await deviceService.getDeviceData();
      const list = (result.deviceData || []).map((item) => ({
        ...item,
        hasData: !!item.hasLatest,
        online: !alertService.isDeviceOffline(item)
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
    const rawInput = this.data.cmdInput || '';
    if (!logicalKey) return wx.showToast({ title: 'Missing device key', icon: 'none' });
    if (!rawInput) return wx.showToast({ title: 'Enter action', icon: 'none' });

    wx.showLoading({ title: 'Sending...' });
    try {
      let commandInput;
      try {
        commandInput = JSON.parse(rawInput);
      } catch (err) {
        commandInput = rawInput;
      }

      const action = typeof commandInput === 'string'
        ? commandInput.trim()
        : commandInput && typeof commandInput === 'object' && !Array.isArray(commandInput)
          ? String(commandInput.action || '').trim()
          : '';

      if (!action) {
        wx.hideLoading();
        return wx.showToast({ title: 'Enter a valid action', icon: 'none' });
      }

      const args = commandInput && typeof commandInput === 'object' && !Array.isArray(commandInput) && commandInput.args && typeof commandInput.args === 'object' && !Array.isArray(commandInput.args)
        ? commandInput.args
        : {};

      const result = await deviceService.sendDeviceCmd(logicalKey, { action, args });
      wx.hideLoading();
      if (result.success) {
        wx.showToast({ title: 'Sent' });
      } else {
        wx.showToast({ title: 'Send failed', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: 'Request failed', icon: 'none' });
    }
  }
});
