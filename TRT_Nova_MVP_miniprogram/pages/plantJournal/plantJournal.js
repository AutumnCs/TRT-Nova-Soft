const deviceService = require('../../services/modules/DeviceService');
const plantJournalService = require('../../services/modules/PlantJournalService');

const EVENT_TYPES = [
  { key: 'watering', label: '浇水', icon: '💧' },
  { key: 'fertilizing', label: '施肥', icon: '🌿' },
  { key: 'pruning', label: '修剪', icon: '✂️' },
  { key: 'relocation', label: '调整位置', icon: '📍' },
  { key: 'note', label: '备注', icon: '📝' },
  { key: 'photo', label: '照片', icon: '🖼️' },
  { key: 'todo_done', label: '完成待办', icon: '✅' }
];

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatMonth(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function buildCalendarDays(baseDate, markedDays = [], selectedDate = '') {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay() || 7;
  const dayCount = lastDay.getDate();
  const markedSet = new Set(markedDays);
  const cells = [];

  for (let i = 1; i < startWeekday; i += 1) {
    cells.push({ empty: true, key: `empty-${i}` });
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    cells.push({
      key: date,
      empty: false,
      day,
      date,
      marked: markedSet.has(date),
      active: date === selectedDate,
      today: date === formatDate(new Date())
    });
  }

  return cells;
}

function normalizeDevices(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    logicalKey: item.logicalKey || '',
    alias: item.alias || item.deviceName || '未命名设备',
    plantType: item.plantType || item?.plant?.name || '',
    location: item.location || '',
    plantLibraryId: item.plantLibraryId || item?.plant?.id || null,
    summary: [item.plantType || item?.plant?.name || '', item.location || ''].filter(Boolean).join(' · ')
  }));
}

function getEventMeta(type) {
  return EVENT_TYPES.find((item) => item.key === type) || EVENT_TYPES[4];
}

