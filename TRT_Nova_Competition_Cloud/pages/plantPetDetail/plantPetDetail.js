const app = getApp();
const authService = require('../../services/modules/AuthService');
const plantService = require('../../services/modules/PlantService');
const todoService = require('../../services/modules/TodoService');
const plantJournalService = require('../../services/modules/PlantJournalService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const {
  decorateCareTask,
  todayInShanghai,
  addDays
} = require('../../services/modules/care-task-presenter');
const {
  DEFAULT_PLANT_IMAGE,
  buildTaskFactsByPlant,
  buildCareStatus
} = require('../index/plant-pet-state');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function buildDetailView(pet = {}, taskFacts = {}) {
  return {
    ...pet,
    coverUrl: pet.coverUrl || DEFAULT_PLANT_IMAGE,
    speciesName: pet.speciesName || '未知品种',
    enteredAtLabel: pet.enteredAt || '未记录',
    locationLabel: pet.location || '未记录',
    careNotesLabel: pet.careNotes || '还没有养护备注',
    careStatus: buildCareStatus(pet, taskFacts)
  };
}

Page({
  data: {
    statusBarHeight: 20,
    plantPetId: 0,
    pet: null,
    careTasks: [],
    recentJournal: [],
    journalError: '',
    careTaskError: '',
    taskOperatingId: 0,
    loading: true,
    loadError: '',
    operating: false,
    defaultPlantImage: DEFAULT_PLANT_IMAGE
  },

  onLoad(options = {}) {
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      plantPetId: Number(options.plantPetId) || 0
    });
  },

  onShow() {
    this.loadPlantPet();
  },

  onUnload() {
    this._loadRequestId = (this._loadRequestId || 0) + 1;
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  async loadPlantPet() {
    if (!this.checkLoginStatus()) return;
    if (!this.data.plantPetId) {
      this.setData({ loading: false, loadError: '植宠档案标识无效' });
      return;
    }

    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    this.setData({ pet: null, loading: true, loadError: '' });
    try {
      const careRequest = todoService.listCareTasks({
        plantPetId: this.data.plantPetId,
        status: 'all',
        includeArchivedPlants: true
      }).then((tasks) => ({ success: true, tasks }))
        .catch((error) => ({ success: false, error }));
      const journalRequest = plantJournalService.listTimeline({ plantPetId: this.data.plantPetId, limit: 3 })
        .then((value) => ({ success: value?.success !== false, value }))
        .catch((error) => ({ success: false, error }));
      const [result, careResult, journalResult] = await Promise.all([
        plantService.getMyPlantPet(this.data.plantPetId),
        careRequest,
        journalRequest
      ]);
      if (result?.success === false || !result?.pet) {
        throw new Error(result?.msg || '植宠档案不存在');
      }
      if (
        result.pet.ownerOpenid !== expectedOpenid ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) {
        throw new Error('植宠档案归属异常，请重新登录');
      }
      if (this._loadRequestId !== requestId) return;
      const today = todayInShanghai();
      const careTasks = careResult.success
        ? careResult.tasks.map((task) => decorateCareTask(task, today))
        : [];
      if (careTasks.some((task) => task.ownerOpenid !== expectedOpenid)) {
        throw new Error('养护任务归属异常，请重新登录');
      }
      const recentJournal = journalResult.success
        ? (journalResult.value?.records || []).map((record) => ({
          ...record,
          dateLabel: String(record.eventDate || '').replace(/-/g, '.'),
          coverPhoto: record.photos?.[0] || ''
        }))
        : [];
      if (recentJournal.some((record) => record.ownerOpenid !== expectedOpenid)) {
        throw new Error('成长记录归属异常，请重新登录');
      }
      const taskFacts = buildTaskFactsByPlant(
        careTasks.filter((task) => task.status === 'pending' && task.scheduledFor <= today)
      )[result.pet.id];
      this.setData({
        pet: buildDetailView(result.pet, taskFacts),
        careTasks,
        recentJournal,
        journalError: journalResult.success ? '' : (journalResult.error?.message || '成长记录暂时没有加载出来'),
        careTaskError: careResult.success ? '' : (careResult.error?.message || '养护任务暂时没有加载出来'),
        loading: false,
        loadError: ''
      });
    } catch (err) {
      if (this._loadRequestId !== requestId) return;
      console.error('[plantPetDetail] load failed:', err);
      this.setData({
        pet: null,
        loading: false,
        loadError: err.message || '档案加载失败'
      });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  editPlantPet() {
    if (!this.data.pet || this.data.pet.status !== 'active') return;
    wx.navigateTo({
      url: `/pages/plantPetForm/plantPetForm?plantPetId=${this.data.plantPetId}`
    });
  },

  addCareTask() {
    if (!this.data.pet || this.data.pet.status !== 'active') return;
    wx.navigateTo({ url: `/pages/taskForm/taskForm?plantPetId=${this.data.plantPetId}&date=${todayInShanghai()}` });
  },

  openJournal() {
    wx.navigateTo({ url: `/pages/plantJournal/plantJournal?plantPetId=${this.data.plantPetId}` });
  },

  addJournalRecord() {
    if (!this.data.pet || this.data.pet.status !== 'active') return;
    wx.navigateTo({ url: `/pages/plantJournal/plantJournal?plantPetId=${this.data.plantPetId}&compose=1` });
  },

  editCareTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    if (taskId) wx.navigateTo({ url: `/pages/taskForm/taskForm?taskId=${taskId}` });
  },

  completeCareTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.careTasks.find((item) => item.id === taskId);
    if (!task || this.data.taskOperatingId) return;
    wx.showModal({
      title: '完成这次养护？',
      content: `“${task.title}”会写入这盆植宠的养护记录。`,
      confirmText: '完成打卡',
      confirmColor: '#15803d',
      success: async (res) => {
        if (!res.confirm) return;
        await this.runCareTaskAction(taskId, async () => {
          const result = await todoService.completeCareTask(taskId);
          wx.showToast({ title: result.nextTask ? `完成，下次 ${result.nextTask.scheduledFor.slice(5)}` : '打卡成功', icon: 'none' });
        });
      }
    });
  },

  postponeCareTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.careTasks.find((item) => item.id === taskId);
    if (!task || this.data.taskOperatingId) return;
    const today = todayInShanghai();
    const scheduledFor = addDays(task.scheduledFor < today ? today : task.scheduledFor, 1);
    this.runCareTaskAction(taskId, async () => {
      await todoService.postponeCareTask(taskId, scheduledFor);
      wx.showToast({ title: `已延至 ${scheduledFor.slice(5)}`, icon: 'none' });
    });
  },

  deleteCareTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.careTasks.find((item) => item.id === taskId);
    if (!task || this.data.taskOperatingId) return;
    wx.showModal({
      title: '删除这项任务？',
      content: task.status === 'completed' ? '对应养护事件也会一并删除。' : '任务会从所有页面中移除。',
      confirmText: '确认删除',
      confirmColor: '#d94f35',
      success: async (res) => {
        if (!res.confirm) return;
        await this.runCareTaskAction(taskId, async () => {
          await todoService.deleteCareTask(taskId);
          wx.showToast({ title: '任务已删除', icon: 'success' });
        });
      }
    });
  },

  async runCareTaskAction(taskId, action) {
    this.setData({ taskOperatingId: taskId });
    try {
      await action();
      await this.loadPlantPet();
    } catch (err) {
      console.error('[plantPetDetail] care task action failed:', err);
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ taskOperatingId: 0 });
    }
  },

  archivePlantPet() {
    if (!this.data.pet || this.data.pet.status !== 'active' || this.data.operating) return;
    wx.showModal({
      title: '归档这盆植宠？',
      content: '归档后不再出现在“在养”列表，档案仍会保留在“已归档”中。',
      confirmText: '确认归档',
      confirmColor: '#9a5a08',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ operating: true });
        try {
          const result = await plantService.archivePlantPet(this.data.plantPetId);
          if (result?.success === false || !result?.pet) {
            throw new Error(result?.msg || '归档失败');
          }
          wx.showToast({ title: '已归档', icon: 'success' });
          this.setData({ pet: buildDetailView(result.pet) });
        } catch (err) {
          wx.showToast({ title: err.message || '归档失败', icon: 'none' });
        } finally {
          this.setData({ operating: false });
        }
      }
    });
  },

  deletePlantPet() {
    if (!this.data.pet || this.data.operating) return;
    wx.showModal({
      title: '永久删除档案？',
      content: `“${this.data.pet.nickname}”及其任务、养护事件、成长日记和图片将被永久删除，当前操作不可恢复。`,
      confirmText: '永久删除',
      confirmColor: '#d94f35',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ operating: true });
        try {
          const result = await plantService.deletePlantPet(this.data.plantPetId);
          if (result?.success === false) {
            throw new Error(result?.msg || '删除失败');
          }
          wx.showToast({ title: '档案已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }), 500);
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        } finally {
          this.setData({ operating: false });
        }
      }
    });
  },

  onPlantImageError() {
    if (!this.data.pet) return;
    this.setData({ 'pet.coverUrl': DEFAULT_PLANT_IMAGE });
  },

  async onPullDownRefresh() {
    await this.loadPlantPet();
    wx.stopPullDownRefresh();
  }
});
