const app = getApp();
const deviceService = require('../../services/modules/DeviceService');
const alertService = require('../../services/modules/AlertService');
const themeBehavior = require('../../services/modules/ThemeBehavior');

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
  { key: 'light_val', label: '光照强度', unit: 'lx' }
];

// 舒适区间阈值：低于 min / 高于 max 判为异常
const METRIC_RANGES = {
  soil_percent: { min: 20, max: 80, low: '偏干', high: '偏湿', lowAdvice: '土壤偏干，建议适量浇水', highAdvice: '土壤偏湿，建议暂停浇水并保持通风' },
  dht_temp: { min: 10, max: 35, low: '偏冷', high: '偏热', lowAdvice: '环境温度偏低，建议移到温暖处', highAdvice: '环境温度偏高，建议通风降温' },
  dht_humi: { min: 30, max: 80, low: '偏干', high: '偏潮', lowAdvice: '空气偏干，建议向叶面喷雾加湿', highAdvice: '空气偏潮，建议加强通风' },
  light_val: { min: 200, max: 20000, low: '偏暗', high: '偏强', lowAdvice: '光照偏暗，建议移到明亮处', highAdvice: '光照偏强，建议中午适当遮阴' }
};

const DEFAULT_EXTRA_INFO = {
  isDead: '--',
  soulState: '--',
  favorability: '--',
  personality: '--',
  reportedPlantType: '--',
  irStatus: null
};

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

function normalizeBooleanMetric(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === '1') return true;
  if (raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', 'yes', 'dead', '死亡'].includes(value)) return true;
    if (['false', 'no', 'alive', '存活'].includes(value)) return false;
  }
  return null;
}

function formatDeadMetric(raw) {
  const value = normalizeBooleanMetric(raw);
  if (value === null) return '--';
  return value ? '是' : '否';
}

function formatSoulStateByIr(raw) {
  const value = normalizeBooleanMetric(raw);
  if (value === null) return '--';
  return value ? '没出窍' : '出窍';
}

