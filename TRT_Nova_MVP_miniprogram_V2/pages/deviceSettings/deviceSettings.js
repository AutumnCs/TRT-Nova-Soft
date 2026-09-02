const deviceService = require('../../services/modules/DeviceService');
const plantService = require('../../services/modules/PlantService');
const themeBehavior = require('../../services/modules/ThemeBehavior');

const PROVISION_URL = 'http://192.168.4.1';

function scorePlantMatch(plant, keyword) {
  const name = String(plant?.name || '').toLowerCase();
  const family = String(plant?.family || '').toLowerCase();
  const featureText = String(plant?.featureText || '').toLowerCase();
  const tags = Array.isArray(plant?.tags) ? plant.tags.join(' ').toLowerCase() : '';
  if (!keyword) return 0;

  if (name === keyword) return -2;
  if (name.startsWith(keyword)) return -1;
  if (family.startsWith(keyword)) return 0;
  if (featureText.startsWith(keyword)) return 1;
  if (name.includes(keyword)) return 2;
  if (family.includes(keyword)) return 3;
  if (featureText.includes(keyword)) return 4;
  if (tags.includes(keyword)) return 5;
  return 99;
}

function filterPlantsByKeyword(plants, rawKeyword = '') {
  const keyword = String(rawKeyword || '').toLowerCase().trim();
  const source = Array.isArray(plants) ? plants : [];

  if (!keyword) {
    return source.slice().sort((a, b) => {
      if (Boolean(b.isFavorite) !== Boolean(a.isFavorite)) {
        return a.isFavorite ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
  }

  return source
    .filter((item) =>
      item.name.toLowerCase().includes(keyword) ||
      item.family.toLowerCase().includes(keyword) ||
      String(item.featureText || '').toLowerCase().includes(keyword) ||
      (Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase().includes(keyword) : false)
    )
    .sort((a, b) => {
      const scoreDiff = scorePlantMatch(a, keyword) - scorePlantMatch(b, keyword);
      if (scoreDiff !== 0) return scoreDiff;
      if (Boolean(b.isFavorite) !== Boolean(a.isFavorite)) {
        return a.isFavorite ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
}

Page({
  behaviors: [themeBehavior],

  onShow() {
    this.syncTheme();
  },

  _allPickerPlants: [],

  data: {
    logicalKey: '',
    alias: '',
    location: '',
    selectedPlant: null,
    saving: false,
    provisionUrl: PROVISION_URL,
    showPlantPicker: false,
    pickerKeyword: '',
    pickerPlants: [],
    pickerLoading: false,
    pickerInputFocus: false
  },

  async onLoad(options) {
    const logicalKey = decodeURIComponent(options?.logicalKey || '');
    this.setData({ statusBarHeight: this.getHeaderTop(), logicalKey, theme: getApp().globalData.theme || 'light' });
    await this.loadCurrentInfo();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  async loadCurrentInfo() {
    if (!this.data.logicalKey) return;

    wx.showLoading({ title: '加载中...' });
    try {
      const result = await deviceService.getDeviceData({
        logicalKey: this.data.logicalKey,
        withHistory: false
      });
      const row = (result.deviceData || [])[0];
      if (!row) return;

      let selectedPlant = row.plant || null;
      if (!selectedPlant && row.plantType) {
        const referencePlants = plantService.getCachedPlants().length
          ? plantService.getCachedPlants()
          : plantService.getFallbackPlants();
        selectedPlant = plantService.findPlantByIdentity(referencePlants, {
          plantId: row.plantLibraryId,
          plantName: row.plantType
        });
      }

      this.setData({
        alias: row.alias || '',
        location: row.location || '',
        selectedPlant
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onAliasInput(e) {
    this.setData({ alias: e.detail.value || '' });
  },

  onLocationInput(e) {
    this.setData({ location: e.detail.value || '' });
  },

  async openPlantPicker() {
    const cachedPlants = plantService.getCachedPlants();

    this.setData({
      showPlantPicker: true,
      pickerKeyword: '',
      pickerPlants: filterPlantsByKeyword(cachedPlants),
      pickerLoading: cachedPlants.length === 0,
      pickerInputFocus: true
    });

    this._allPickerPlants = cachedPlants;

    try {
      const res = await plantService.getPlants({ useCache: true });
      const plants = res?.plants || [];
      this._allPickerPlants = plants;
      this.setData({
        pickerPlants: filterPlantsByKeyword(plants, this.data.pickerKeyword),
        pickerLoading: false
      });
    } catch (err) {
      console.error(err);
      if (cachedPlants.length > 0) {
        this._allPickerPlants = cachedPlants;
        this.setData({
          pickerPlants: filterPlantsByKeyword(cachedPlants, this.data.pickerKeyword),
          pickerLoading: false
        });
      } else {
        this._allPickerPlants = [];
        this.setData({
          pickerPlants: [],
          pickerLoading: false
        });
        wx.showToast({
          title: '植物库加载失败，请稍后重试',
          icon: 'none'
        });
      }
    }
  },

  closePlantPicker() {
    this.setData({
      showPlantPicker: false,
      pickerKeyword: '',
      pickerInputFocus: false
    });
    if (typeof wx.hideKeyboard === 'function') {
      wx.hideKeyboard();
    }
  },

  onPickerKeywordInput(e) {
    const pickerKeyword = e.detail.value || '';
    this.setData({
      pickerKeyword,
      pickerPlants: filterPlantsByKeyword(this._allPickerPlants, pickerKeyword)
    });
  },

  onPickerSearchConfirm(e) {
    const keyword = (e?.detail?.value) || this.data.pickerKeyword || '';

    this.setData({
      pickerKeyword: keyword,
      pickerPlants: filterPlantsByKeyword(this._allPickerPlants, keyword),
      pickerInputFocus: false
    });

    if (typeof wx.hideKeyboard === 'function') {
      wx.hideKeyboard();
    }
  },

  selectPlant(e) {
    const id = Number(e.currentTarget.dataset.id);
    const plant = (this._allPickerPlants || []).find((item) => item.id === id);
    if (!plant) return;

    wx.vibrateShort({ type: 'light' });
    this.setData({
      selectedPlant: plant,
      showPlantPicker: false,
      pickerKeyword: '',
      pickerInputFocus: false
    });

    if (typeof wx.hideKeyboard === 'function') {
      wx.hideKeyboard();
    }
  },

  stopPropagation() {},

  showProvisionGuide() {
    wx.showModal({
      title: '浏览器配网说明',
      content: [
        '1. 给设备通电，连接设备发出的 Wi-Fi 热点。',
        `2. 打开手机浏览器，输入 ${this.data.provisionUrl}。`,
        '3. 在配网页中选择家里的 Wi-Fi，并输入密码。',
        '4. 设备联网成功后，再回到小程序继续使用。'
      ].join('\n'),
      confirmText: '复制地址',
      cancelText: '我知道了',
      success: (res) => {
        if (res.confirm) this.copyProvisionUrl();
      }
    });
  },

  copyProvisionUrl() {
    wx.setClipboardData({
      data: this.data.provisionUrl,
      success: () => {
        wx.showModal({
          title: '已复制配网地址',
          content: '微信小程序不能直接拉起系统浏览器，请切换到浏览器后粘贴打开。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  async onSave() {
    if (this.data.saving) return;
    if (!this.data.logicalKey) {
      wx.showToast({ title: '缺少设备标识', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    try {
      const plant = this.data.selectedPlant;
      const result = await deviceService.updateBoundDeviceInfo({
        logicalKey: this.data.logicalKey,
        alias: this.data.alias.trim(),
        location: this.data.location.trim(),
        plantType: plant ? plant.name : '',
        plantLibraryId: plant ? plant.id : null
      });

      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
      } else {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  }
});
