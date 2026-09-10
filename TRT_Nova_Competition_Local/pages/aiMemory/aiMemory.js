const app = getApp();
const agentService = require('../../services/modules/AgentService');
const plantService = require('../../services/modules/PlantService');
const authService = require('../../services/modules/AuthService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');

const TYPE_META = Object.freeze({
  plant_fact: { label: '植宠档案事实', icon: '🌱' },
  business_event: { label: '任务 / 日记 / 观察事件', icon: '✓' },
  user_preference: { label: '用户确认偏好', icon: '♥' },
  ai_summary: { label: 'AI 摘要与推断', icon: 'AI' }
});

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

function decorateMemory(item = {}) {
  const meta = TYPE_META[item.type] || { label: '其他记忆', icon: '·' };
  const sourceLabels = {
    plant_pet: '植宠档案', care_event: '养护打卡', journal: '成长日记',
    diagnosis: '图片观察', user: '用户本人', assistant_message: 'NOVA 摘要'
  };
  return {
    ...item,
    typeLabel: meta.label,
    typeIcon: meta.icon,
    sourceLabel: sourceLabels[item.sourceType] || item.sourceType || '系统',
    timeLabel: item.sourceTime || item.updatedAt || item.createdAt || '时间未记录',
    editable: item.type === 'user_preference' && Boolean(item.userConfirmed),
    derived: ['plant_fact', 'business_event'].includes(item.type),
    legacySummary: item.type === 'ai_summary',
    sourceNavigable: ['plant_pet', 'care_event', 'journal', 'diagnosis'].includes(item.sourceType)
  };
}

function groupMemories(memories = []) {
  const groups = [
    {
      key: 'confirmed',
      title: '你明确让我记住的',
      description: '只有你确认保存的偏好；可以随时修正或删除。',
      items: memories.filter((item) => item.editable)
    },
    {
      key: 'source',
      title: '来自植宠档案与养护记录',
      description: '这些是业务记录的只读副本；修改应回到原档案、日记或任务。',
      items: memories.filter((item) => item.derived)
    },
    {
      key: 'legacy',
      title: '旧版 NOVA 对话摘要',
      description: '已停止新写入，也不会再用于回答；可删除历史摘要。',
      items: memories.filter((item) => item.legacySummary)
    }
  ];
  return groups.filter((group) => group.items.length);
}

function showEditableModal(options = {}) {
  return new Promise((resolve) => wx.showModal({ ...options, editable: true, success: resolve }));
}