Page({
  behaviors: [themeBehavior],

  _refreshTimer: null,
  _canvasW: 0,
  _canvasH: 0,
  _historyRows: [],

  data: {
    logicalKey: '',
    loading: true,
    device: null,
    extraInfo: { ...DEFAULT_EXTRA_INFO },
    metricTabs: [],
    checkupStamp: '待检测',
    checkupAdvice: '暂无传感器数据，等待设备上报后再做体检判定。',
    hasTrendData: false,
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
    this.setData({
      statusBarHeight: this.getHeaderTop(),
      theme: app.globalData.theme || 'light',
      logicalKey: logicalKey || ''
    });

    const bootstrap = deviceService.consumeDeviceDetailBootstrap(logicalKey);
    if (bootstrap) {
      this.applyDevicePayload(bootstrap);
      this.setData({ loading: false });
      this.loadTrendData({ silent: true });
      return;
    }

    wx.showLoading({ title: '加载中...', mask: true });
    this.loadDeviceBase();
  },

  onShow() {
    this.syncTheme();
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
    wx.hideLoading();
  },

  getHistoryRequestOptions() {
    const optionMap = {
      day: { historyGranularity: '5m', historyRange: '24h', historyLimit: 288 },
      week: { historyGranularity: '1h', historyRange: '7d', historyLimit: 168 },
      month: { historyGranularity: '1d', historyRange: '30d', historyLimit: 30 }
    };
    const current = optionMap[this.data.rangeKey] || optionMap.day;
    return {
      ...current,
      historyParamKey: this.data.selectedMetricKey
    };
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      this.loadDeviceBase({ silent: true });
    }, 3000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  applyDevicePayload(result) {
    const row = (result?.deviceData || [])[0] || null;
    if (!row) return false;
    const params = row.params || {};

    const metricTabs = METRIC_DEFS.map((def) => {
      const node = params[def.key];
      const rawValue = node ? node.value : null;
      const range = METRIC_RANGES[def.key];
      const num = parseMetricValue(rawValue, def.key);

      let status = 'na';
      let statusText = '无数据';
      let adviceText = '';
      if (num !== null && range) {
        if (num < range.min) {
          status = 'warn';
          statusText = range.low;
          adviceText = range.lowAdvice;
        } else if (num > range.max) {
          status = 'warn';
          statusText = range.high;
          adviceText = range.highAdvice;
        } else {
          status = 'ok';
          statusText = '正常';
        }
      }

      return {
        ...def,
        value: formatMetricValue(rawValue, def.key),
        status,
        statusText,
        adviceText,
        active: def.key === this.data.selectedMetricKey
      };
    });

    // 体检综合判定：有异常 → 待复查；无任何数据 → 待检测；否则体检合格
    const abnormal = metricTabs.filter((item) => item.status === 'warn');
    const measured = metricTabs.filter((item) => item.status !== 'na');
    let checkupStamp = '体检合格';
    let checkupAdvice = '各项指标均在舒适区间，继续保持。';
    if (!measured.length) {
      checkupStamp = '待检测';
      checkupAdvice = '暂无传感器数据，等待设备上报后再做体检判定。';
    } else if (abnormal.length) {
      checkupStamp = '待复查';
      checkupAdvice = `${abnormal.map((item) => item.adviceText).join('；')}。`;
    }

    const extraInfo = {
      isDead: formatDeadMetric(params.is_dead && typeof params.is_dead === 'object' ? params.is_dead.value : params.is_dead),
      soulState: formatSoulStateByIr(params.ir_status && typeof params.ir_status === 'object' ? params.ir_status.value : params.ir_status),
      favorability: formatMetricValue((params.favorability || params.favor || params.affinity || params.likability || params.haogandu || {}).value, 'text'),
      personality: formatMetricValue((params.plant_personality || params.personality || params.character || {}).value, 'text'),
      reportedPlantType: formatMetricValue((params.plant_type || params.ptype || {}).value || row.plantType, 'text'),
      irStatus: normalizeBooleanMetric(params.ir_status && typeof params.ir_status === 'object' ? params.ir_status.value : params.ir_status)
    };

    this.setData({
      device: {
        logicalKey: row.logicalKey,
        alias: row.alias || row.deviceName || '未命名设备',
        location: row.location || '未设置地点',
        plantType: row.plantType || '其他',
        online: !alertService.isDeviceOffline(row),
        image: PLANT_IMAGE_MAP[row.plantType || '其他'] || PLANT_IMAGE_MAP.其他
      },
      extraInfo,
      metricTabs,
      checkupStamp,
      checkupAdvice
    });

    return true;
  },

  async loadDeviceBase(options = {}) {
    const { silent = false } = options;
    const logicalKey = this.data.logicalKey;
    if (!logicalKey) return;

    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const result = await deviceService.getDeviceData({
        logicalKey,
        withHistory: false
      });

      const ok = this.applyDevicePayload(result);
      if (!ok) {
        throw new Error('device not found');
      }

      wx.hideLoading();
      this.loadTrendData({ silent: true });
    } catch (err) {
      console.error('[deviceDetail] loadDeviceBase error:', err);
      if (!silent && !this.data.device) {
        wx.hideLoading();
        wx.showToast({ title: '加载失败，请稍后再试', icon: 'none' });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 400);
      }
    } finally {
      if (!silent) {
        this.setData({ loading: false });
      }
    }
  },

  async loadTrendData(options = {}) {
    const { silent = false } = options;
    const logicalKey = this.data.logicalKey;
    if (!logicalKey) return;

    try {
      const result = await deviceService.getDeviceData({
        logicalKey,
        withHistory: true,
        ...this.getHistoryRequestOptions()
      });

      this._historyRows = Array.isArray(result?.historyData) ? result.historyData : [];
      this.refreshTrend();
    } catch (err) {
      console.warn('[deviceDetail] loadTrendData skipped:', err);
      this._historyRows = [];
      this.setData({
        hasTrendData: false,
        trendMin: '--',
        trendAvg: '--',
        trendMax: '--',
        trendTip: '暂无历史数据'
      });
      this.drawChart([]);
      if (!silent) {
        wx.hideLoading();
      }
    }
  },

  onMetricTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedMetricKey) return;

    this.setData({
      selectedMetricKey: key,
      metricTabs: this.data.metricTabs.map((item) => ({
        ...item,
        active: item.key === key
      }))
    });

    wx.showLoading({ title: '加载中...', mask: true });
    this.loadTrendData({ silent: true }).finally(() => wx.hideLoading());
  },

  onRangeTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.rangeKey) return;

    this.setData({ rangeKey: key });
    wx.showLoading({ title: '加载中...', mask: true });
    this.loadTrendData({ silent: true }).finally(() => wx.hideLoading());
  },

  refreshTrend() {
    const rows = this._historyRows;
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
      .filter((item) => item && item.logicalKey === this.data.logicalKey && item.paramKey === key)
      .map((item) => {
        const rawValue = item.avg !== undefined && item.avg !== null ? item.avg : item.value;
        const value = parseMetricValue(rawValue, key);
        const ts = Number(item.bucketStart || item.time || item.receivedAt || 0);
        return Number.isFinite(value) && Number.isFinite(ts) ? { value, ts } : null;
      })
      .filter(Boolean)
      .filter((item) => item.ts >= startTs)
      .sort((a, b) => a.ts - b.ts);

    if (!points.length) {
      this.setData({
        hasTrendData: false,
        trendMin: '--',
        trendAvg: '--',
        trendMax: '--',
        trendTip: '暂无历史数据'
      });
      this.drawChart([]);
      return;
    }

    const values = points.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

    this.setData({
      hasTrendData: true,
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
      const left = 42;
      const right = w - 12;
      const top = 14;
      const bottom = h - 28;

      ctx.clearRect(0, 0, w, h);
      ctx.setFillStyle('#0a1112');
      ctx.fillRect(0, 0, w, h);

      const gridCount = 4;
      ctx.setStrokeStyle('rgba(57, 255, 136, 0.08)');
      ctx.setLineWidth(1);
      for (let i = 0; i <= gridCount; i += 1) {
        const y = top + ((bottom - top) / gridCount) * i;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }

      if (!points.length) {
        ctx.setFillStyle('#86a892');
        ctx.setFontSize(13);
        ctx.setTextAlign('center');
        ctx.fillText('暂无历史数据', w / 2, h / 2);
        ctx.draw();
        return;
      }

      const minTs = points[0].ts;
      const maxTs = points[points.length - 1].ts;
      const rawMin = Math.min(...points.map((item) => item.value));
      const rawMax = Math.max(...points.map((item) => item.value));
      const tsSpan = Math.max(1, maxTs - minTs);
      const valPadding = (rawMax - rawMin) * 0.1 || 1;
      const minVal = rawMin - valPadding;
      const maxVal = rawMax + valPadding;
      const valSpan = Math.max(0.001, maxVal - minVal);

      const mapX = (ts) => left + ((ts - minTs) / tsSpan) * (right - left);
      const mapY = (value) => bottom - ((value - minVal) / valSpan) * (bottom - top);

      ctx.setFillStyle('#86a892');
      ctx.setFontSize(10);
      ctx.setTextAlign('right');
      for (let i = 0; i <= gridCount; i += 1) {
        const value = minVal + (valSpan / gridCount) * (gridCount - i);
        const y = top + ((bottom - top) / gridCount) * i;
        ctx.fillText(value.toFixed(1), left - 4, y + 4);
      }

      ctx.setTextAlign('center');
      [points[0].ts, points[Math.floor(points.length / 2)].ts, points[points.length - 1].ts].forEach((ts) => {
        const d = new Date(ts);
        const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        ctx.fillText(label, mapX(ts), bottom + 18);
      });

      ctx.setFillStyle('rgba(57, 255, 136, 0.12)');
      ctx.beginPath();
      ctx.moveTo(mapX(points[0].ts), bottom);
      points.forEach((item) => {
        ctx.lineTo(mapX(item.ts), mapY(item.value));
      });
      ctx.lineTo(mapX(points[points.length - 1].ts), bottom);
      ctx.closePath();
      ctx.fill();

      ctx.setStrokeStyle('#39ff88');
      ctx.setLineWidth(2.5);
      ctx.setLineCap('round');
      ctx.setLineJoin('round');
      ctx.beginPath();
      points.forEach((item, index) => {
        const x = mapX(item.ts);
        const y = mapY(item.value);
        if (index === 0) {
          ctx.moveTo(x, y);
          return;
        }
        const prev = points[index - 1];
        const px = mapX(prev.ts);
        const py = mapY(prev.value);
        const cp1x = px + (x - px) / 3;
        const cp2x = x - (x - px) / 3;
        ctx.bezierCurveTo(cp1x, py, cp2x, y, x, y);
      });
      ctx.stroke();

      if (points.length <= 30) {
        ctx.setFillStyle('#39ff88');
        points.forEach((item) => {
          ctx.beginPath();
          ctx.arc(mapX(item.ts), mapY(item.value), 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }

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
  },

  goPlantJournal() {
    const logicalKey = this.data.logicalKey;
    if (!logicalKey) return;
    wx.navigateTo({
      url: `/pages/plantJournal/plantJournal?logicalKey=${encodeURIComponent(logicalKey)}`
    });
  }
});
