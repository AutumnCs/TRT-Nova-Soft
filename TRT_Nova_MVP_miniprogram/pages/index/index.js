const app = getApp();
const todoService = require('../../services/modules/TodoService');
const deviceService = require('../../services/modules/DeviceService');
const weatherService = require('../../services/modules/WeatherService');
const alertService = require('../../services/modules/AlertService');
const { computeBubbles, computeMoodEmoji } = require('../../services/config/thresholds');

const DEFAULT_PLANT_IMAGE = '/images/plant-default.jpg';

// 植物类型 → 设备图标 emoji 映射
const PLANT_ICON_MAP = {
  '龟背竹': '🌿',
  '绿萝': '🍃',
  '多肉': '🌵',
  '薄荷': '🌱',
  '番茄': '🍅',
  '玫瑰': '🌹',
  '向日葵': '🌻',
  '兰花': '🌸',
  '仙人掌': '🌵',
  '其他': '🪴'
};

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
  updatedAt: '--'
};

Page({
  _refreshTimer: null,
  _loadingDevices: false,
  _deviceRows: [],

  data: {
    statusBarHeight: 20,
    plantName: '未选择设备',
    plantImageSource: '',
    plantImage: DEFAULT_PLANT_IMAGE,
    dialogue: '主人，记得给我按时浇水哦。',
    todos: [],
    devices: [],
    selectedLogicalKey: '',
    sensors: { ...DEFAULT_SENSORS },
    extraMetrics: { ...DEFAULT_EXTRA },
    fan: {
      name: '通风风扇',
      icon: '🌬️',
      isOn: false
    },
    // 天气
    weather: { icon: '🌤️', temp: '--', desc: '' },
    // 气泡（由阈值计算，最多 2 条）
    bubbles: [],
    // 心情 emoji
    moodEmoji: '😊',
    // 是否有设备
    hasDevices: false
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    this.resolvePlantImage();
    this.checkLoginStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadDevices();
    this.loadWeather(); // fire-and-forget，不 await，不阻塞主流程
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
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  // ── 天气 ────────────────────────────────────────────────

  async loadWeather() {
    try {
      const weather = await weatherService.getCurrentWeather();
      this.setData({ weather });
    } catch (err) {
      // WeatherService 内部已有兜底，这里静默处理
      console.warn('[index] loadWeather error:', err);
    }
  },

  // ── 植物图片 ────────────────────────────────────────────

  async resolveAnySource(source) {
    const src = (source || '').trim();
    if (!src) return '';
    if (src.startsWith('cloud://')) {
      if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') return '';
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: [src] });
        const first = res?.fileList?.[0];
        const ok = first && (first.status === 0 || first.status === '0');
        return ok ? first.tempFileURL || '' : '';
      } catch (err) {
        console.error('resolveAnySource failed:', err);
        return '';
      }
    }
    return src;
  },

  async resolvePlantImage() {
    const primary =
      (this.data.plantImageSource || '').trim() ||
      (typeof this.data.plantImage === 'string' ? this.data.plantImage.trim() : '');
    const primaryUrl = await this.resolveAnySource(primary);
    if (primaryUrl) {
      this.setData({ plantImage: primaryUrl });
      return;
    }
    const fallbackUrl = await this.resolveAnySource(DEFAULT_PLANT_IMAGE);
    this.setData({ plantImage: fallbackUrl || DEFAULT_PLANT_IMAGE });
  },

  async onPlantImageError() {
    const fallbackUrl = await this.resolveAnySource(DEFAULT_PLANT_IMAGE);
    this.setData({ plantImage: fallbackUrl || DEFAULT_PLANT_IMAGE });
  },

  // ── Todos ───────────────────────────────────────────────

  async loadTodos(logicalKey = '') {
    try {
      let todos = [];
      if (logicalKey) {
        // 合并设备专属 todo + wiki 全局养护提醒
        const [deviceTodos, globalTodos] = await Promise.all([
          todoService.getTodos(logicalKey),
          todoService.getGlobalTodos()
        ]);
        todos = [...deviceTodos, ...globalTodos];
      } else {
        // 无设备时只展示全局养护提醒
        todos = await todoService.getGlobalTodos();
      }
      todos.sort((a, b) => (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));
      this.setData({ todos });
    } catch (error) {
      console.error('[index] loadTodos error:', error);
      this.setData({ todos: [] });
    }
  },

  // ── 设备加载 ────────────────────────────────────────────

  async loadDevices() {
    if (this._loadingDevices) return;
    this._loadingDevices = true;
    try {
      const result = await deviceService.getDeviceData();
      const raw = result.deviceData || [];
      this._deviceRows = raw;
      const prevSelected = this.data.selectedLogicalKey;

      const mapped = raw.map((item) => ({
        _id: item.logicalKey || '',
        logicalKey: item.logicalKey || '',
        name: item.alias || item.deviceName || '未命名设备',
        status: item.hasLatest ? '在线' : '离线',
        // 根据植物类型选择图标
        icon: PLANT_ICON_MAP[item.plantType] || PLANT_ICON_MAP['其他'],
        active: false
      }));

      let activeIndex = 0;
      if (prevSelected) {
        const found = mapped.findIndex((x) => x.logicalKey === prevSelected);
        activeIndex = found >= 0 ? found : 0;
      }
      if (mapped.length > 0) mapped[activeIndex].active = true;

      const selected = mapped[activeIndex];
      const selectedLogicalKey = selected ? selected.logicalKey : '';
      const selectedAlias = selected ? selected.name : '未选择设备';

      this.setData({
        devices: mapped,
        selectedLogicalKey,
        plantName: selectedAlias,
        hasDevices: mapped.length > 0
      });

      if (!raw.length) {
        this.resetTelemetryDefaults();
        await this.loadTodos('');
      } else {
        this.applyLatestParams(raw, selectedLogicalKey);
        await this.loadTodos(selectedLogicalKey);
        // 检查设备离线告警
        const offlineAlerts = alertService.checkDeviceOffline(raw);
        if (offlineAlerts.length) {
          alertService.showOfflineAlerts(offlineAlerts);
        }
      }
    } catch (error) {
      console.error('[index] loadDevices error:', error);
      this._deviceRows = [];
      this.setData({
        devices: [],
        selectedLogicalKey: '',
        plantName: '未选择设备',
        todos: [],
        hasDevices: false
      });
      this.resetTelemetryDefaults();
      wx.showToast({
        title: '设备加载失败，请检查网络',
        icon: 'none',
        duration: 2500
      });
    } finally {
      this._loadingDevices = false;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    // 5s 轮询，给上一次请求足够的完成时间（网络超时 8s）
    this._refreshTimer = setInterval(() => {
      if (!this.checkLoginStatus()) return;
      this.loadDevices();
    }, 5000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  resetTelemetryDefaults() {
    this.setData({
      sensors: { ...DEFAULT_SENSORS },
      extraMetrics: { ...DEFAULT_EXTRA },
      bubbles: [],
      moodEmoji: '😊'
    });
  },

  applyLatestParams(deviceRows, selectedLogicalKey = '') {
    if (!Array.isArray(deviceRows) || deviceRows.length === 0) return;
    const selected =
      deviceRows.find((d) => d && d.logicalKey === selectedLogicalKey) ||
      deviceRows.find((d) => d && d.hasLatest && d.params) ||
      deviceRows[0];
    const params = selected && selected.params ? selected.params : {};

    const getValue = (keys) => {
      for (const key of keys) {
        const node = params[key];
        if (node && node.value !== undefined && node.value !== null && node.value !== '') {
          return String(node.value);
        }
      }
      return null;
    };

    const temp = getValue(['dht_temp', 'temp', 'temperature', 'air_temp']);
    const humidity = getValue(['dht_humi', 'humidity', 'air_humidity']);
    const light = getValue(['light_val', 'light', 'illuminance', 'lux']);
    const soil = getValue(['soil_percent', 'soil', 'soil_moisture']);
    const uid = getValue(['uid']);
    const dsbTemp = getValue(['dsb_temp']);

    const runStateNode = params.run_state;
    const irStatusNode = params.ir_status;

    const patch = {};
    if (temp !== null) patch['sensors.temp.value'] = temp;
    if (humidity !== null) patch['sensors.humidity.value'] = humidity;
    if (light !== null) patch['sensors.light.value'] = light;
    if (soil !== null) patch['sensors.soil.value'] = soil;
    if (uid !== null) patch['extraMetrics.uid'] = uid;
    if (dsbTemp !== null) patch['extraMetrics.dsbTemp'] = dsbTemp;
    if (runStateNode && typeof runStateNode.value === 'boolean') patch['extraMetrics.runState'] = runStateNode.value;
    if (irStatusNode && typeof irStatusNode.value === 'boolean') patch['extraMetrics.irStatus'] = irStatusNode.value;
    if (selected && selected.updatedAt) patch['extraMetrics.updatedAt'] = this.formatTs(selected.updatedAt);

    if (Object.keys(patch).length > 0) this.setData(patch);

    // 计算气泡 & 心情（用 patch 后的最新 sensors 值）
    const latestSensors = {
      temp: { value: patch['sensors.temp.value'] ?? this.data.sensors.temp.value },
      humidity: { value: patch['sensors.humidity.value'] ?? this.data.sensors.humidity.value },
      light: { value: patch['sensors.light.value'] ?? this.data.sensors.light.value },
      soil: { value: patch['sensors.soil.value'] ?? this.data.sensors.soil.value }
    };
    const bubbles = computeBubbles(latestSensors);
    const moodEmoji = computeMoodEmoji(latestSensors);
    this.setData({ bubbles, moodEmoji });

    // 同步 dialogue 文字
    const warningBubble = bubbles.find(b => b.type === 'warning');
    if (warningBubble) {
      this.setData({ dialogue: `主人，${warningBubble.text}，请及时处理哦 ${warningBubble.icon}` });
    } else {
      this.setData({ dialogue: '主人，我现在状态很好，继续保持哦 😊' });
    }
  },

  formatTs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '--';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return String(ts);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },

  // ── 待办 ────────────────────────────────────────────────

  addTodo() {
    if (!this.data.selectedLogicalKey) {
      wx.showToast({ title: '请先绑定并选择设备', icon: 'none' });
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
          console.error(error);
          wx.showToast({ title: '添加失败，请重试', icon: 'none' });
        }
      }
    });
  },

  async onTaskDone(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((t) => t._id === id || t.id === id);
    if (!todo) return;
    try {
      if (todo._id) await todoService.completeTodo(todo._id, todo.logicalKey || this.data.selectedLogicalKey);
      await this.loadTodos(this.data.selectedLogicalKey);
      wx.showToast({ title: '任务已完成', icon: 'success' });
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  async toggleUrgency(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((t) => t._id === id || t.id === id);
    if (!todo || !todo._id) return;
    try {
      await todoService.toggleUrgency(todo, todo.logicalKey || this.data.selectedLogicalKey);
      await this.loadTodos(this.data.selectedLogicalKey);
      wx.showToast({ title: '已更新优先级', icon: 'none' });
    } catch (error) {
      console.error(error);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  // ── 设备切换 ────────────────────────────────────────────

  switchDevice(e) {
    const index = e.currentTarget.dataset.index;
    const devices = this.data.devices.map((item, i) => ({ ...item, active: i === index }));
    const selected = devices[index];
    const selectedLogicalKey = selected ? selected.logicalKey : '';
    this.setData({
      devices,
      selectedLogicalKey,
      plantName: selected ? selected.name : '未选择设备'
    });
    this.applyLatestParams(this._deviceRows, selectedLogicalKey);
    this.loadTodos(selectedLogicalKey);
  },

  toggleFan() {
    // TODO: 接通真实下行指令后，在此处调用 deviceService.sendDeviceCmd
    this.setData({ 'fan.isOn': !this.data.fan.isOn });
  },

  async onPullDownRefresh() {
    await this.loadDevices();
    wx.stopPullDownRefresh();
    // 天气缓存 30 分钟，下拉刷新仅刷设备数据，不重新定位
  },

  goToDeviceManagement() {
    wx.navigateTo({ url: '/pages/device/device' });
  }
});