Page({
  data: {
    statusBarHeight: 20,
    headerTop: 64,
    loading: true,
    loadError: '',
    memories: [],
    contextMemory: null,
    contextBusy: false,
    contextError: '',
    summaryUpdatedLabel: '',
    editingSummary: false,
    summaryDraft: '',
    summaryEditVersion: null,
    summarySaveError: '',
    summaryConflict: false,
    showLegacy: false,
    memoryGroups: [],
    plantPets: [],
    filterOptions: [{ id: 0, nickname: '全部记忆' }],
    filterIndex: 0,
    selectedPlantPetId: 0
  },

  onLoad() {
    this.setData({ statusBarHeight: getStatusBarHeight(), headerTop: getHeaderTop() });
  },

  onShow() {
    app.checkLoginStatus();
    const owner = getTokenOpenid(authService.getTokenMeta());
    this._memoryUnmounted = false;
    if (this._memoryOwner !== owner) {
      this._memoryOwner = owner;
      this.setData({ contextMemory: null, contextBusy: false, contextError: '', memories: [], memoryGroups: [], plantPets: [], selectedPlantPetId: 0, showLegacy: false,
        editingSummary: false, summaryDraft: '', summaryEditVersion: null, summarySaveError: '', summaryConflict: false, summaryUpdatedLabel: '' });
    }
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return;
    }
    this.loadContext();
  },

  onUnload() { this._memoryUnmounted = true; },

  isCurrentMemoryOwner(owner) {
    return Boolean(owner && !this._memoryUnmounted && owner === this._memoryOwner && owner === getTokenOpenid(authService.getTokenMeta()));
  },

  async loadContext() {
    const owner = this._memoryOwner;
    this.setData({ loading: true, loadError: '' });
    await this.loadContextMemory();
    if (!this.isCurrentMemoryOwner(owner)) return;
    try {
      const pets = await plantService.listMyPlantPets({ includeArchived: true });
      if (!this.isCurrentMemoryOwner(owner)) return;
      const plantPets = Array.isArray(pets?.pets) ? pets.pets : [];
      const filterOptions = [{ id: 0, nickname: '全部记忆' }].concat(plantPets);
      const currentIndex = Math.max(0, filterOptions.findIndex((item) => item.id === this.data.selectedPlantPetId));
      this.setData({ plantPets, filterOptions, filterIndex: currentIndex });
      await this.loadMemories();
    } catch (err) {
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.setData({ loading: false, loadError: err.message || 'AI 记忆加载失败' });
    }
  },

  async loadContextMemory() {
    const owner = this._memoryOwner;
    if (!this.isCurrentMemoryOwner(owner)) return;
    try {
      const result = await agentService.contextMemory();
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.applyContextMemory(result.memory);
    } catch (error) {
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.setData({ contextError: error.message || '记忆摘要暂时无法加载' });
    }
  },

  toggleLegacy() {
    this.setData({ showLegacy: !this.data.showLegacy });
  },

  applyContextMemory(memory) {
    const date = memory?.updatedAt ? new Date(memory.updatedAt) : null;
    const label = date && !Number.isNaN(date.getTime())
      ? `更新于 ${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
    this.setData({ contextMemory: memory, contextError: '', summaryUpdatedLabel: label });
  },

  openSummaryMenu() {
    if (this.data.contextBusy || this.data.editingSummary || !this.data.contextMemory) return;
    const owner = this._memoryOwner;
    wx.showActionSheet({
      itemList: ['编辑摘要', this.data.contextMemory.enabled ? '关闭自动记忆' : '开启自动记忆', '清除摘要'],
      success: result => {
        if (!this.isCurrentMemoryOwner(owner)) return;
        if (result.tapIndex === 0) this.startSummaryEdit();
        if (result.tapIndex === 1) this.toggleContextMemory();
        if (result.tapIndex === 2) this.forgetContextFact({ currentTarget: { dataset: {} } });
      }
    });
  },

  startSummaryEdit() {
    if (this.data.contextBusy || !this.data.contextMemory) return;
    this.setData({
      editingSummary: true, summaryDraft: this.data.contextMemory.summary || '',
      summaryEditVersion: this.data.contextMemory.version, summarySaveError: '', summaryConflict: false
    });
  },

  onSummaryInput(event) { this.setData({ summaryDraft: event.detail.value }); },

  cancelSummaryEdit() {
    if (this.data.contextBusy) return;
    this.setData({ editingSummary: false, summaryDraft: '', summaryEditVersion: null, summarySaveError: '', summaryConflict: false });
  },

  // A concurrent chat may change the summary. Keep the draft and require review
  // of the refreshed version instead of silently overwriting the new memory.
  reviewSummaryConflict() {
    this.setData({ summaryConflict: false, summaryEditVersion: this.data.contextMemory.version, summarySaveError: '' });
  },

  async saveSummary() {
    const owner = this._memoryOwner;
    if (!this.isCurrentMemoryOwner(owner) || !this.data.editingSummary || this.data.contextBusy || this.data.summaryConflict) return;
    this.setData({ contextBusy: true, summarySaveError: '' });
    try {
      const result = await agentService.contextMemory({
        action: 'replace_summary', summary: this.data.summaryDraft, version: this.data.summaryEditVersion
      });
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.applyContextMemory(result.memory);
      this.setData({ editingSummary: false, summaryDraft: '', summaryEditVersion: null });
      wx.showToast({ title: '摘要已保存', icon: 'success' });
    } catch (error) {
      if (!this.isCurrentMemoryOwner(owner)) return;
      const message = error.message || '保存失败，请稍后重试';
      const conflict = error.statusCode === 409 || /记忆.*变化/.test(message);
      if (conflict) await this.loadContextMemory();
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.setData({ summarySaveError: message, summaryConflict: conflict });
    } finally {
      if (this.isCurrentMemoryOwner(owner)) this.setData({ contextBusy: false });
    }
  },

  async changeContextMemory(payload, owner = this._memoryOwner) {
    if (!this.isCurrentMemoryOwner(owner) || this.data.contextBusy || !this.data.contextMemory) return;
    this.setData({ contextBusy: true });
    try {
      const result = await agentService.contextMemory({ ...payload, version: this.data.contextMemory.version });
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.applyContextMemory(result.memory);
    } catch (error) {
      if (!this.isCurrentMemoryOwner(owner)) return;
      wx.showToast({ title: error.message || '修改失败', icon: 'none' });
      await this.loadContextMemory();
    } finally { if (this.isCurrentMemoryOwner(owner)) this.setData({ contextBusy: false }); }
  },

  toggleContextMemory() {
    if (this.data.contextBusy || !this.data.contextMemory) return;
    const owner = this._memoryOwner;
    const enabled = this.data.contextMemory.enabled;
    wx.showModal({
      title: enabled ? '关闭跨会话记忆？' : '开启自动记忆摘要？',
      content: enabled
        ? '关闭后不会再读取或更新跨会话摘要，已有摘要保留供你查看或清除。每个会话自己的历史仍然可用。'
        : '开启后，NOVA 会在每轮对话结束时自动整理你表达的昵称、互动偏好和园艺兴趣，用于以后的新对话。不会逐条弹确认卡。你可以随时修正、清除或关闭；请勿提供真实姓名、电话、地址或密码等敏感信息。不会修改任务和植宠档案。',
      confirmText: enabled ? '关闭' : '同意开启',
      success: result => {
        if (!this.isCurrentMemoryOwner(owner)) return;
        if (result.confirm) this.changeContextMemory({ action: enabled ? 'disable' : 'enable', consent: true }, owner);
        else this.setData({ 'contextMemory.enabled': enabled });
      }
    });
  },

  async editContextFact(e) {
    const owner = this._memoryOwner;
    const key = e.currentTarget.dataset.key;
    const fact = this.data.contextMemory?.facts.find(item => item.key === key);
    if (!fact) return;
    const result = await showEditableModal({ title: '修正摘要', content: fact.content, confirmText: '保存' });
    if (result.confirm) await this.changeContextMemory({ action: 'edit', key, content: result.content }, owner);
  },

  forgetContextFact(e) {
    const owner = this._memoryOwner;
    const key = e.currentTarget.dataset.key || '';
    wx.showModal({
      title: key ? '忘记这条摘要？' : '清除跨会话摘要？',
      content: '清除后不会从旧对话自动重新提取。原对话仍保留，同一会话仍可引用其历史；如果你以后再次表达这个偏好，开启的自动记忆可能重新记下。',
      confirmText: '清除',
      success: result => { if (result.confirm) this.changeContextMemory({ action: 'forget', key }, owner); }
    });
  },

  async loadMemories() {
    const owner = this._memoryOwner;
    try {
      const result = await agentService.listMemories({ plantPetId: this.data.selectedPlantPetId || undefined });
      if (!this.isCurrentMemoryOwner(owner)) return;
      const memories = (result.memories || []).map(decorateMemory);
      this.setData({ memories, memoryGroups: groupMemories(memories), loading: false, loadError: '' });
    } catch (err) {
      if (!this.isCurrentMemoryOwner(owner)) return;
      this.setData({ memories: [], memoryGroups: [], loading: false, loadError: err.message || 'AI 记忆加载失败' });
    }
  },

  async onFilterChange(e) {
    const filterIndex = Number(e.detail.value) || 0;
    const selectedPlantPetId = Number(this.data.filterOptions[filterIndex]?.id) || 0;
    this.setData({ filterIndex, selectedPlantPetId, loading: true });
    await this.loadMemories();
  },

  async addPreference() {
    const result = await showEditableModal({
      title: '添加由你确认的偏好',
      content: '例如：我习惯周末集中检查植物。NOVA 只会保存你确认提交的文字。',
      placeholderText: '输入希望 NOVA 记住的偏好',
      confirmText: '确认保存'
    });
    const content = String(result.content || '').trim();
    if (!result.confirm || !content) return;
    try {
      await agentService.createMemory({ content, plantPetId: this.data.selectedPlantPetId || undefined });
      wx.showToast({ title: '偏好已保存', icon: 'success' });
      await this.loadMemories();
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async editMemory(e) {
    const memory = this.data.memories.find((item) => item.id === Number(e.currentTarget.dataset.id));
    if (!memory?.editable) {
      wx.showToast({ title: '请到原始档案或记录中修改', icon: 'none' });
      return;
    }
    const result = await showEditableModal({
      title: '修正这条 AI 记忆',
      content: memory.content,
      placeholderText: '输入修正后的内容',
      confirmText: '确认修正'
    });
    const content = String(result.content || '').trim();
    if (!result.confirm || !content) return;
    try {
      await agentService.updateMemory({ memoryId: memory.id, content });
      wx.showToast({ title: '记忆已修正', icon: 'success' });
      await this.loadMemories();
    } catch (err) {
      wx.showToast({ title: err.message || '修正失败', icon: 'none' });
    }
  },

  openMemorySource(e) {
    const memory = this.data.memories.find((item) => item.id === Number(e.currentTarget.dataset.id));
    if (!memory?.sourceNavigable) return;
    const plantPetId = Number(memory.plantPetId) || 0;
    if (memory.sourceType === 'plant_pet' && plantPetId) {
      wx.navigateTo({ url: `/pages/plantPetForm/plantPetForm?plantPetId=${plantPetId}` });
      return;
    }
    if (memory.sourceType === 'journal') {
      wx.navigateTo({ url: `/pages/plantJournal/plantJournal${plantPetId ? `?plantPetId=${plantPetId}` : ''}` });
      return;
    }
    if (memory.sourceType === 'care_event') {
      wx.switchTab({ url: '/pages/calendar/calendar' });
      return;
    }
    if (plantPetId) wx.navigateTo({ url: `/pages/plantPetDetail/plantPetDetail?plantPetId=${plantPetId}` });
  },

  deleteMemory(e) {
    const memory = this.data.memories.find((item) => item.id === Number(e.currentTarget.dataset.id));
    if (!memory) return;
    wx.showModal({
      title: '删除这条 AI 记忆？',
      content: '只删除这条记忆，不会删除它所引用的植宠档案、任务、日记或观察记录。若来源业务记录仍存在，之后可能重新生成派生记忆。',
      confirmText: '确认删除',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await agentService.deleteMemory(memory.id);
          await this.loadMemories();
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  clearAllMemories() {
    const selectedPlantPet = this.data.filterOptions[this.data.filterIndex];
    const selectedPlantPetId = Number(this.data.selectedPlantPetId) || 0;
    wx.showModal({
      title: selectedPlantPetId ? `清除 ${selectedPlantPet.nickname} 的 AI 记忆？` : '清除全部 AI 记忆？',
      content: `${selectedPlantPetId ? '只清除当前筛选植宠' : '清除当前账号'}的结构化 AI 记忆，不会删除植宠档案、任务、日记、图片观察或最近对话。仍存在的业务事实会在后续对话中重新生成派生记忆。`,
      confirmText: '全部清除',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await agentService.clearMemories({ plantPetId: selectedPlantPetId || undefined });
          wx.showToast({ title: `已清除 ${result.deleted || 0} 条`, icon: 'none' });
          await this.loadMemories();
        } catch (err) {
          wx.showToast({ title: err.message || '清除失败', icon: 'none' });
        }
      }
    });
  },

  goBack() {
    if (this.data.contextBusy) return;
    const leave = () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
    if (!this.data.editingSummary || this.data.summaryDraft === (this.data.contextMemory?.summary || '')) return leave();
    wx.showModal({ title: '放弃尚未保存的修改？', content: '原来的摘要不会改变。', confirmText: '放弃修改',
      success: result => { if (result.confirm) leave(); } });
  }
});
