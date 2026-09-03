const app = getApp();
const todoService = require('../../services/modules/TodoService');
const deviceService = require('../../services/modules/DeviceService');
const weatherService = require('../../services/modules/WeatherService');
const alertService = require('../../services/modules/AlertService');
const { computeBubbles, computeMoodEmoji } = require('../../services/config/thresholds');
const themeBehavior = require('../../services/modules/ThemeBehavior');
const indexState = require('./index-state');
const {
  PLANT_IMAGE_LIGHT,
  PLANT_IMAGE_NIGHT,
  DEFAULT_SENSORS,
  DEFAULT_EXTRA,
  DEFAULT_FAN,
  cloneSensors,
  cloneExtra,
  buildDefaultWeather,
  buildDeviceRows,
  buildTelemetryState,
  normalizeTodoTitle
} = indexState;

Page({
  behaviors: [themeBehavior],

  _refreshTimer: null,
  _loadingDevices: false,
  _deviceRows: [],
  _redirectingToLogin: false,
  _lastManualRefreshAt: 0,

  data: {
    foldOpen: false,
    greeting: '',
    dateText: '',
    nwText: '第一巡，植宠都醒着',
    nickName: '植友',
    briefDevices: [],
    plantName: '请选择设备',
    plantMeta: '未设置植物类型和位置',
    plantImageSource: '',
    plantImage: PLANT_IMAGE_LIGHT,
    dialogue: '植株状态良好。',
    todos: [],
    devices: [],
    selectedLogicalKey: '',
    sensors: cloneSensors(),
    extraMetrics: cloneExtra(),
    fan: { ...DEFAULT_FAN },
    weather: buildDefaultWeather(),
    bubbles: [],
    moodEmoji: '🙂',
    plantStatus: indexState.derivePlantStatus(),
    hasDevices: false,
    showTodoComposer: false,
    todoDraft: ''
  },

  onLoad() {
    this.setData({ statusBarHeight: this.getHeaderTop(), theme: app.globalData.theme || 'light' });
    this.refreshHeader();
    this.resolvePlantImage();
    this.checkLoginStatus();
  },

  onShow() {
    const prevTheme = this.data.theme;
    this.syncTheme();
    if (this.data.theme !== prevTheme) {
      this.resolvePlantImage();
    }
    this.refreshHeader();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadDevices({ refreshTodos: true });
    this.loadWeather();
    this.stopAutoRefresh();
  },

  refreshHeader() {
    const now = new Date();
    const hour = now.getHours();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    let greeting = '晚上好';
    let nwText = '夜巡中，植宠都醒着';
    if (hour >= 5 && hour < 11) {
      greeting = '早安';
      nwText = '晨光巡园，叶子都亮着';
    } else if (hour >= 11 && hour < 14) {
      greeting = '午安';
      nwText = '正午巡园，注意遮光';
    } else if (hour >= 14 && hour < 18) {
      greeting = '下午好';
      nwText = '午后巡园，土壤刚好';
    } else if (hour >= 18 && hour < 23) {
      greeting = '晚上好';
      nwText = '晚灯已开，植宠在打盹';
    }
    const userInfo = app.globalData.userInfo || {};
    this.setData({
      greeting,
      nwText,
      nickName: userInfo.nickName || userInfo.nickname || '植友',
      dateText: `${now.getMonth() + 1} 月 ${now.getDate()} 日 ${weekdays[now.getDay()]}`
    });
  },

  toggleFold() {
    this.setData({ foldOpen: !this.data.foldOpen });
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

  getPlantImageByTheme() {
    return this.data.theme === 'dark' ? PLANT_IMAGE_NIGHT : PLANT_IMAGE_LIGHT;
  },

  async resolvePlantImage() {
    this._imageFallbackUsed = false;
    const fallback = this.getPlantImageByTheme();
    const primary = this.data.plantImageSource || fallback;
    const primaryUrl = await this.resolveAnySource(primary);
    if (primaryUrl) {
      this.setData({ plantImage: primaryUrl });
      return;
    }
    const fallbackUrl = await this.resolveAnySource(fallback);
    // If both lookups fail, clear the value to avoid repeated binderror loops.
    this.setData({ plantImage: fallbackUrl || '' });
  },

  async onPlantImageError() {
    // 闃叉 fallback 鏈韩涔熷け璐ュ鑷存棤闄愰€掑綊锛圓pp 妯″紡鏈湴璺緞鍙兘涓嶅彲鐢級
    if (this._imageFallbackUsed) return;
    this._imageFallbackUsed = true;
    const fallbackUrl = await this.resolveAnySource(this.getPlantImageByTheme());
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
      const deviceState = indexState.buildDeviceRows(raw, previousKey, {
        isDeviceOffline: (item) => alertService.isDeviceOffline(item)
      });

      this.setData({
        devices: deviceState.devices,
        selectedLogicalKey: deviceState.selectedLogicalKey,
        plantName: deviceState.plantName,
        plantMeta: deviceState.plantMeta,
        hasDevices: deviceState.devices.length > 0,
        briefDevices: deviceState.devices.slice(0, 2)
      });

      if (!raw.length) {
        this.resetTelemetryDefaults();
        this.resetDeviceControlDefaults();
        if (refreshTodos) {
          await this.loadTodos('');
        }
      } else {
        const telemetryState = indexState.buildTelemetryState(raw, deviceState.selectedLogicalKey, {
          formatTs: (ts) => this.formatTs(ts),
          isDeviceOffline: (item) => alertService.isDeviceOffline(item),
          computeBubbles,
          computeMoodEmoji
        });
        this.setData({
          sensors: telemetryState.sensors,
          extraMetrics: telemetryState.extraMetrics,
          fan: telemetryState.fan,
          bubbles: telemetryState.bubbles,
          moodEmoji: telemetryState.moodEmoji,
          dialogue: telemetryState.dialogue,
          plantStatus: telemetryState.plantStatus
        });
        if (refreshTodos) {
          await this.loadTodos(deviceState.selectedLogicalKey);
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
        plantName: '请选择设备',
        plantMeta: '未设置植物类型和位置',
        todos: [],
        hasDevices: false,
        briefDevices: []
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
      moodEmoji: '\u{1F642}',
      dialogue: '绑定设备后，我会开始陪你照顾它。',
      plantStatus: indexState.derivePlantStatus()
    });
  },

  addTodo() {
    this.setData({ showTodoComposer: true, todoDraft: '' });
  },

  addSuggestedTodo(e) {
    const suggestion = normalizeTodoTitle(e?.currentTarget?.dataset?.content || '');
    this.setData({ showTodoComposer: true, todoDraft: suggestion });
  },

  onTodoDraftInput(e) {
    this.setData({ todoDraft: e?.detail?.value || '' });
  },

  cancelAddTodo() {
    this.setData({ showTodoComposer: false, todoDraft: '' });
  },

  async confirmAddTodo() {
    const title = normalizeTodoTitle(this.data.todoDraft);
    if (!title) {
      wx.showToast({ title: '请输入待办内容', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '添加中...' });
      await todoService.addTodo(title, this.data.selectedLogicalKey || 'global');
      await this.loadTodos(this.data.selectedLogicalKey || '');
      this.setData({ showTodoComposer: false, todoDraft: '' });
      wx.showToast({ title: '已添加待办', icon: 'success' });
    } catch (error) {
      console.error('[index] addTodo error:', error);
      wx.showToast({ title: '添加失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onTaskDone(e) {
    const id = String(e?.currentTarget?.dataset?.id || '').trim();
    if (!id) return;
    try {
      await todoService.completeTodo(id, this.data.selectedLogicalKey || '');
      await this.loadTodos(this.data.selectedLogicalKey || '');
      wx.showToast({ title: '已完成', icon: 'success' });
    } catch (error) {
      console.error('[index] completeTodo error:', error);
      wx.showToast({ title: '完成失败，请重试', icon: 'none' });
    }
  },

  async toggleUrgency(e) {
    const id = String(e?.currentTarget?.dataset?.id || '').trim();
    const todo = this.data.todos.find((item) => String(item._id || item.id) === id);
    if (!todo) return;
    try {
      await todoService.toggleUrgency(todo, this.data.selectedLogicalKey || '');
      await this.loadTodos(this.data.selectedLogicalKey || '');
    } catch (error) {
      console.error('[index] toggleUrgency error:', error);
      wx.showToast({ title: '更新待办失败', icon: 'none' });
    }
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
    const telemetryState = buildTelemetryState(deviceRows, selectedLogicalKey, {
      formatTs: (ts) => this.formatTs(ts),
      isDeviceOffline: (item) => alertService.isDeviceOffline(item),
      computeBubbles,
      computeMoodEmoji
    });

    if (telemetryState.shouldReset) {
      this.resetTelemetryDefaults();
      this.resetDeviceControlDefaults();
      return;
    }

    this.setData({
      sensors: telemetryState.sensors,
      extraMetrics: telemetryState.extraMetrics,
      fan: telemetryState.fan,
      bubbles: telemetryState.bubbles,
      moodEmoji: telemetryState.moodEmoji,
      dialogue: telemetryState.dialogue,
      plantStatus: telemetryState.plantStatus
    });
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
      plantName: selected ? selected.name : '请选择设备',
      plantMeta: selected ? selected.summary : '未设置植物类型和位置',
      briefDevices: devices.slice(0, 2)
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
    const cooldownMs = 30 * 1000;
    const remaining = cooldownMs - (Date.now() - this._lastManualRefreshAt);
    if (remaining > 0) {
      wx.showToast({ title: `请${Math.ceil(remaining / 1000)}秒后再刷新`, icon: 'none' });
      return;
    }
    this._lastManualRefreshAt = Date.now();
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
      'fan.statusText': targetState ? '正在开启...' : '正在关闭...',
      'fan.hintText': '指令已发出，等待设备上报确认'
    });

    try {
      const result = await deviceService.sendDeviceCmd(logicalKey, {
        action: targetState ? 'fan.on' : 'fan.off'
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
        'fan.statusText': '命令已发送，等待设备确认',
        'fan.hintText': '设备上报后状态会自动更新'
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
