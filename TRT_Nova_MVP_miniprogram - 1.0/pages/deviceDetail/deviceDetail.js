const deviceService = require('../../services/modules/DeviceService');

const PLANT_IMAGE_MAP = {
  龟背竹: 'https://images.unsplash.com/photo-1614594975525-e45190c55d0b?q=80&w=600&auto=format&fit=crop',
  绿萝: 'https://images.unsplash.com/photo-1593691509543-c55fb32e5e18?q=80&w=600&auto=format&fit=crop',
  多肉: 'https://images.unsplash.com/photo-1459156212016-c812468e2115?q=80&w=600&auto=format&fit=crop',
  薄荷: 'https://images.unsplash.com/photo-1628556270448-4d4e4148e3b1?q=80&w=600&auto=format&fit=crop',
  番茄: 'https://images.unsplash.com/photo-1592841200221-a6898f307baa?q=80&w=600&auto=format&fit=crop',
  其他: 'https://images.unsplash.com/photo-1512428813834-c702c7702b78?q=80&w=600&auto=format&fit=crop'
};

const METRIC_DEFS = [
  { key: 'soil_percent', label: '土壤湿度', unit: '%' },
  { key: 'dht_temp', label: '环境温度', unit: '℃' },
  { key: 'dht_humi', label: '环境湿度', unit: '%' },
  { key: 'light_val', label: '光照强度', unit: 'lx' },
  { key: 'dsb_temp', label: '探针温度', unit: '℃' },
  { key: 'run_state', label: '运行状态', unit: '' },
  { key: 'ir_status', label: '红外状态', unit: '' }
];

