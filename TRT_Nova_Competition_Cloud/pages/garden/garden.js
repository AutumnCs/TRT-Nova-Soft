const app = getApp();
const deviceService = require('../../services/modules/DeviceService');
const alertService = require('../../services/modules/AlertService');

const PLANT_IMAGE_MAP = {
  龟背竹: 'https://images.unsplash.com/photo-1614594975525-e45190c55d0b?q=80&w=600&auto=format&fit=crop',
  绿萝: 'https://images.unsplash.com/photo-1593691509543-c55fb32e5e18?q=80&w=600&auto=format&fit=crop',
  多肉: 'https://images.unsplash.com/photo-1459156212016-c812468e2115?q=80&w=600&auto=format&fit=crop',
  薄荷: 'https://images.unsplash.com/photo-1628556270448-4d4e4148e3b1?q=80&w=600&auto=format&fit=crop',
  番茄: 'https://images.unsplash.com/photo-1592841200221-a6898f307baa?q=80&w=600&auto=format&fit=crop',
  其他: 'https://images.unsplash.com/photo-1512428813834-c702c7702b78?q=80&w=600&auto=format&fit=crop'
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好';
  return '夜深了';
}

function toNumberParam(params, key) {
  if (!params || !params[key]) return null;
  const value = Number(params[key].value);
  return Number.isFinite(value) ? value : null;
}

function calcPlantStatus(params) {
  const soil = toNumberParam(params, 'soil_percent');
  if (soil === null) return { text: '等待上报', type: 'pending' };
  if (soil < 30) return { text: '需要浇水', type: 'warn' };
  if (soil > 85) return { text: '湿度偏高', type: 'warn' };
  return { text: '生长良好', type: 'good' };
}

function mapRowsToDevices(rows) {
  return rows.map((row) => {
    const plantType = row.plantType || '其他';
    const status = calcPlantStatus(row.params || {});
    const offline = alertService.isDeviceOffline(row);
    return {
      logicalKey: row.logicalKey,
      alias: row.alias || row.deviceName || '未命名设备',
      location: row.location || '未设置地点',
      plantType,
      image: PLANT_IMAGE_MAP[plantType] || PLANT_IMAGE_MAP.其他,
      online: !offline,
      statusText: status.text,
      statusType: status.type
    };
  });
}

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  _refreshTimer: null,
  _loading: false,
  _bootstrapRetryTimer: null,
  _bootstrapRetryCount: 0,

  data: {
    statusBarHeight: 20,
    devices: [],
    summaryText: '正在同步设备状态...',
    hasDevices: true
  },

  onLoad() {
    this._bootstrapRetryCount = 0;
    this.setData({ statusBarHeight: getStatusBarHeight() });
    this.loadDevices();
  },

  onShow() {
    this.loadDevices();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
    this.clearBootstrapRetry();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth/auth' });
      }, 100);
      return false;
    }
    return true;
  },

  goBackHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => this.loadDevices({ silent: true }), 5000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  clearBootstrapRetry() {
    if (!this._bootstrapRetryTimer) return;
    clearTimeout(this._bootstrapRetryTimer);
    this._bootstrapRetryTimer = null;
  },

  scheduleBootstrapRetry() {
    this.clearBootstrapRetry();
    this._bootstrapRetryTimer = setTimeout(() => {
      this.loadDevices();
    }, 1200);
  },

  async loadDevices(options = {}) {
    if (!this.checkLoginStatus() || this._loading) return;
    const { silent = false } = options;
    this._loading = true;
    if (!silent) wx.showLoading({ title: '加载中...' });

    try {
      const result = await deviceService.getDeviceData();
      const rows = Array.isArray(result?.deviceData) ? result.deviceData : [];
      const devices = mapRowsToDevices(rows);

      const greeting = getGreeting();
      const warnCount = devices.filter((item) => item.statusType === 'warn').length;

      this.setData({
        devices,
        hasDevices: devices.length > 0,
        summaryText: devices.length === 0
          ? `${greeting}，还没有绑定设备`
          : warnCount > 0
            ? `${greeting}，有 ${warnCount} 株植物需要关注`
            : `${greeting}，所有设备运行正常`
      });

      this.clearBootstrapRetry();
      this._bootstrapRetryCount = 0;
    } catch (err) {
      console.error('[garden] loadDevices failed:', err);
      const cachedRows = deviceService.getCachedDeviceList();
      const cachedDevices = mapRowsToDevices(cachedRows);

      if (cachedDevices.length > 0) {
        this.setData({
          devices: cachedDevices,
          hasDevices: true,
          summaryText: '设备同步慢了一点，已先展示缓存结果'
        });
        return;
      }

      if (!silent && this.data.devices.length === 0 && this._bootstrapRetryCount < 2) {
        this._bootstrapRetryCount += 1;
        this.setData({ summaryText: '设备同步慢了一点，正在重试...' });
        this.scheduleBootstrapRetry();
      } else {
        this.setData({
          hasDevices: this.data.devices.length > 0,
          summaryText: this.data.devices.length > 0
            ? '设备同步慢了一点，已先展示上次结果'
            : '加载慢了一点，稍后再试'
        });
      }
    } finally {
      if (!silent) wx.hideLoading();
      this._loading = false;
    }
  },

  onPullDownRefresh() {
    this.loadDevices().then(() => wx.stopPullDownRefresh());
  },

  openDeviceDetail(e) {
    const logicalKey = e.currentTarget.dataset.logicalkey;
    if (!logicalKey) return;

    wx.showLoading({ title: '加载中...', mask: true });
    deviceService.getDeviceData({
      logicalKey,
      withHistory: false
    })
      .then((result) => {
        const row = Array.isArray(result?.deviceData) ? result.deviceData[0] : null;
        if (!row) {
          wx.showToast({ title: '设备数据暂时不可用', icon: 'none' });
          return;
        }

        deviceService.setDeviceDetailBootstrap(logicalKey, result);
        wx.navigateTo({
          url: `/pages/deviceDetail/deviceDetail?logicalKey=${encodeURIComponent(logicalKey)}`
        });
      })
      .catch((err) => {
        console.error('[garden] openDeviceDetail error:', err);
        wx.showToast({ title: '加载失败，请稍后再试', icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  openDeviceManager() {
    wx.navigateTo({ url: '/pages/device/device' });
  }
});
