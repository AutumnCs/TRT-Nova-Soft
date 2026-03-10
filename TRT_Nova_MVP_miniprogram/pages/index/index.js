const app = getApp();
const todoService = require('../../services/modules/TodoService');

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

  data: {
    statusBarHeight: 20,
    plantName: 'Nova',
    plantImage: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?q=80&w=600&auto=format&fit=crop',
    dialogue: '主人，记得给我按时浇水哦。',
    todos: [],
    devices: [],
    sensors: { ...DEFAULT_SENSORS },
    extraMetrics: { ...DEFAULT_EXTRA },
    fan: {
      name: '通风风扇',
      icon: '🌪️',
      isOn: false
    }
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    this.checkLoginStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadTodos();
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
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  async loadTodos() {
    try {
      const todos = await todoService.getTodos();
      todos.sort((a, b) => (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));
      this.setData({ todos });
    } catch (error) {
      this.setData({ todos: [] });
    }
  },

  async loadDevices() {
    if (this._loadingDevices) return;
    this._loadingDevices = true;
    try {
      const res = await wx.cloud.callFunction({ name: 'getDeviceData' });
      const raw = (res.result && res.result.deviceData) || [];
      const mapped = raw.map((item, index) => ({
        _id: item.logicalKey || String(index),
        name: item.alias || item.deviceName || '未命名设备',
        status: item.hasLatest ? '在线' : '已绑定',
        icon: '📟',
        active: index === 0
      }));
      this.setData({ devices: mapped });

      if (!raw.length) {
        this.resetTelemetryDefaults();
      } else {
        this.applyLatestParams(raw);
      }
    } catch (error) {
      this.setData({ devices: [] });
      this.resetTelemetryDefaults();
    } finally {
      this._loadingDevices = false;
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => {
      if (!this.checkLoginStatus()) return;
      this.loadDevices();
    }, 3000);
  },

  stopAutoRefresh() {
    if (!this._refreshTimer) return;
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  },

  resetTelemetryDefaults() {
    this.setData({
      sensors: { ...DEFAULT_SENSORS },
      extraMetrics: { ...DEFAULT_EXTRA }
    });
  },

  applyLatestParams(deviceRows) {
    if (!Array.isArray(deviceRows) || deviceRows.length === 0) return;
    const first = deviceRows.find((d) => d && d.hasLatest && d.params) || deviceRows[0];
    const params = first && first.params ? first.params : {};

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
    if (first && first.updatedAt) patch['extraMetrics.updatedAt'] = this.formatTs(first.updatedAt);
    if (Object.keys(patch).length > 0) this.setData(patch);
  },

  formatTs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '--';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return String(ts);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },

  addTodo() {
    wx.showModal({
      title: '添加待办',
      editable: true,
      placeholderText: '请输入任务内容',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await todoService.addTodo(res.content.trim());
          await this.loadTodos();
          wx.showToast({ title: '添加成功', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: '添加失败', icon: 'none' });
        }
      }
    });
  },

  async onTaskDone(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((t) => t._id === id || t.id === id);
    if (!todo) return;
    try {
      if (todo._id) await todoService.completeTodo(todo._id);
      await this.loadTodos();
      wx.showToast({ title: '任务已完成', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async toggleUrgency(e) {
    const id = e.currentTarget.dataset.id;
    const todo = this.data.todos.find((t) => t._id === id || t.id === id);
    if (!todo || !todo._id) return;
    try {
      await todoService.toggleUrgency(todo);
      await this.loadTodos();
      wx.showToast({ title: '已更新优先级', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  switchPlant() {
    wx.showActionSheet({
      itemList: ['Nova（办公室）', 'Luna（客厅）'],
      success: (res) => {
        this.setData({
          plantName: res.tapIndex === 0 ? 'Nova（办公室）' : 'Luna（客厅）'
        });
      }
    });
  },

  switchDevice(e) {
    const index = e.currentTarget.dataset.index;
    const devices = this.data.devices.map((item, i) => ({ ...item, active: i === index }));
    this.setData({ devices });
  },

  toggleFan() {
    this.setData({ 'fan.isOn': !this.data.fan.isOn });
  },

  goToDeviceManagement() {
    wx.navigateTo({ url: '/pages/device/device' });
  }
});
