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
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  async loadPlantOptions() {
    const buildOptions = (plants) => plantService.buildPlantOptions(plants);

    try {
      const cachedPlants = plantService.getCachedPlants();
      if (cachedPlants.length > 0) {
        this.setData({
          plantOptions: buildOptions(cachedPlants),
          plantTypeIndex: 0
        });
      }

      const result = await plantService.getPlants({ useCache: true });
      this.setData({
        plantOptions: buildOptions(result?.plants),
        plantTypeIndex: 0
      });
    } catch (err) {
      console.warn('[device] loadPlantOptions failed, use fallback:', err);
      this.setData({
        plantOptions: FALLBACK_PLANT_OPTIONS,
        plantTypeIndex: 0
      });
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
      return wx.showToast({ title: '请输入设备唯一编码', icon: 'none' });
    }

    wx.showLoading({ title: '绑定中...' });
    try {
      const result = await deviceService.bindDeviceWithProfile({
        deviceCode: this.data.deviceCode,
        alias: this.data.alias,
        location: this.data.location,
        plantType: this.data.plantOptions[this.data.plantTypeIndex] || '其他'
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
    if (!logicalKey) return wx.showToast({ title: '设备标识缺失', icon: 'none' });
    if (!rawInput) return wx.showToast({ title: '请输入命令', icon: 'none' });

    wx.showLoading({ title: '发送中...' });
    try {
      let params;
      try {
        params = JSON.parse(rawInput);
      } catch (err) {
        wx.hideLoading();
        return wx.showToast({ title: '请输入正确 JSON 对象', icon: 'none' });
      }

      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        wx.hideLoading();
        return wx.showToast({ title: '请输入正确 JSON 对象', icon: 'none' });
      }

      const result = await deviceService.sendDeviceCmd(logicalKey, params);
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
