const deviceService = require('../../services/modules/DeviceService');
const plantService = require('../../services/modules/PlantService');
const { PLANTS } = require('../../data/plants');

const PROVISION_URL = 'http://192.168.4.1';

Page({
  data: {
    logicalKey: '',
    alias: '',
    location: '',
    selectedPlant: null,
    saving: false,
    provisionUrl: PROVISION_URL,
    // 植物选择弹窗
    showPlantPicker: false,
    pickerKeyword: '',
    pickerPlants: [],
    pickerLoading: false
  },

  async onLoad(options) {
    const logicalKey = decodeURIComponent(options?.logicalKey || '');
    this.setData({ logicalKey });
    await this.loadCurrentInfo();
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

      // 优先用服务端返回的完整 plant 对象，其次按名称匹配兜底
      let selectedPlant = row.plant || null;
      if (!selectedPlant && row.plantType) {
        selectedPlant = PLANTS.find(p => p.name === row.plantType) || null;
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
    this.setData({ alias: e.detail.value });
  },

  onLocationInput(e) {
    this.setData({ location: e.detail.value });
  },

  // 打开植物选择弹窗
  async openPlantPicker() {
    this.setData({ showPlantPicker: true, pickerKeyword: '', pickerLoading: true });
    try {
      const res = await plantService.getPlants();
      this.setData({ pickerPlants: res?.plants || [], pickerLoading: false });
    } catch (err) {
      console.error(err);
      // 兜底本地数据
      const sorted = [
        ...PLANTS.filter(p => p.isFavorite),
        ...PLANTS.filter(p => !p.isFavorite)
      ];
      this.setData({ pickerPlants: sorted, pickerLoading: false });
    }
  },

  closePlantPicker() {
    this.setData({ showPlantPicker: false, pickerKeyword: '' });
  },

  // 弹窗内搜索
  onPickerSearch(e) {
    const keyword = e.detail.value.toLowerCase().trim();
    this.setData({ pickerKeyword: keyword });
    // 直接在已加载的列表上过滤，无需再请求
    const allPlants = this._cachedPickerPlants || this.data.pickerPlants;
    if (!this._cachedPickerPlants) {
      this._cachedPickerPlants = this.data.pickerPlants;
    }
    const filtered = keyword
      ? allPlants.filter(p =>
          p.name.toLowerCase().includes(keyword) ||
          p.family.toLowerCase().includes(keyword)
        )
      : allPlants;
    this.setData({ pickerPlants: filtered });
  },

  // 选择植物
  selectPlant(e) {
    const id = Number(e.currentTarget.dataset.id);
    const plant = (this._cachedPickerPlants || this.data.pickerPlants).find(p => p.id === id);
    if (!plant) return;
    wx.vibrateShort({ type: 'light' });
    this._cachedPickerPlants = null;
    this.setData({ selectedPlant: plant, showPlantPicker: false, pickerKeyword: '' });
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
          content: '微信小程序不能直接拉起系统浏览器。请退出到浏览器后粘贴打开配网页。',
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
