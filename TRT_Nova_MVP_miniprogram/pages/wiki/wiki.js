const app = getApp()
const plantService = require('../../services/modules/PlantService')
const { PLANTS } = require('../../data/plants')

Page({
  data: {
    statusBarHeight: 20,
    plants: [],
    filteredPlants: [],
    activeCategory: 'all',
    searchKeyword: '',
    showDetail: false,
    currentPlant: null,
    showMore: false,
    loading: false
  },

  onLoad: function (_options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight });
    this.checkLoginStatus();
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    if (!this.checkLoginStatus()) return;
    this.loadPlants();
  },

  checkLoginStatus: function() {
    app.checkLoginStatus();
    const { hasLogin } = app.globalData;
    if (!hasLogin) {
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth/auth' });
      }, 100);
      return false;
    }
    return true;
  },

  // 从服务端加载植物库，失败时兜底本地数据
  loadPlants: async function() {
    this.setData({ loading: true });
    try {
      const res = await plantService.getPlants();
      const plants = res?.plants || [];
      this.setData({ plants, loading: false });
    } catch (err) {
      console.error('loadPlants failed, using local fallback:', err);
      this.setData({ plants: PLANTS, loading: false });
    }
    this.filterPlants();
  },

  // 搜索
  onSearch: function(e) {
    const keyword = e.detail.value.toLowerCase();
    this.setData({ searchKeyword: keyword });
    this.filterPlants();
  },

  // 切换分类（全部 / 我的收藏）
  switchCategory: function(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({ activeCategory: category });
    this.filterPlants();
  },

  // 筛选植物
  filterPlants: function() {
    let filtered = this.data.plants;

    if (this.data.activeCategory === 'favorites') {
      filtered = filtered.filter(p => p.isFavorite);
    }

    if (this.data.searchKeyword) {
      const kw = this.data.searchKeyword;
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(kw) ||
        p.family.toLowerCase().includes(kw) ||
        p.featureText.toLowerCase().includes(kw)
      );
    }

    this.setData({ filteredPlants: filtered });
  },

  // 切换收藏（列表页）
  toggleFavorite: async function(e) {
    const id = e.currentTarget.dataset.id;
    wx.vibrateShort({ type: 'light' });
    try {
      const res = await plantService.toggleFavorite(id);
      if (res?.success) {
        const plants = this.data.plants.map(p =>
          p.id === id ? { ...p, isFavorite: res.isFavorite } : p
        );
        // 收藏在前
        const sorted = [
          ...plants.filter(p => p.isFavorite),
          ...plants.filter(p => !p.isFavorite)
        ];
        this.setData({ plants: sorted });
        this.filterPlants();
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 切换收藏（详情页）
  toggleDetailFavorite: async function() {
    const id = this.data.currentPlant.id;
    wx.vibrateShort({ type: 'light' });
    try {
      const res = await plantService.toggleFavorite(id);
      if (res?.success) {
        const plants = this.data.plants.map(p =>
          p.id === id ? { ...p, isFavorite: res.isFavorite } : p
        );
        const sorted = [
          ...plants.filter(p => p.isFavorite),
          ...plants.filter(p => !p.isFavorite)
        ];
        const currentPlant = { ...this.data.currentPlant, isFavorite: res.isFavorite };
        this.setData({ plants: sorted, currentPlant });
        this.filterPlants();
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 显示植物详情
  showPlantDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    const plant = this.data.plants.find(p => p.id === id);
    wx.vibrateShort({ type: 'light' });
    this.setData({ showDetail: true, currentPlant: plant, showMore: false });
  },

  // 关闭详情页
  closeDetail: function() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showDetail: false, currentPlant: null, showMore: false });
  },

  toggleMore: function() {
    this.setData({ showMore: !this.data.showMore });
  },

  addReminder: function() {
    wx.vibrateShort({ type: 'medium' });
    wx.showToast({ title: '已加入养护提醒', icon: 'success' });
  }
})
