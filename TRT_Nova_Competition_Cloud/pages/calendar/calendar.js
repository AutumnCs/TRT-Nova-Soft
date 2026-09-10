const app = getApp();
const authService = require('../../services/modules/AuthService');
const todoService = require('../../services/modules/TodoService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const {
  todayInShanghai,
  addDays
} = require('../../services/modules/care-task-presenter');
const {
  WEEK_LABELS,
  getViewRange,
  buildCalendarDays,
  tasksForDate,
  shiftAnchor,
  formatRangeLabel
} = require('./calendar-state');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo().statusBarHeight || 20;
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    today: '',
    viewMode: 'month',
    anchorDate: '',
    selectedDate: '',
    rangeLabel: '',
    weekLabels: WEEK_LABELS,
    calendarDays: [],
    tasks: [],
    selectedTasks: [],
    summary: { streak: 0, todayTasks: [], overdueTasks: [], badges: [] },
    loading: true,
    refreshing: false,
    hasLoaded: false,
    loadError: '',
    operatingTaskId: 0
  },

  onLoad() {
    const today = todayInShanghai();
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      today,
      anchorDate: today,
      selectedDate: today,
      rangeLabel: formatRangeLabel(today, 'month')
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (!this.checkLoginStatus()) return;
    this.loadCalendar();
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

  async loadCalendar(options = {}) {
    if (!this.checkLoginStatus()) return;
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveSnapshot = Boolean(
      options?.preserve !== false &&
      this.data.hasLoaded &&
      this._loadedOpenid === expectedOpenid
    );
    const range = getViewRange(this.data.anchorDate, this.data.viewMode);
    this.setData(preserveSnapshot
      ? { refreshing: true, loadError: '' }
      : { loading: true, refreshing: false, hasLoaded: false, loadError: '' });
    try {
      const [tasks, summary] = await Promise.all([
        todoService.listCareTasks({ ...range, status: 'all' }),
        todoService.getCareSummary()
      ]);
      if (tasks.some((task) => task.ownerOpenid !== expectedOpenid)) {
        throw new Error('任务归属异常，请重新登录');
      }
      if (
        this._loadRequestId !== requestId ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      this._loadedOpenid = expectedOpenid;
      this.applyCalendarState(tasks, summary);
    } catch (err) {
      if (this._loadRequestId !== requestId) return;
      console.error('[calendar] load failed:', err);
      this.setData(preserveSnapshot
        ? { refreshing: false }
        : {
            loading: false,
            refreshing: false,
            hasLoaded: false,
            loadError: err.message || '养护日历加载失败'
          });
    }
  },

  applyCalendarState(tasks, summary = this.data.summary) {
    const today = todayInShanghai();
    this.setData({
      today,
      tasks,
      summary,
      rangeLabel: formatRangeLabel(this.data.anchorDate, this.data.viewMode),
      calendarDays: buildCalendarDays(
        this.data.anchorDate,
        this.data.viewMode,
        tasks,
        this.data.selectedDate,
        today
      ),
      selectedTasks: tasksForDate(tasks, this.data.selectedDate, today),
      loading: false,
      refreshing: false,
      hasLoaded: true,
      loadError: ''
    });
  },

  switchViewMode(e) {
    const viewMode = e.currentTarget.dataset.mode === 'week' ? 'week' : 'month';
    if (viewMode === this.data.viewMode) return;
    this.setData({ viewMode, anchorDate: this.data.selectedDate }, () => this.loadCalendar({ preserve: false }));
  },

  changePeriod(e) {
    const direction = Number(e.currentTarget.dataset.direction) < 0 ? -1 : 1;
    const anchorDate = shiftAnchor(this.data.anchorDate, this.data.viewMode, direction);
    const selectedDate = this.data.viewMode === 'month'
      ? `${anchorDate.slice(0, 7)}-01`
      : anchorDate;
    this.setData({ anchorDate, selectedDate }, () => this.loadCalendar({ preserve: false }));
  },

  goToday() {
    const today = todayInShanghai();
    this.setData({ anchorDate: today, selectedDate: today }, () => this.loadCalendar({ preserve: false }));
  },

  selectDate(e) {
    const selectedDate = e.currentTarget.dataset.date;
    if (!selectedDate) return;
    this.setData({
      selectedDate,
      calendarDays: buildCalendarDays(this.data.anchorDate, this.data.viewMode, this.data.tasks, selectedDate, this.data.today),
      selectedTasks: tasksForDate(this.data.tasks, selectedDate, this.data.today)
    });
  },

  addTask() {
    wx.navigateTo({ url: `/pages/taskForm/taskForm?date=${this.data.selectedDate}` });
  },

  editTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    if (taskId) wx.navigateTo({ url: `/pages/taskForm/taskForm?taskId=${taskId}` });
  },

  completeTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.selectedTasks.find((item) => item.id === taskId);
    if (!task || this.data.operatingTaskId) return;
    wx.showModal({
      title: '完成这次养护？',
      content: `将“${task.title}”记为已完成，并写入 ${task.plantPetName} 的养护记录。`,
      confirmText: '完成打卡',
      confirmColor: '#15803d',
      success: async (res) => {
        if (!res.confirm) return;
        await this.runTaskAction(taskId, async () => {
          const result = await todoService.completeCareTask(taskId);
          const nextMessage = result.nextTask ? `，下次 ${result.nextTask.scheduledFor}` : '';
          wx.showToast({ title: `打卡成功${nextMessage}`, icon: 'none' });
        });
      }
    });
  },

  postponeTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.selectedTasks.find((item) => item.id === taskId);
    if (!task || this.data.operatingTaskId) return;
    wx.showActionSheet({
      itemList: ['顺延 1 天', '顺延 3 天', '编辑日期与规则'],
      success: async (res) => {
        if (res.tapIndex === 2) {
          wx.navigateTo({ url: `/pages/taskForm/taskForm?taskId=${taskId}` });
          return;
        }
        const baseDate = task.scheduledFor < this.data.today ? this.data.today : task.scheduledFor;
        const scheduledFor = addDays(baseDate, res.tapIndex === 1 ? 3 : 1);
        await this.runTaskAction(taskId, async () => {
          await todoService.postponeCareTask(taskId, scheduledFor);
          wx.showToast({ title: `已延至 ${scheduledFor.slice(5)}`, icon: 'none' });
        });
      }
    });
  },

  deleteTask(e) {
    const taskId = Number(e.currentTarget.dataset.id) || 0;
    const task = this.data.selectedTasks.find((item) => item.id === taskId);
    if (!task || this.data.operatingTaskId) return;
    wx.showModal({
      title: '删除这项任务？',
      content: task.status === 'completed'
        ? '任务及其对应养护事件会一并删除，操作不可恢复。'
        : '任务会从首页、日历和植宠档案中同时移除。',
      confirmText: '确认删除',
      confirmColor: '#d94f35',
      success: async (res) => {
        if (!res.confirm) return;
        await this.runTaskAction(taskId, async () => {
          await todoService.deleteCareTask(taskId);
          wx.showToast({ title: '任务已删除', icon: 'success' });
        });
      }
    });
  },

  async runTaskAction(taskId, action) {
    this.setData({ operatingTaskId: taskId });
    try {
      await action();
      await this.loadCalendar();
    } catch (err) {
      console.error('[calendar] task action failed:', err);
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ operatingTaskId: 0 });
    }
  },

  goToGarden() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  async onPullDownRefresh() {
    await this.loadCalendar();
    wx.stopPullDownRefresh();
  }
});