function parseMetricValue(raw, key) {
  if (key === 'run_state' || key === 'ir_status') {
    if (raw === true) return 1;
    if (raw === false) return 0;
    return null;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function formatMetricValue(raw, key) {
  if (key === 'run_state') return raw === true ? '运行中' : raw === false ? '已停止' : '--';
  if (key === 'ir_status') return raw === true ? '触发' : raw === false ? '正常' : '--';
  if (raw === null || raw === undefined || raw === '') return '--';
  return String(raw);
}

Page({
  _refreshTimer: null,
  _canvasW: 0,
  _canvasH: 0,
  _historyRows: [],

  data: {
    logicalKey: '',
    loading: true,
    device: null,
    metricTabs: [],
    selectedMetricKey: 'soil_percent',
    rangeKey: 'day',
    rangeOptions: [
      { key: 'day', label: '日' },
      { key: 'week', label: '周' },
      { key: 'month', label: '月' }
    ],
    trendMin: '--',
    trendAvg: '--',
    trendMax: '--',
    trendTip: '暂无历史数据'
  },

  onLoad(options) {
    const logicalKey = decodeURIComponent(options?.logicalKey || '');
    this.setData({ logicalKey: logicalKey || '' });
    this.loadAll({ withHistory: true });
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

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => this.loadAll({ withHistory: false, silent: true }), 3000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  async loadAll(options = {}) {
    const { withHistory = false, silent = false } = options;
    const logicalKey = this.data.logicalKey;
    if (!logicalKey) return;

    if (!silent) this.setData({ loading: true });
    try {
      const result = await deviceService.getDeviceData({
        logicalKey,
        withHistory,
        historyLimit: 300
      });
      const row = (result.deviceData || [])[0] || null;
      if (!row) {
        this.setData({
          device: null,
          metricTabs: [],
          trendTip: '设备不存在或未绑定'
        });
        return;
      }

      const metricTabs = METRIC_DEFS.map((def) => {
        const node = row.params?.[def.key];
        const rawValue = node ? node.value : null;
        return {
          ...def,
          value: formatMetricValue(rawValue, def.key),
          active: def.key === this.data.selectedMetricKey
        };
      });

      this.setData({
        device: {
          logicalKey: row.logicalKey,
          alias: row.alias || row.deviceName || '未命名设备',
          location: row.location || '未设置地点',
          plantType: row.plantType || '其他',
          online: !!row.hasLatest,
          image: PLANT_IMAGE_MAP[row.plantType || '其他'] || PLANT_IMAGE_MAP.其他
        },
        metricTabs
      });

      if (withHistory) {
        this._historyRows = result.historyData || [];
        this.refreshTrend();
      } else {
        this.refreshTrend({ skipHistoryUpdate: true });
      }
    } catch (err) {
      console.error(err);
      this.setData({ trendTip: '加载失败，请稍后重试' });
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  onMetricTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedMetricKey) return;
    this.setData({
      selectedMetricKey: key,
      metricTabs: this.data.metricTabs.map((x) => ({ ...x, active: x.key === key }))
    });
    this.refreshTrend();
  },

  onRangeTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.rangeKey) return;
    this.setData({ rangeKey: key });
    this.refreshTrend();
  },

  refreshTrend(options = {}) {
    const { skipHistoryUpdate = false } = options;
    const rows = skipHistoryUpdate ? this._historyRows : this._historyRows;
    const key = this.data.selectedMetricKey;
    const now = Date.now();
    const spanMap = {
      day: 24 * 3600 * 1000,
      week: 7 * 24 * 3600 * 1000,
      month: 30 * 24 * 3600 * 1000
    };
    const span = spanMap[this.data.rangeKey] || spanMap.day;
    const startTs = now - span;

    const points = (rows || [])
      .filter((x) => x && x.logicalKey === this.data.logicalKey && x.paramKey === key)
      .map((x) => {
        const value = parseMetricValue(x.value, key);
        const ts = Number(x.time || x.receivedAt || 0);
        return Number.isFinite(value) && Number.isFinite(ts) ? { value, ts } : null;
      })
      .filter(Boolean)
      .filter((x) => x.ts >= startTs)
      .sort((a, b) => a.ts - b.ts);

    if (!points.length) {
      this.setData({
        trendMin: '--',
        trendAvg: '--',
        trendMax: '--',
        trendTip: '该指标暂无历史数据'
      });
      this.drawChart([]);
      return;
    }

    const values = points.map((x) => x.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;

    this.setData({
      trendMin: min.toFixed(1),
      trendAvg: avg.toFixed(1),
      trendMax: max.toFixed(1),
      trendTip: `${points.length} 条数据`
    });
    this.drawChart(points);
  },

  ensureCanvasSize(callback) {
    if (this._canvasW > 0 && this._canvasH > 0) {
      callback();
      return;
    }
    wx.createSelectorQuery()
      .in(this)
      .select('#trendCanvas')
      .boundingClientRect((rect) => {
        this._canvasW = (rect && rect.width) || 320;
        this._canvasH = (rect && rect.height) || 180;
        callback();
      })
      .exec();
  },

  drawChart(points) {
    this.ensureCanvasSize(() => {
      const ctx = wx.createCanvasContext('trendCanvas', this);
      const w = this._canvasW;
      const h = this._canvasH;
      const left = 16;
      const right = w - 12;
      const top = 12;
      const bottom = h - 20;

      ctx.clearRect(0, 0, w, h);
      ctx.setFillStyle('#f8fafc');
      ctx.fillRect(0, 0, w, h);

      ctx.setStrokeStyle('#e5e7eb');
      ctx.setLineWidth(1);
      for (let i = 0; i < 4; i += 1) {
        const y = top + ((bottom - top) / 3) * i;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }

      if (!points.length) {
        ctx.draw();
        return;
      }

      const minTs = points[0].ts;
      const maxTs = points[points.length - 1].ts;
      const minVal = Math.min(...points.map((p) => p.value));
      const maxVal = Math.max(...points.map((p) => p.value));
      const tsSpan = Math.max(1, maxTs - minTs);
      const valSpan = Math.max(0.001, maxVal - minVal);

      const mapX = (ts) => left + ((ts - minTs) / tsSpan) * (right - left);
      const mapY = (v) => bottom - ((v - minVal) / valSpan) * (bottom - top);

      ctx.setStrokeStyle('#7da4d8');
      ctx.setLineWidth(2);
      ctx.beginPath();
      points.forEach((p, idx) => {
        const x = mapX(p.ts);
        const y = mapY(p.value);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.draw();
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goSettings() {
    const logicalKey = this.data.logicalKey;
    if (!logicalKey) return;
    wx.navigateTo({
      url: `/pages/deviceSettings/deviceSettings?logicalKey=${encodeURIComponent(logicalKey)}`
    });
  }
});