Page({
  _deviceRows: [],

  data: {
    statusBarHeight: 20,
    devices: [],
    selectedLogicalKey: '',
    selectedDeviceLabel: '未选择设备',
    selectedPlantLibraryId: null,
    monthLabel: '',
    selectedDate: '',
    calendarDays: [],
    dayRecords: [],
    markedDays: [],
    loading: true,
    showComposer: false,
    eventTypeOptions: EVENT_TYPES.filter((item) => item.key !== 'todo_done'),
    eventTypeIndex: 0,
    draftTitle: '',
    draftContent: ''
  },

  onLoad(options = {}) {
    const now = new Date();
    this._currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this._presetLogicalKey = decodeURIComponent(options.logicalKey || '');
    const selectedDate = formatDate(now);
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      selectedDate,
      monthLabel: formatMonth(now)
    });
    this.initPage();
  },

  async initPage() {
    this.setData({ loading: true });
    try {
      const deviceResult = await deviceService.getDeviceData();
      this._deviceRows = Array.isArray(deviceResult?.deviceData) ? deviceResult.deviceData : [];
      const devices = normalizeDevices(deviceResult?.deviceData);
      const first = this._presetLogicalKey
        ? (devices.find((item) => item.logicalKey === this._presetLogicalKey) || devices[0] || null)
        : (devices[0] || null);
      this.setData({
        devices,
        selectedLogicalKey: first ? first.logicalKey : '',
        selectedDeviceLabel: first ? `${first.alias}${first.summary ? ` · ${first.summary}` : ''}` : '暂无已绑定设备',
        selectedPlantLibraryId: first ? first.plantLibraryId : null
      });

      if (first) {
        await this.loadMonth();
        await this.loadDayRecords(this.data.selectedDate);
      } else {
        this.setData({
          calendarDays: buildCalendarDays(this._currentMonth, [], this.data.selectedDate),
          markedDays: [],
          dayRecords: []
        });
      }
    } catch (err) {
      console.error('[plantJournal] initPage error:', err);
      wx.showToast({ title: '加载日历失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMonth() {
    if (!this.data.selectedLogicalKey) return;
    const result = await plantJournalService.getMonth(this.data.selectedLogicalKey, formatMonth(this._currentMonth));
    const markedDays = Array.isArray(result?.days) ? result.days : [];
    this.setData({
      monthLabel: formatMonth(this._currentMonth),
      markedDays,
      calendarDays: buildCalendarDays(this._currentMonth, markedDays, this.data.selectedDate)
    });
  },

  async loadDayRecords(date) {
    if (!this.data.selectedLogicalKey || !date) return;
    const result = await plantJournalService.getDay(this.data.selectedLogicalKey, date);
    const records = (result?.records || []).map((item) => {
      const meta = getEventMeta(item.eventType);
      return {
        ...item,
        icon: meta.icon,
        typeLabel: meta.label
      };
    });
    this.setData({
      selectedDate: date,
      dayRecords: records,
      calendarDays: buildCalendarDays(this._currentMonth, this.data.markedDays, date)
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onPrevMonth() {
    this._currentMonth = new Date(this._currentMonth.getFullYear(), this._currentMonth.getMonth() - 1, 1);
    this.loadMonth();
  },

  onNextMonth() {
    this._currentMonth = new Date(this._currentMonth.getFullYear(), this._currentMonth.getMonth() + 1, 1);
    this.loadMonth();
  },

  onSelectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.loadDayRecords(date);
  },

  onChooseDevice() {
    if (!this.data.devices.length) return;
    wx.showActionSheet({
      itemList: this.data.devices.map((item) => `${item.alias}${item.summary ? ` · ${item.summary}` : ''}`),
      success: async (res) => {
        const selected = this.data.devices[res.tapIndex];
        if (!selected) return;
        this.setData({
          selectedLogicalKey: selected.logicalKey,
          selectedDeviceLabel: `${selected.alias}${selected.summary ? ` · ${selected.summary}` : ''}`,
          selectedPlantLibraryId: selected.plantLibraryId || null
        });
        await this.loadMonth();
        await this.loadDayRecords(this.data.selectedDate);
      }
    });
  },

  showComposer() {
    this.setData({
      showComposer: true,
      eventTypeIndex: 0,
      draftTitle: '',
      draftContent: ''
    });
  },

  hideComposer() {
    this.setData({ showComposer: false });
  },

  noop() {},

  onTypeChange(e) {
    this.setData({ eventTypeIndex: Number(e.detail.value || 0) });
  },

  onTitleInput(e) {
    this.setData({ draftTitle: e.detail.value || '' });
  },

  onContentInput(e) {
    this.setData({ draftContent: e.detail.value || '' });
  },

  async submitRecord() {
    const eventType = this.data.eventTypeOptions[this.data.eventTypeIndex]?.key || 'note';
    const title = String(this.data.draftTitle || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      await plantJournalService.addRecord({
        logicalKey: this.data.selectedLogicalKey,
        plantLibraryId: this.data.selectedPlantLibraryId,
        eventDate: this.data.selectedDate,
        eventType,
        title,
        content: this.data.draftContent
      });
      this.setData({ showComposer: false, draftTitle: '', draftContent: '' });
      await this.loadMonth();
      await this.loadDayRecords(this.data.selectedDate);
      wx.showToast({ title: '已记录', icon: 'success' });
    } catch (err) {
      console.error('[plantJournal] submitRecord error:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goTrend() {
    if (!this.data.selectedLogicalKey) return;

    const bootstrapRow = Array.isArray(this._deviceRows)
      ? this._deviceRows.find((item) => item && item.logicalKey === this.data.selectedLogicalKey)
      : null;

    if (bootstrapRow) {
      deviceService.setDeviceDetailBootstrap(this.data.selectedLogicalKey, {
        deviceData: [bootstrapRow]
      });
    }

    wx.navigateTo({
      url: `/pages/deviceDetail/deviceDetail?logicalKey=${encodeURIComponent(this.data.selectedLogicalKey)}`
    });
  }
});
