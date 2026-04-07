const app = getApp();
const deviceService = require('../../services/modules/DeviceService');

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
  if (h < 6)  return '夜深了';
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

Page({
  _refreshTimer: null,
  _loading: false,

  data: {
    statusBarHeight: 20,
    devices: [],
    summaryText: '正在同步设备状态...',
    hasDevices: true
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 });
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

  async loadDevices(options = {}) {
    if (!this.checkLoginStatus() || this._loading) return;
    const { silent = false } = options;
    this._loading = true;
    if (!silent) wx.showLoading({ title: '加载中...' });

    try {
      const result = await deviceService.getDeviceData();
      const rows = result.deviceData || [];
      const devices = rows.map((row) => {
        const plantType = row.plantType || '其他';
        const status = calcPlantStatus(row.params || {});
        return {
          logicalKey: row.logicalKey,
          alias: row.alias || row.deviceName || '未命名设备',
          location: row.location || '未设置地点',
          plantType,
          image: PLANT_IMAGE_MAP[plantType] || PLANT_IMAGE_MAP['其他'],
          online: !!row.hasLatest,
          statusText: status.text,
          statusType: status.type
        };
      });

      const greeting = getGreeting();
      const warnCount = devices.filter((item) => item.statusType === 'warn').length;
      this.setData({
        devices,
        hasDevices: devices.length > 0,
        summaryText: devices.length === 0
          ? `${greeting}，还没有绑定设备`
          : warnCount > 0
            ? `${greeting}，有 ${warnCount} 株植物需要关注 🌿`
            : `${greeting}，所有设备运行正常 ✓`
      });
    } catch (err) {
      console.error('loadDevices failed:', err);
      this.setData({
        devices: [],
        hasDevices: false,
        summaryText: '加载失败，请下拉刷新重试'
      });
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
    wx.navigateTo({
      url: `/pages/deviceDetail/deviceDetail?logicalKey=${encodeURIComponent(logicalKey)}`
    });
  },

  openDeviceManager() {
    wx.navigateTo({ url: '/pages/device/device' });
  }
});
