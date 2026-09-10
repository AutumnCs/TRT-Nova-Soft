const app = getApp();
const authService = require('../../services/modules/AuthService');
const plantService = require('../../services/modules/PlantService');
const todoService = require('../../services/modules/TodoService');
const weatherService = require('../../services/modules/WeatherService');
const { getSolarTermState } = require('../../services/modules/SolarTermService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const {
  decorateCareTask,
  todayInShanghai
} = require('../../services/modules/care-task-presenter');
const {
  DEFAULT_PLANT_IMAGE,
  buildTaskFactsByPlant,
  splitPlantPetCards
} = require('./plant-pet-state');
const {
  buildLoadingWeatherCard,
  buildWeatherCardState
} = require('./weather-card-state');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    viewMode: 'active',
    activePets: [],
    archivedPets: [],
    visiblePets: [],
    homeTasks: [],
    careStreak: 0,
    careLoadError: '',
    operatingTaskId: 0,
    weather: buildLoadingWeatherCard(),
    solarTerm: getSolarTermState(),
    loading: true,
    refreshing: false,
    hasLoaded: false,
    weatherLoaded: false,
    loadError: '',
    defaultPlantImage: DEFAULT_PLANT_IMAGE
  },

  onLoad() {
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      solarTerm: getSolarTermState()
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadPlantPets();
    this.loadWeather();
  },

  onUnload() {
    this._loadRequestId = (this._loadRequestId || 0) + 1;
    this._weatherRequestId = (this._weatherRequestId || 0) + 1;
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  async loadPlantPets() {
    if (!this.checkLoginStatus()) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveSnapshot = Boolean(
      this.data.hasLoaded &&
      this._loadedOpenid === expectedOpenid
    );
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    this.setData(preserveSnapshot
      ? { refreshing: true, loadError: '' }
      : {
          activePets: [],
          archivedPets: [],
          visiblePets: [],
          homeTasks: [],
          loading: true,
          refreshing: false,
          hasLoaded: false,
          loadError: ''
        });

    try {
      const careRequest = todoService.getCareSummary()
        .then((summary) => ({ success: true, summary }))
        .catch((error) => ({ success: false, error }));
      const [result, careResult] = await Promise.all([
        plantService.listMyPlantPets({ includeArchived: true }),
        careRequest
      ]);
      if (result?.success === false) {
        throw new Error(result.msg || '植宠档案加载失败');
      }
      const pets = Array.isArray(result?.pets) ? result.pets : [];
      if (pets.some((pet) => pet.ownerOpenid !== expectedOpenid)) {
        throw new Error('植宠档案归属异常，请重新登录');
      }
      if (
        this._loadRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;

      const preserveCareSnapshot = preserveSnapshot && !careResult.success;
      const summary = careResult.success
        ? careResult.summary
        : { today: todayInShanghai(), streak: 0, todayTasks: [], overdueTasks: [] };
      const homeTasks = preserveCareSnapshot
        ? this.data.homeTasks
        : [
            ...summary.overdueTasks.map((task) => decorateCareTask(task, summary.today)),
            ...summary.todayTasks.map((task) => decorateCareTask(task, summary.today))
          ];
      if (homeTasks.some((task) => task.ownerOpenid !== expectedOpenid)) {
        throw new Error('养护任务归属异常，请重新登录');
      }
      const groups = splitPlantPetCards(pets, buildTaskFactsByPlant(homeTasks));
      const visiblePets = this.data.viewMode === 'archived' ? groups.archived : groups.active;
      this._loadedOpenid = expectedOpenid;
      this.setData({
        activePets: groups.active,
        archivedPets: groups.archived,
        visiblePets,
        homeTasks,
        careStreak: preserveCareSnapshot ? this.data.careStreak : summary.streak,
        careLoadError: careResult.success ? '' : (careResult.error?.message || '今日任务暂时没有加载出来'),
        loading: false,
        refreshing: false,
        hasLoaded: true,
        loadError: ''
      });
    } catch (err) {
      if (this._loadRequestId !== requestId) return;
      console.error('[index] loadPlantPets failed:', err);
      this.setData(preserveSnapshot
        ? {
            refreshing: false,
            careLoadError: err.message || '花园刷新失败，正在显示上次内容'
          }
        : {
            loading: false,
            refreshing: false,
            hasLoaded: false,
            loadError: err.message || '花园加载失败，请稍后重试'
          });
    }
  },

  async loadWeather() {
    if (!this.checkLoginStatus()) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveSnapshot = Boolean(
      this.data.weatherLoaded &&
      this._weatherLoadedOpenid === expectedOpenid
    );
    const requestId = (this._weatherRequestId || 0) + 1;
    this._weatherRequestId = requestId;
    this.setData(preserveSnapshot
      ? { solarTerm: getSolarTermState() }
      : { weather: buildLoadingWeatherCard(), solarTerm: getSolarTermState() });
    try {
      const summary = await weatherService.getCurrentWeather();
      if (
        this._weatherRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      this._weatherLoadedOpenid = expectedOpenid;
      this.setData({ weather: buildWeatherCardState(summary), weatherLoaded: true });
    } catch (err) {
      if (
        this._weatherRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      if (preserveSnapshot) return;
      this._weatherLoadedOpenid = expectedOpenid;
      this.setData({
        weather: buildWeatherCardState({
          available: false,
          reason: 'request_failed',
          msg: err.message || '天气暂不可用'
        }),
        weatherLoaded: true
      });
    }
  },

  switchViewMode(e) {
    const mode = e.currentTarget.dataset.mode === 'archived' ? 'archived' : 'active';
    this.setData({
      viewMode: mode,
      visiblePets: mode === 'archived' ? this.data.archivedPets : this.data.activePets
    });
  },

  openPlantPet(e) {
    const plantPetId = Number(e.currentTarget.dataset.id) || 0;
    if (!plantPetId) return;
    wx.navigateTo({
      url: `/pages/plantPetDetail/plantPetDetail?plantPetId=${plantPetId}`
    });
  },

  addPlantPet() {
    wx.showActionSheet({
      itemList: ['拍照识别后建档', '手动填写档案'],
      success: (result) => {
        if (result.tapIndex === 0) {
          wx.setStorageSync('nvp_assistant_open_add_plant', {
            requestedAt: Date.now()
          });
          wx.switchTab({ url: '/pages/assistant/assistant' });
          return;
        }
        if (result.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/plantPetForm/plantPetForm' });
        }
      }
    });
  },

  addCareTask() {
    if (!this.data.activePets.length) {
      wx.showToast({ title: '请先建立植宠档案', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/taskForm/taskForm?date=${todayInShanghai()}` });
  },

  openCalendar() {
    wx.switchTab({ url: '/pages/calendar/calendar' });
  },

  completeCareTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.homeTasks.find((item) => item.id === taskId);
    if (!task || this.data.operatingTaskId) return;
    wx.showModal({
      title: '完成这次养护？',
      content: `将“${task.title}”记入 ${task.plantPetName} 的养护记录。`,
      confirmText: '完成打卡',
      confirmColor: '#15803d',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ operatingTaskId: taskId });
        try {
          const result = await todoService.completeCareTask(taskId);
          wx.showToast({
            title: result.nextTask ? `完成，下次 ${result.nextTask.scheduledFor.slice(5)}` : '打卡成功',
            icon: 'none'
          });
          await this.loadPlantPets();
        } catch (err) {
          wx.showToast({ title: err.message || '打卡失败', icon: 'none' });
        } finally {
          this.setData({ operatingTaskId: 0 });
        }
      }
    });
  },

  openKnowledge() {
    wx.navigateTo({ url: '/pages/wiki/wiki' });
  },

  openWeatherSettings() {
    wx.navigateTo({ url: '/pages/weatherSettings/weatherSettings' });
  },

  onPlantImageError(e) {
    const plantPetId = Number(e.currentTarget.dataset.id) || 0;
    const replaceImage = (items) => items.map((item) =>
      item.id === plantPetId ? { ...item, coverUrl: DEFAULT_PLANT_IMAGE } : item
    );
    const activePets = replaceImage(this.data.activePets);
    const archivedPets = replaceImage(this.data.archivedPets);
    this.setData({
      activePets,
      archivedPets,
      visiblePets: this.data.viewMode === 'archived' ? archivedPets : activePets
    });
  },

  async onPullDownRefresh() {
    await Promise.all([this.loadPlantPets(), this.loadWeather()]);
    wx.stopPullDownRefresh();
  }
});
