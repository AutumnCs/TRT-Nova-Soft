const app = getApp();
const plantService = require('../../services/modules/PlantService');
const plantJournalService = require('../../services/modules/PlantJournalService');
const mediaStorageService = require('../../services/modules/MediaStorageService');

const EVENT_TYPES = [
  { key: 'observation', label: '观察', icon: '🌱' },
  { key: 'photo', label: '照片', icon: '🖼️' },
  { key: 'watering', label: '浇水', icon: '💧' },
  { key: 'fertilizing', label: '施肥', icon: '🌿' },
  { key: 'pruning', label: '修剪', icon: '✂️' },
  { key: 'repotting', label: '换盆', icon: '🪴' },
  { key: 'note', label: '备忘', icon: '📝' }
];

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo().statusBarHeight || 20;
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function todayString() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getEventMeta(type) {
  return EVENT_TYPES.find((item) => item.key === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

function decorateRecord(record = {}) {
  const meta = getEventMeta(record.eventType);
  return {
    ...record,
    icon: meta.icon,
    typeLabel: meta.label,
    dateLabel: String(record.eventDate || '').replace(/-/g, '.'),
    canEdit: record.plantPetStatus === 'active',
    photos: Array.isArray(record.photos) ? record.photos : []
  };
}

function createDraft(plantPetId = 0) {
  return {
    plantPetId: Number(plantPetId) || 0,
    eventDate: todayString(),
    eventTypeIndex: 0,
    title: '',
    content: '',
    photos: []
  };
}

Page({
  data: {
    statusBarHeight: 20,
    plantPets: [],
    activePlantPets: [],
    selectedPlantPetId: 0,
    selectedPlantPetLabel: '全部植宠',
    records: [],
    loading: true,
    loadError: '',
    showComposer: false,
    editingJournalId: 0,
    eventTypeOptions: EVENT_TYPES,
    draftPlantPetIndex: 0,
    draft: createDraft(),
    saving: false,
    deletingId: 0
  },

  onLoad(options = {}) {
    this._presetPlantPetId = Number(options.plantPetId) || 0;
    this._autoCompose = options.compose === '1';
    this.setData({ statusBarHeight: getStatusBarHeight() });
  },

  onShow() {
    this.loadPage();
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  async loadPage() {
    if (!this.checkLoginStatus()) return;
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    this.setData({ loading: true, loadError: '' });
    try {
      const petResult = await plantService.listMyPlantPets({ includeArchived: true });
      if (petResult?.success === false) throw new Error(petResult.msg || '植宠列表加载失败');
      const plantPets = Array.isArray(petResult?.pets) ? petResult.pets : [];
      const activePlantPets = plantPets.filter((item) => item.status === 'active');
      const preset = this._presetPlantPetId && plantPets.some((item) => item.id === this._presetPlantPetId)
        ? this._presetPlantPetId
        : this.data.selectedPlantPetId;
      const selectedPlantPetId = plantPets.some((item) => item.id === preset) ? preset : 0;
      const selected = plantPets.find((item) => item.id === selectedPlantPetId);
      const timeline = await plantJournalService.listTimeline({ plantPetId: selectedPlantPetId || undefined, limit: 100 });
      if (timeline?.success === false) throw new Error(timeline.msg || '成长时间线加载失败');
      if (this._requestId !== requestId) return;
      this.setData({
        plantPets,
        activePlantPets,
        selectedPlantPetId,
        selectedPlantPetLabel: selected ? selected.nickname : '全部植宠',
        records: (timeline.records || []).map(decorateRecord),
        loading: false,
        loadError: ''
      });
      if (this._autoCompose && !this.data.showComposer) {
        this._autoCompose = false;
        this.showComposer();
      }
    } catch (err) {
      if (this._requestId !== requestId) return;
      console.error('[plantJournal] load failed:', err);
      this.setData({ loading: false, loadError: err.message || '成长时间线加载失败' });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },

  onChoosePlantPetFilter() {
    const itemList = ['全部植宠'].concat(this.data.plantPets.map((item) =>
      `${item.nickname}${item.status === 'archived' ? '（已归档）' : ''}`
    ));
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const pet = res.tapIndex > 0 ? this.data.plantPets[res.tapIndex - 1] : null;
        this._presetPlantPetId = pet ? pet.id : 0;
        this.setData({ selectedPlantPetId: pet ? pet.id : 0 });
        this.loadPage();
      }
    });
  },

  showComposer() {
    if (!this.data.activePlantPets.length) {
      wx.showModal({
        title: '先建立植宠档案',
        content: '成长记录必须归属于一盆在养植宠。',
        confirmText: '去建档',
        success: (res) => res.confirm && wx.navigateTo({ url: '/pages/plantPetForm/plantPetForm' })
      });
      return;
    }
    const preferredId = this.data.activePlantPets.some((item) => item.id === this.data.selectedPlantPetId)
      ? this.data.selectedPlantPetId
      : this.data.activePlantPets[0].id;
    const draftPlantPetIndex = Math.max(0, this.data.activePlantPets.findIndex((item) => item.id === preferredId));
    this.setData({
      showComposer: true,
      editingJournalId: 0,
      draftPlantPetIndex,
      draft: createDraft(preferredId)
    });
  },

  editRecord(e) {
    const journalId = Number(e.currentTarget.dataset.id) || 0;
    const record = this.data.records.find((item) => item.id === journalId);
    if (!record || !record.canEdit) return;
    const eventTypeIndex = Math.max(0, EVENT_TYPES.findIndex((item) => item.key === record.eventType));
    const draftPlantPetIndex = Math.max(0, this.data.activePlantPets.findIndex((item) => item.id === record.plantPetId));
    this.setData({
      showComposer: true,
      editingJournalId: journalId,
      draftPlantPetIndex,
      draft: {
        plantPetId: record.plantPetId,
        eventDate: record.eventDate,
        eventTypeIndex,
        title: record.title,
        content: record.content,
        photos: record.photoFileIds.map((fileId, index) => ({
          key: fileId,
          fileId,
          tempPath: '',
          displayUrl: record.photos[index] || ''
        }))
      }
    });
  },

  hideComposer() {
    if (this.data.saving) return;
    this.setData({ showComposer: false, editingJournalId: 0, draft: createDraft() });
  },

  noop() {},

  onDraftPlantPetChange(e) {
    if (this.data.editingJournalId) return;
    const index = Number(e.detail.value) || 0;
    const pet = this.data.activePlantPets[index];
    if (pet) this.setData({ draftPlantPetIndex: index, 'draft.plantPetId': pet.id });
  },

  onTypeChange(e) {
    this.setData({ 'draft.eventTypeIndex': Number(e.detail.value) || 0 });
  },

  onDateChange(e) {
    this.setData({ 'draft.eventDate': e.detail.value || todayString() });
  },

  onTitleInput(e) {
    this.setData({ 'draft.title': e.detail.value || '' });
  },

  onContentInput(e) {
    this.setData({ 'draft.content': e.detail.value || '' });
  },

  choosePhotos() {
    const remaining = 3 - this.data.draft.photos.length;
    if (remaining <= 0) {
      wx.showToast({ title: '每条最多 3 张图片', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const additions = (res.tempFilePaths || []).map((tempPath, index) => ({
          key: `temp-${Date.now()}-${index}`,
          fileId: '',
          tempPath,
          displayUrl: tempPath
        }));
        this.setData({ 'draft.photos': this.data.draft.photos.concat(additions).slice(0, 3) });
      }
    });
  },

  previewPhoto(e) {
    const current = e.currentTarget.dataset.url;
    const urls = this.data.draft.photos.map((item) => item.displayUrl).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ 'draft.photos': this.data.draft.photos.filter((item, itemIndex) => itemIndex !== index) });
  },

  previewRecordPhoto(e) {
    const journalId = Number(e.currentTarget.dataset.id) || 0;
    const current = e.currentTarget.dataset.url;
    const record = this.data.records.find((item) => item.id === journalId);
    if (record?.photos?.length) wx.previewImage({ current, urls: record.photos });
  },

  async submitRecord() {
    if (this.data.saving) return;
    const draft = this.data.draft;
    if (!draft.plantPetId) {
      wx.showToast({ title: '请选择植宠', icon: 'none' });
      return;
    }
    if (!String(draft.title || '').trim() && !String(draft.content || '').trim() && !draft.photos.length) {
      wx.showToast({ title: '写点文字或添加图片吧', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    let uploadedFileIds = [];
    const wasEditing = Boolean(this.data.editingJournalId);
    try {
      const newPaths = draft.photos.filter((item) => !item.fileId).map((item) => item.tempPath);
      uploadedFileIds = await mediaStorageService.uploadImages(newPaths, 'journal_photo', {
        plantPetId: draft.plantPetId
      });
      let uploadIndex = 0;
      const photoFileIds = draft.photos.map((item) => item.fileId || uploadedFileIds[uploadIndex++]);
      const payload = {
        plantPetId: draft.plantPetId,
        eventDate: draft.eventDate,
        eventType: EVENT_TYPES[draft.eventTypeIndex]?.key || 'note',
        title: String(draft.title || '').trim(),
        content: String(draft.content || '').trim(),
        photoFileIds
      };
      const result = this.data.editingJournalId
        ? await plantJournalService.updateRecord({ ...payload, journalId: this.data.editingJournalId })
        : await plantJournalService.createRecord(payload);
      if (result?.success === false || !result?.record) throw new Error(result?.msg || '日记保存失败');
      this.setData({ showComposer: false, editingJournalId: 0, draft: createDraft() });
      await this.loadPage();
      wx.showToast({ title: wasEditing ? '已更新' : '已记录', icon: 'success' });
    } catch (err) {
      await Promise.all(uploadedFileIds.map((fileId) => mediaStorageService.discard(fileId).catch(() => {})));
      console.error('[plantJournal] save failed:', err);
      wx.showToast({ title: err.message || '日记保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  deleteRecord(e) {
    const journalId = Number(e.currentTarget.dataset.id) || 0;
    const record = this.data.records.find((item) => item.id === journalId);
    if (!record || this.data.deletingId) return;
    wx.showModal({
      title: '删除这条成长记录？',
      content: record.photoFileIds.length ? '记录与其中的图片都会被永久删除。' : '记录删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#c33b2f',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deletingId: journalId });
        try {
          const result = await plantJournalService.deleteRecord(journalId);
          if (result?.success === false) throw new Error(result.msg || '删除失败');
          await this.loadPage();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        } finally {
          this.setData({ deletingId: 0 });
        }
      }
    });
  }
});
