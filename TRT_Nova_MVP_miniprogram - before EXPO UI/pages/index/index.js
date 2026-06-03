const app = getApp();
const todoService = require('../../services/modules/TodoService');
const deviceService = require('../../services/modules/DeviceService');
const weatherService = require('../../services/modules/WeatherService');
const alertService = require('../../services/modules/AlertService');
const { computeBubbles, computeMoodEmoji } = require('../../services/config/thresholds');

const DEFAULT_PLANT_IMAGE = '/images/plant-default.jpg';

const DEFAULT_SENSORS = {
  temp: { value: '--', unit: '℃', label: '环境温度' },
  light: { value: '--', unit: 'lx', label: '环境光照' },
  humidity: { value: '--', unit: '%', label: '环境湿度' },
  soil: { value: '--', unit: '%', label: '土壤湿度' }
};

const DEFAULT_EXTRA = {
  uid: '--',
  runState: null,
  irStatus: null,
  dsbTemp: '--',
  isDead: null,
  soulState: '--',
  favorability: '--',
  personality: '--',
  reportedPlantType: '--',
  updatedAt: '--'
};

const DEFAULT_FAN = {
  name: '通风风扇',
  icon: '🌬️',
  isOn: false,
  pending: false,
  hasReportedState: false,
  statusText: '暂无上报',
  hintText: '以设备最新上报为准'
};

function cloneSensors() {
  return JSON.parse(JSON.stringify(DEFAULT_SENSORS));
}

function cloneExtra() {
  return { ...DEFAULT_EXTRA };
}

function buildDefaultWeather() {
  return { icon: '🌤️', temp: '--', desc: '' };
}

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function buildDeviceMeta(item = {}) {
  const plantType = String(item.plantType || item?.plant?.name || '').trim();
  const location = String(item.location || '').trim();
  return {
    plantType,
    location,
    summary: [plantType, location].filter(Boolean).join(' · ') || '未设置植物种类与地点'
  };
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

function normalizeDisplayMetric(raw, fallback = '--') {
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw);
}

function formatSoulStateByIr(raw) {
  const normalized = normalizeBooleanMetric(raw);
  if (normalized === true) return '没出窍';
  if (normalized === false) return '出窍';
  return '--';
}

