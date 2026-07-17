const app = getApp();
const plantService = require('../../services/modules/PlantService');
const todoService = require('../../services/modules/TodoService');

function sortPlantsWithFavorites(plants) {
  const source = Array.isArray(plants) ? plants : [];
  return [
    ...source.filter((item) => item.isFavorite),
    ...source.filter((item) => !item.isFavorite)
  ];
}

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    detailNavPaddingTop: 40,
    plants: [],
    filteredPlants: [],
    activeCategory: 'all',
    searchKeyword: '',
    showDetail: false,
    currentPlant: null,
    showMore: false,
    loading: false,
    hasLoadedPlants: false,
    calendarYear: '',
    calendarMonth: '',
    calendarDay: '',
    calendarTodayPlant: ''
  },

  onLoad(_options) {
    const statusBarHeight = getStatusBarHeight();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    // 胶囊底部到页面顶部的距离，再加 8px 间隔，确保按钮不被遮挡
    const detailNavPaddingTop = menuBtn && menuBtn.bottom
      ? menuBtn.bottom - statusBarHeight + 8
      : 40;
    this.setData({ statusBarHeight, detailNavPaddingTop });
    this.initCalendar();
    this.checkLoginStatus();
  },

  initCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const monthlyPlants = [
      '水仙', '梅花', '郁金香', '牡丹', '月季',
      '栀子花', '荷花', '茉莉', '桂花', '菊花',
      '山茶花', '腊梅'
    ];
    const todayPlant = monthlyPlants[(month - 1) % monthlyPlants.length];

    this.setData({
      calendarYear: year,
      calendarMonth: month,
      calendarDay: day,
      calendarTodayPlant: todayPlant
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (!this.checkLoginStatus()) return;
    this.hydratePlantsFromCache();
    this.loadPlants();
  },

  checkLoginStatus() {
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

  hydratePlantsFromCache() {
    if (this.data.plants.length > 0) return;
    const cachedPlants = plantService.getCachedPlants();
    if (!cachedPlants.length) return;

    this.setData({
      plants: cachedPlants,
      filteredPlants: this.filterPlantsByOptions(
        cachedPlants,
        this.data.searchKeyword,
        this.data.activeCategory
      ),
      loading: false,
      hasLoadedPlants: true
    });
  },

  async loadPlants() {
    const shouldShowSkeleton = !this.data.hasLoadedPlants && this.data.plants.length === 0;
    if (shouldShowSkeleton) {
      this.setData({ loading: true });
    }

    try {
      const res = await plantService.getPlants({ useCache: true });
      const plants = Array.isArray(res?.plants) && res.plants.length
        ? res.plants
        : plantService.getFallbackPlants();
      this.setData({
        plants,
        loading: false,
        hasLoadedPlants: true
      });
    } catch (err) {
      console.error('[wiki] loadPlants failed, using local fallback:', err);
      this.setData({
        plants: plantService.getFallbackPlants(),
        loading: false,
        hasLoadedPlants: true
      });
    }

    this.filterPlants();
  },

  onSearch(e) {
    const keyword = String(e.detail.value || '').toLowerCase();
    this.setData({ searchKeyword: keyword });
    this.filterPlants();
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({ activeCategory: category });
    this.filterPlants();
  },

  filterPlants() {
    const filtered = this.filterPlantsByOptions(
      this.data.plants,
      this.data.searchKeyword,
      this.data.activeCategory
    );
    this.setData({ filteredPlants: filtered });
  },

  filterPlantsByOptions(plants, searchKeyword, activeCategory) {
    let filtered = Array.isArray(plants) ? plants.slice() : [];

    if (activeCategory === 'favorites') {
      filtered = filtered.filter((item) => item.isFavorite);
    }

    if (searchKeyword) {
      filtered = filtered.filter((item) =>
        item.name.toLowerCase().includes(searchKeyword) ||
        item.family.toLowerCase().includes(searchKeyword) ||
        item.featureText.toLowerCase().includes(searchKeyword)
      );
    }

    return filtered;
  },

  async toggleFavorite(e) {
    const id = e.currentTarget.dataset.id;
    wx.vibrateShort({ type: 'light' });

    try {
      const res = await plantService.toggleFavorite(id);
      if (!res?.success) return;

      const plants = sortPlantsWithFavorites(
        this.data.plants.map((item) =>
          item.id === id ? { ...item, isFavorite: res.isFavorite } : item
        )
      );

      this.setData({ plants });
      this.filterPlants();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async toggleDetailFavorite() {
    const id = this.data.currentPlant?.id;
    if (!id) return;
    wx.vibrateShort({ type: 'light' });

    try {
      const res = await plantService.toggleFavorite(id);
      if (!res?.success) return;

      const plants = sortPlantsWithFavorites(
        this.data.plants.map((item) =>
          item.id === id ? { ...item, isFavorite: res.isFavorite } : item
        )
      );

      this.setData({
        plants,
        currentPlant: { ...this.data.currentPlant, isFavorite: res.isFavorite }
      });
      this.filterPlants();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  showPlantDetail(e) {
    const id = e.currentTarget.dataset.id;
    const plant = this.data.plants.find((item) => item.id === id);
    if (!plant) return;

    wx.vibrateShort({ type: 'light' });
    this.setData({ showDetail: true, currentPlant: plant, showMore: false });
  },

  closeDetail() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ showDetail: false, currentPlant: null, showMore: false });
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  async addReminder() {
    const plant = this.data.currentPlant;
    if (!plant) return;

    wx.vibrateShort({ type: 'medium' });

    const waterTip = plant.care?.water ? `浇水：${plant.care.water}` : '定期浇水';
    const lightTip = plant.care?.light ? `光照：${plant.care.light}` : '注意光照';
    const content = `【${plant.name}】${waterTip}；${lightTip}`;

    try {
      await todoService.addTodo(content, 'global');
      wx.showToast({ title: '已加入养护提醒', icon: 'success' });
    } catch (err) {
      console.error('[wiki] addReminder error:', err);
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
    }
  },

  openPlantJournal() {
    wx.navigateTo({
      url: '/pages/plantJournal/plantJournal'
    });
  }
});
