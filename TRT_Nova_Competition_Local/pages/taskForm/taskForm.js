const app = getApp();
const plantService = require('../../services/modules/PlantService');
const todoService = require('../../services/modules/TodoService');
const {
  TASK_TYPE_OPTIONS,
  RECURRENCE_OPTIONS,
  getRecurrenceLabel
} = require('../../services/modules/care-task-presenter');
const {
  createDefaultForm,
  resolveTaskFormContext,
  formFromCareTask,
  formFromTaskProposal,
  buildTaskSubmissionPayload,
  proposalUnavailableMessage
} = require('./task-form-state');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo().statusBarHeight || 20;
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function getHeaderTop() {
  if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (rect && rect.bottom) return rect.bottom + 8;
  }
  return getStatusBarHeight() + 44;
}

Page({
  data: {
    statusBarHeight: 20,
    headerTop: 64,
    mode: 'create',
    pageTitle: '新建养护任务',
    taskId: 0,
    proposalKey: '',
    proposalStatus: '',
    consumedTaskId: 0,
    loading: true,
    submitting: false,
    loadError: '',
    plantPets: [],
    plantPetIndex: 0,
    taskTypeOptions: TASK_TYPE_OPTIONS,
    taskTypeIndex: 0,
    recurrenceOptions: RECURRENCE_OPTIONS,
    recurrenceIndex: 0,
    suggestionSource: '',
    form: createDefaultForm()
  },

  onLoad(options = {}) {
    const pendingSuggestion = options.fromAi ? wx.getStorageSync('nvp_pending_care_task') : null;
    const context = resolveTaskFormContext(options, pendingSuggestion);
    this._initialOptions = options;
    this._missingProposalKey = context.missingProposalKey;
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      headerTop: getHeaderTop(),
      taskId: context.taskId,
      proposalKey: context.proposalKey,
      mode: context.mode,
      pageTitle: context.mode === 'edit'
        ? '编辑养护任务'
        : (context.mode === 'proposal' ? '确认 NOVA 建议' : '新建养护任务'),
      suggestionSource: context.mode === 'proposal' ? 'ai' : '',
      form: createDefaultForm(options)
    });
    this.loadContext();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  async loadContext() {
    if (!this.checkLoginStatus()) return;
    if (this._missingProposalKey) {
      this.setData({
        loading: false,
        loadError: '旧版任务建议缺少服务端凭据，请回到对话重新生成'
      });
      return;
    }
    this.setData({ loading: true, loadError: '' });
    try {
      const [petResult, task, proposal] = await Promise.all([
        plantService.listMyPlantPets(),
        this.data.mode === 'edit' ? todoService.getCareTask(this.data.taskId) : Promise.resolve(null),
        this.data.mode === 'proposal'
          ? todoService.getCareTaskProposal(this.data.proposalKey)
          : Promise.resolve(null)
      ]);
      if (petResult?.success === false) throw new Error(petResult.msg || '植宠列表加载失败');
      const plantPets = Array.isArray(petResult?.pets) ? petResult.pets : [];
      if (!plantPets.length) {
        this.setData({ plantPets: [], loading: false, loadError: '请先建立一份在养植宠档案' });
        return;
      }

      if (proposal && proposal.status !== 'pending') {
        this.setData({
          plantPets,
          proposalStatus: proposal.status,
          consumedTaskId: proposal.consumedTaskId || 0,
          loading: false,
          loadError: proposalUnavailableMessage(proposal.status)
        });
        return;
      }

      const form = task
        ? formFromCareTask(task)
        : (proposal
          ? formFromTaskProposal(proposal)
          : { ...this.data.form, plantPetId: this.data.form.plantPetId || plantPets[0].id });
      const plantPetIndex = Math.max(0, plantPets.findIndex((pet) => pet.id === form.plantPetId));
      if (proposal && Number(plantPets[plantPetIndex]?.id) !== Number(form.plantPetId)) {
        throw new Error('建议关联的植宠不存在、已归档或无权访问');
      }
      const taskTypeIndex = Math.max(0, TASK_TYPE_OPTIONS.findIndex((item) => item.value === form.taskType));
      const recurrenceIndex = Math.max(0, RECURRENCE_OPTIONS.findIndex((item) => item.value === form.recurrenceType));
      this.setData({
        plantPets,
        plantPetIndex,
        taskTypeIndex,
        recurrenceIndex,
        form: { ...form, plantPetId: plantPets[plantPetIndex].id },
        proposalStatus: proposal?.status || '',
        consumedTaskId: proposal?.consumedTaskId || 0,
        loading: false,
        loadError: ''
      });
    } catch (err) {
      console.error('[taskForm] load failed:', err);
      this.setData({ loading: false, loadError: err.message || '任务表单加载失败' });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/calendar/calendar' }) });
  },

  goCreatePlantPet() {
    wx.navigateTo({ url: '/pages/plantPetForm/plantPetForm' });
  },

  onPlantPetChange(e) {
    if (this.data.mode === 'proposal') return;
    const index = Number(e.detail.value) || 0;
    const pet = this.data.plantPets[index];
    if (!pet) return;
    this.setData({ plantPetIndex: index, 'form.plantPetId': pet.id });
  },

  onTaskTypeChange(e) {
    const index = Number(e.detail.value) || 0;
    const option = TASK_TYPE_OPTIONS[index] || TASK_TYPE_OPTIONS[0];
    const updates = { taskTypeIndex: index, 'form.taskType': option.value };
    if (!this.data.form.title.trim()) updates['form.title'] = `${option.label}${this.data.plantPets[this.data.plantPetIndex]?.nickname ? ` · ${this.data.plantPets[this.data.plantPetIndex].nickname}` : ''}`;
    this.setData(updates);
  },

  onTitleInput(e) { this.setData({ 'form.title': e.detail.value }); },
  onDescriptionInput(e) { this.setData({ 'form.description': e.detail.value }); },
  onDateChange(e) { this.setData({ 'form.scheduledFor': e.detail.value }); },
  onReminderToggle(e) { this.setData({ 'form.reminderEnabled': Boolean(e.detail.value) }); },
  onReminderTimeChange(e) { this.setData({ 'form.reminderTime': e.detail.value }); },

  onRecurrenceChange(e) {
    const index = Number(e.detail.value) || 0;
    const option = RECURRENCE_OPTIONS[index] || RECURRENCE_OPTIONS[0];
    this.setData({ recurrenceIndex: index, 'form.recurrenceType': option.value });
  },

  onRecurrenceIntervalInput(e) {
    this.setData({ 'form.recurrenceInterval': e.detail.value });
  },

  validateForm() {
    const form = this.data.form;
    if (!form.plantPetId) return '请选择植宠';
    if (!form.title.trim()) return '请填写任务标题';
    const interval = Number(form.recurrenceInterval);
    if (form.recurrenceType !== 'none' && (!Number.isInteger(interval) || interval < 1 || interval > 365)) {
      return '重复间隔需为 1 到 365 的整数';
    }
    return '';
  },

  buildPayload() {
    return buildTaskSubmissionPayload(this.data.mode, this.data.form, this.data.proposalKey);
  },

  previewAndSubmit() {
    if (this.data.submitting) return;
    const error = this.validateForm();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }
    const form = this.data.form;
    const pet = this.data.plantPets[this.data.plantPetIndex];
    const type = TASK_TYPE_OPTIONS[this.data.taskTypeIndex];
    const reminder = form.reminderEnabled ? form.reminderTime : '不提醒';
    const recurrence = getRecurrenceLabel(form.recurrenceType, form.recurrenceInterval);
    wx.showModal({
      title: this.data.mode === 'edit' ? '确认修改任务' : '确认养护任务',
      content: `${type.label} · ${pet.nickname}\n${form.title.trim()}\n日期 ${form.scheduledFor} · ${reminder}\n${recurrence}`,
      confirmText: this.data.mode === 'edit' ? '保存修改' : '确认创建',
      confirmColor: '#15803d',
      success: (res) => {
        if (res.confirm) this.submitTask();
      }
    });
  },

  async submitTask() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const payload = this.buildPayload();
      if (this.data.mode === 'edit') {
        await todoService.updateCareTask({ ...payload, taskId: this.data.taskId });
      } else if (this.data.mode === 'proposal') {
        await todoService.confirmCareTaskProposal(payload);
      } else {
        await todoService.createCareTask(payload);
      }
      wx.showToast({ title: this.data.mode === 'edit' ? '任务已更新' : '任务已创建', icon: 'success' });
      if (this.data.suggestionSource) wx.removeStorageSync('nvp_pending_care_task');
      setTimeout(() => this.goBack(), 450);
    } catch (err) {
      console.error('[taskForm] submit failed:', err);
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  cancelProposal() {
    if (this.data.mode !== 'proposal' || this.data.submitting) return;
    wx.showModal({
      title: '放弃这条任务建议？',
      content: '放弃后不会创建任务；如有需要，可以回到对话让 NOVA 重新生成。',
      confirmText: '确认放弃',
      confirmColor: '#b42318',
      success: async (res) => {
        if (!res.confirm || this.data.submitting) return;
        this.setData({ submitting: true });
        try {
          await todoService.cancelCareTaskProposal(this.data.proposalKey);
          wx.removeStorageSync('nvp_pending_care_task');
          wx.showToast({ title: '已放弃建议', icon: 'success' });
          setTimeout(() => this.goBack(), 450);
        } catch (err) {
          console.error('[taskForm] cancel proposal failed:', err);
          wx.showToast({ title: err.message || '取消失败', icon: 'none' });
        } finally {
          this.setData({ submitting: false });
        }
      }
    });
  }
});