Page({
  _refreshTimer: null,
  _loadingDevices: false,
  _deviceRows: [],
  _redirectingToLogin: false,

  data: {
    statusBarHeight: 20,
    plantName: '未选择设备',
    plantMeta: '未设置植物种类与地点',
    plantImageSource: '',
    plantImage: DEFAULT_PLANT_IMAGE,
    dialogue: '主人，我现在状态很好，继续保持哦。',
    todos: [],
    devices: [],
    selectedLogicalKey: '',
    sensors: cloneSensors(),
    extraMetrics: cloneExtra(),
    fan: { ...DEFAULT_FAN },
    weather: buildDefaultWeather(),
    bubbles: [],
    moodEmoji: '😊',
    hasDevices: false
  },

  onLoad() {
    this.setData({ statusBarHeight: getStatusBarHeight() });
    this.resolvePlantImage();
    this.checkLoginStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadDevices({ refreshTodos: true });
    this.loadWeather();
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
      if (!this._redirectingToLogin) {
        this._redirectingToLogin = true;
        setTimeout(() => app.gotoLoginPage(), 80);
      }
      return false;
    }
    this._redirectingToLogin = false;
    return true;
  },

  async loadWeather() {
    try {
      const weather = await weatherService.getCurrentWeather();
      this.setData({ weather: weather || buildDefaultWeather() });
    } catch (err) {
      console.warn('[index] loadWeather error:', err);
    }
  },

  async resolveAnySource(source) {
    const src = typeof source === 'string' ? source.trim() : '';
    if (!src) return '';
    if (!src.startsWith('cloud://')) {
      return src;
    }
    if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      return '';
    }

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [src] });
      const first = res && res.fileList ? res.fileList[0] : null;
      const ok = first && (first.status === 0 || first.status === '0');
      return ok ? first.tempFileURL || '' : '';
    } catch (err) {
      console.error('[index] resolveAnySource error:', err);
      return '';
    }
  },

  async resolvePlantImage() {
    this._imageFallbackUsed = false;
    const primary = this.data.plantImageSource || this.data.plantImage || DEFAULT_PLANT_IMAGE;
    const primaryUrl = await this.resolveAnySource(primary);
    if (primaryUrl) {
      this.setData({ plantImage: primaryUrl });
      return;
    }
    const fallbackUrl = await this.resolveAnySource(DEFAULT_PLANT_IMAGE);
    // 两级都失败时设空字符串，避免再次触发 binderror 死循环
    this.setData({ plantImage: fallbackUrl || '' });
  },

  async onPlantImageError() {
    // 防止 fallback 本身也失败导致无限递归（App 模式本地路径可能不可用）
    if (this._imageFallbackUsed) return;
    this._imageFallbackUsed = true;
    const fallbackUrl = await this.resolveAnySource(DEFAULT_PLANT_IMAGE);
    this.setData({ plantImage: fallbackUrl || '' });
  },

  async loadTodos(logicalKey = '') {
    try {
      let todos = [];
      if (logicalKey) {
        const [deviceTodos, globalTodos] = await Promise.all([
          todoService.getTodos(logicalKey),
          todoService.getGlobalTodos()
        ]);
        todos = [...deviceTodos, ...globalTodos];
      } else {
        todos = await todoService.getGlobalTodos();
      }

      todos.sort((a, b) => {
        if (!!a.urgent === !!b.urgent) return 0;
        return a.urgent ? -1 : 1;
      });
      this.setData({ todos });
    } catch (error) {
      console.error('[index] loadTodos error:', error);
      this.setData({ todos: [] });
    }
  },

  async loadDevices(options = {}) {
    if (this._loadingDevices) return;
    this._loadingDevices = true;
    const { refreshTodos = false, silent = false } = options;

    try {
      const result = await deviceService.getDeviceData();
      const raw = Array.isArray(result && result.deviceData) ? result.deviceData : [];
      this._deviceRows = raw;

      const previousKey = this.data.selectedLogicalKey;
      const devices = raw.map((item) => ({
        ...buildDeviceMeta(item),
        _id: item.logicalKey || '',
        logicalKey: item.logicalKey || '',
        name: item.alias || item.deviceName || '未命名设备',
        status: alertService.isDeviceOffline(item) ? '离线' : '在线',
        icon: alertService.isDeviceOffline(item) ? '📟' : '🪴',
        active: false
      }));

      let activeIndex = 0;
      if (previousKey) {
        const foundIndex = devices.findIndex((item) => item.logicalKey === previousKey);
        if (foundIndex >= 0) activeIndex = foundIndex;
      }
      if (devices.length > 0) {
        devices[activeIndex].active = true;
      }

      const selected = devices[activeIndex] || null;
      const selectedLogicalKey = selected ? selected.logicalKey : '';

      this.setData({
        devices,
        selectedLogicalKey,
        plantName: selected ? selected.name : '未选择设备',
        plantMeta: selected ? selected.summary : '未设置植物种类与地点',
        hasDevices: devices.length > 0
      });

      if (!raw.length) {
        this.resetTelemetryDefaults();
        this.resetDeviceControlDefaults();
        if (refreshTodos) {
          await this.loadTodos('');
        }
      } else {
        this.applyLatestParams(raw, selectedLogicalKey);
        if (refreshTodos) {
          await this.loadTodos(selectedLogicalKey);
        }

        const offlineAlerts = alertService.checkDeviceOffline(raw);
        if (offlineAlerts.length) {
          alertService.showOfflineAlerts(offlineAlerts);
        }
      }
    } catch (error) {
      console.error('[index] loadDevices error:', error);
      const authExpired = app.isAuthError && app.isAuthError(error);
      if (authExpired || !app.globalData.hasLogin) {
        this.stopAutoRefresh();
      }
      this._deviceRows = [];
      this.setData({
        devices: [],
        selectedLogicalKey: '',
        plantName: '未选择设备',
        plantMeta: '未设置植物种类与地点',
        todos: [],
        hasDevices: false
      });
      this.resetTelemetryDefaults();
      this.resetDeviceControlDefaults();
      if (authExpired || !app.globalData.hasLogin) {
        return;
      }
      wx.showToast({
        title: '设备加载失败',
        icon: 'none',
        duration: 2500
      });
    } finally {
      this._loadingDevices = false;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      if (!this.checkLoginStatus()) return;
      this.loadDevices({ refreshTodos: false, silent: true });
    }, 60000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  resetTelemetryDefaults() {
    this.setData({
      sensors: cloneSensors(),
      extraMetrics: cloneExtra(),
      bubbles: [],
      moodEmoji: '😊'
    });
  },

  resetDeviceControlDefaults() {
    this.setData({
      fan: { ...DEFAULT_FAN }
    });
  },

  formatTs(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return '--';

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '--';

    const pad = (part) => String(part).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  },

  applyLatestParams(deviceRows, selectedLogicalKey = '') {
    if (!Array.isArray(deviceRows) || deviceRows.length === 0) {
      this.resetTelemetryDefaults();
      this.resetDeviceControlDefaults();
      return;
    }

    const selected =
      deviceRows.find((item) => item && item.logicalKey === selectedLogicalKey) ||
      deviceRows.find((item) => item && !alertService.isDeviceOffline(item) && item.params) ||
      deviceRows[0];

    const params = selected && selected.params ? selected.params : {};

    const getNode = (keys) => {
      for (const key of keys) {
        const node = params[key];
        if (
          node &&
          typeof node === 'object' &&
          node.value !== undefined &&
          node.value !== null &&
          node.value !== ''
        ) {
          return node;
        }
      }
      return null;
    };

    const getBooleanValue = (node) => {
      if (typeof node === 'boolean') return node;
      if (node && typeof node === 'object' && typeof node.value === 'boolean') {
        return node.value;
      }
      return null;
    };

    const getNodeTime = (node) => {
      if (node && typeof node === 'object' && node.time) {
        return this.formatTs(node.time);
      }
      return null;
    };

    const tempNode = getNode(['dht_temp', 'temp', 'temperature', 'air_temp']);
    const humidityNode = getNode(['dht_humi', 'humidity', 'air_humidity']);
    const lightNode = getNode(['light_val', 'light', 'illuminance', 'lux']);
    const soilNode = getNode(['soil_percent', 'soil', 'soil_moisture']);
    const uidNode = getNode(['uid']);
    const dsbTempNode = getNode(['dsb_temp']);
    const runStateNode = params.run_state || null;
    const irStatusNode = params.ir_status || null;
    const isDeadNode = params.is_dead || null;
    const favorabilityNode = getNode(['favorability', 'favor', 'affinity', 'likability', 'haogandu']);
    const personalityNode = getNode(['plant_personality', 'personality', 'character']);
    const plantTypeNode = getNode(['plant_type', 'ptype']);
    const fanNode = params.fan_switch || params.test || null;

    const sensors = cloneSensors();
    const extraMetrics = cloneExtra();
    extraMetrics.reportedPlantType = selected?.plantType || selected?.plant?.name || '--';

    if (tempNode) sensors.temp.value = String(tempNode.value);
    if (humidityNode) sensors.humidity.value = String(humidityNode.value);
    if (lightNode) sensors.light.value = String(lightNode.value);
    if (soilNode) sensors.soil.value = String(soilNode.value);
    if (uidNode) extraMetrics.uid = String(uidNode.value);
    if (dsbTempNode) extraMetrics.dsbTemp = String(dsbTempNode.value);
    const runStateValue = getBooleanValue(runStateNode);
    const irStatusValue = getBooleanValue(irStatusNode);
    const isDeadValue = normalizeBooleanMetric(isDeadNode && typeof isDeadNode === 'object' ? isDeadNode.value : isDeadNode);
    if (runStateValue !== null) extraMetrics.runState = runStateValue;
    if (irStatusValue !== null) {
      extraMetrics.irStatus = irStatusValue;
      extraMetrics.soulState = formatSoulStateByIr(irStatusValue);
    }
    if (isDeadValue !== null) extraMetrics.isDead = isDeadValue;
    if (favorabilityNode) extraMetrics.favorability = normalizeDisplayMetric(favorabilityNode.value);
    if (personalityNode) extraMetrics.personality = normalizeDisplayMetric(personalityNode.value);
    if (plantTypeNode) extraMetrics.reportedPlantType = normalizeDisplayMetric(plantTypeNode.value);
    extraMetrics.updatedAt = selected && selected.updatedAt ? this.formatTs(selected.updatedAt) : '--';

    const fanReportedState = getBooleanValue(fanNode);
    const fanTime = getNodeTime(fanNode) || extraMetrics.updatedAt;
    const fan = {
      ...DEFAULT_FAN,
      isOn: fanReportedState === true,
      pending: false,
      hasReportedState: fanReportedState !== null,
      statusText: fanReportedState === null ? '暂无上报' : (fanReportedState ? '已开启' : '已关闭'),
      hintText: fanReportedState === null ? '等待设备上报风扇状态' : `最近同步 ${fanTime}`
    };

    const latestSensors = {
      temp: { value: sensors.temp.value },
      humidity: { value: sensors.humidity.value },
      light: { value: sensors.light.value },
      soil: { value: sensors.soil.value }
    };
    const bubbles = computeBubbles(latestSensors);
    const moodEmoji = computeMoodEmoji(latestSensors, extraMetrics);
    const warningBubble = bubbles.find((item) => item.type === 'warning');
    const dialogue = warningBubble
      ? `主人，${warningBubble.text}，请及时处理哦`
      : '主人，我现在状态很好，继续保持哦。';

    const resolvedFan = fanReportedState === null && this.data && this.data.fan && this.data.fan.hasReportedState
      ? {
          ...this.data.fan,
          pending: false,
          hintText: '命令已发送，等待设备状态同步'
        }
      : fan;

    this.setData({
      sensors,
      extraMetrics,
      fan: resolvedFan,
      bubbles,
      moodEmoji,
      dialogue
    });
  },

  addTodo() {
    if (!this.data.selectedLogicalKey) {
      wx.showToast({ title: '请先选择设备', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '添加待办',
      editable: true,
      placeholderText: '请输入任务内容',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await todoService.addTodo(res.content.trim(), this.data.selectedLogicalKey);
          await this.loadTodos(this.data.selectedLogicalKey);
          wx.showToast({ title: '添加成功', icon: 'success' });
        } catch (error) {
          console.error('[index] addTodo error:', error);
          wx.showToast({ title: '添加失败', icon: 'none' });
        }
      }
    });
  },

  async onTaskDone(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((item) => item._id === id || item.id === id);
    if (!todo) return;

    try {
      if (todo._id) {
        await todoService.completeTodo(todo._id, todo.logicalKey || this.data.selectedLogicalKey);
      }
      await this.loadTodos(this.data.selectedLogicalKey);
      wx.showToast({ title: '任务已完成', icon: 'success' });
    } catch (error) {
      console.error('[index] onTaskDone error:', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async toggleUrgency(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((item) => item._id === id || item.id === id);
    if (!todo || !todo._id) return;

    try {
      await todoService.toggleUrgency(todo, todo.logicalKey || this.data.selectedLogicalKey);
      await this.loadTodos(this.data.selectedLogicalKey);
      wx.showToast({ title: '优先级已更新', icon: 'none' });
    } catch (error) {
      console.error('[index] toggleUrgency error:', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  switchDevice(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const devices = this.data.devices.map((item, itemIndex) => ({
      ...item,
      active: itemIndex === index
    }));
    const selected = devices[index] || null;
    const selectedLogicalKey = selected ? selected.logicalKey : '';

    this.setData({
      devices,
      selectedLogicalKey,
      plantName: selected ? selected.name : '未选择设备',
      plantMeta: selected ? selected.summary : '未设置植物种类与地点'
    });

    this.applyLatestParams(this._deviceRows, selectedLogicalKey);
    this.loadTodos(selectedLogicalKey);
  },

  openDeviceDetail(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const selected = this.data.devices[index] || null;
    if (!selected || !selected.logicalKey) return;

    this.switchDevice(e);

    const bootstrapRow = Array.isArray(this._deviceRows)
      ? this._deviceRows.find((item) => item && item.logicalKey === selected.logicalKey)
      : null;

    if (bootstrapRow) {
      deviceService.setDeviceDetailBootstrap(selected.logicalKey, {
        deviceData: [bootstrapRow]
      });
    }

    wx.navigateTo({
      url: `/pages/deviceDetail/deviceDetail?logicalKey=${encodeURIComponent(selected.logicalKey)}`
    });
  },

  async refreshDeviceStatus() {
    if (!this.checkLoginStatus()) return;
    await this.loadDevices();
    wx.showToast({
      title: '设备状态已刷新',
      icon: 'none',
      duration: 1800
    });
  },

  toggleFan() {
    this.toggleFanCommand();
  },

  async toggleFanCommand() {
    const logicalKey = this.data.selectedLogicalKey;
    if (!logicalKey) {
      wx.showToast({ title: '请先选择设备', icon: 'none' });
      return;
    }

    if (this.data.fan.pending) {
      return;
    }

    const targetState = !this.data.fan.isOn;
    this.setData({
      'fan.pending': true,
      'fan.statusText': targetState ? '开启中...' : '关闭中...',
      'fan.hintText': '命令已发出，等待设备上报确认'
    });

    try {
      const result = await deviceService.sendDeviceCmd(logicalKey, {
        test: targetState
      });

      if (!result || result.success === false) {
        throw new Error((result && result.msg) || '风扇控制失败');
      }

      wx.showToast({
        title: targetState ? '已发送开启' : '已发送关闭',
        icon: 'success'
      });
      this.setData({
        'fan.pending': false,
        'fan.statusText': 'Command sent, waiting for device ack',
        'fan.hintText': 'State will update after the device reports back'
      });

      setTimeout(() => {
        this.loadDevices({ refreshTodos: false });
      }, 600);
    } catch (error) {
      console.error('[index] toggleFanCommand error:', error);
      this.setData({
        'fan.pending': false,
        'fan.statusText': this.data.fan.hasReportedState ? (this.data.fan.isOn ? '已开启' : '已关闭') : '暂无上报',
        'fan.hintText': (error && error.message) || '下发失败，请稍后重试'
      });
      wx.showToast({
        title: (error && error.message) || '风扇控制失败',
        icon: 'none'
      });
    }
  },

  async onPullDownRefresh() {
    await this.loadDevices();
    wx.stopPullDownRefresh();
  },

  goToDeviceManagement() {
    wx.navigateTo({ url: '/pages/device/device' });
  }
});
