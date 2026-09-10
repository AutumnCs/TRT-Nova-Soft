const app = getApp();
const authService = require('../../services/modules/AuthService');
const plantService = require('../../services/modules/PlantService');
const mediaStorageService = require('../../services/modules/MediaStorageService');
const agentService = require('../../services/modules/AgentService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const { DEFAULT_PLANT_IMAGE } = require('../index/plant-pet-state');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function todayString() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createEmptyForm() {
  return {
    nickname: '',
    plantLibraryId: null,
    speciesName: '',
    coverUrl: '',
    coverFileId: '',
    enteredAt: todayString(),
    location: '',
    careNotes: ''
  };
}

Page({
  data: {
    statusBarHeight: 20,
    mode: 'create',
    pageTitle: '新建植宠档案',
    plantPetId: 0,
    speciesList: [],
    selectedLibraryId: 0,
    form: createEmptyForm(),
    coverPreview: DEFAULT_PLANT_IMAGE,
    coverChanged: false,
    defaultPlantImage: DEFAULT_PLANT_IMAGE,
    libraryError: '',
    loading: true,
    loadError: '',
    submitting: false
  },

  onLoad(options = {}) {
    const plantPetId = Number(options.plantPetId) || 0;
    this._pendingVision = options.fromVision ? wx.getStorageSync('nvp_pending_vision_plant') : null;
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      mode: plantPetId ? 'edit' : 'create',
      pageTitle: plantPetId ? '编辑植宠档案' : '新建植宠档案',
      plantPetId
    });
    this.initialize();
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

  async initialize() {
    if (!this.checkLoginStatus()) return;
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    this.setData({ loading: true, loadError: '', libraryError: '' });

    let speciesList = [];
    let libraryError = '';
    try {
      const libraryResult = await plantService.getPlants({ useCache: false });
      speciesList = (libraryResult?.plants || []).map((plant) => ({
        id: Number(plant.id) || 0,
        name: plant.name || '',
        image: plant.image || DEFAULT_PLANT_IMAGE
      })).filter((plant) => plant.id && plant.name);
    } catch (err) {
      console.error('[plantPetForm] load library failed:', err);
      libraryError = '植物库暂时不可用，仍可按未知品种手动建档。';
    }

    let form = createEmptyForm();
    let coverPreview = DEFAULT_PLANT_IMAGE;
    let coverChanged = false;
    let selectedLibraryId = 0;
    try {
      if (this.data.mode === 'edit') {
        const detail = await plantService.getMyPlantPet(this.data.plantPetId);
        if (detail?.success === false || !detail?.pet) {
          throw new Error(detail?.msg || '植宠档案不存在');
        }
        if (detail.pet.ownerOpenid !== expectedOpenid) {
          throw new Error('植宠档案归属异常，请重新登录');
        }
        const pet = detail.pet;
        selectedLibraryId = Number(pet.plantLibraryId) || 0;
        form = {
          nickname: pet.nickname || '',
          plantLibraryId: selectedLibraryId || null,
          speciesName: selectedLibraryId ? '' : (pet.isUnknownSpecies ? '' : pet.speciesName || ''),
          coverUrl: pet.customCoverUrl || '',
          coverFileId: pet.coverFileId || '',
          enteredAt: pet.enteredAt || '',
          location: pet.location || '',
          careNotes: pet.careNotes || ''
        };
        coverPreview = pet.coverUrl || DEFAULT_PLANT_IMAGE;
      } else if (this._pendingVision && typeof this._pendingVision === 'object') {
        const candidateName = String(this._pendingVision.speciesName || '').trim();
        const matched = speciesList.find((plant) =>
          plant.name === candidateName || plant.name.includes(candidateName) || candidateName.includes(plant.name)
        );
        selectedLibraryId = Number(matched?.id) || 0;
        form = {
          ...form,
          nickname: String(this._pendingVision.nickname || '').trim().slice(0, 64),
          plantLibraryId: selectedLibraryId || null,
          speciesName: selectedLibraryId ? '' : candidateName.slice(0, 128)
        };
        if (this._pendingVision.coverTempPath) {
          coverPreview = this._pendingVision.coverTempPath;
          coverChanged = true;
        }
      }
    } catch (err) {
      if (this._loadRequestId !== requestId) return;
      this.setData({
        speciesList,
        libraryError,
        loading: false,
        loadError: err.message || '档案加载失败'
      });
      return;
    }

    if (
      this._loadRequestId !== requestId ||
      getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
    ) return;
    this.setData({
      speciesList,
      libraryError,
      selectedLibraryId,
      form,
      coverPreview,
      coverChanged,
      loading: false,
      loadError: ''
    });
  },

  onSelectSpecies(e) {
    const plantLibraryId = Number(e.currentTarget.dataset.id) || 0;
    const selected = this.data.speciesList.find((item) => item.id === plantLibraryId);
    this.setData({
      selectedLibraryId: plantLibraryId,
      'form.plantLibraryId': plantLibraryId || null,
      'form.speciesName': plantLibraryId ? '' : this.data.form.speciesName,
      coverPreview: this.data.coverChanged || this.data.form.coverFileId
        ? this.data.coverPreview
        : (this.data.form.coverUrl || selected?.image || DEFAULT_PLANT_IMAGE)
    });
  },

  onNicknameInput(e) {
    this.setData({ 'form.nickname': e.detail.value || '' });
  },

  onSpeciesNameInput(e) {
    this.setData({
      selectedLibraryId: 0,
      'form.plantLibraryId': null,
      'form.speciesName': e.detail.value || ''
    });
  },

  onCoverUrlInput(e) {
    const coverUrl = (e.detail.value || '').trim();
    const selected = this.data.speciesList.find((item) => item.id === this.data.selectedLibraryId);
    this.setData({
      'form.coverUrl': coverUrl,
      'form.coverFileId': '',
      coverChanged: false,
      coverPreview: coverUrl || selected?.image || DEFAULT_PLANT_IMAGE
    });
  },

  onChooseCover() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = (res.tempFilePaths || [])[0] || '';
        if (!filePath) return;
        this.setData({
          coverPreview: filePath,
          coverChanged: true,
          'form.coverFileId': '',
          'form.coverUrl': ''
        });
      }
    });
  },

  onCoverImageError() {
    this.setData({ coverPreview: DEFAULT_PLANT_IMAGE });
  },

  onEnteredAtChange(e) {
    this.setData({ 'form.enteredAt': e.detail.value || '' });
  },

  onLocationInput(e) {
    this.setData({ 'form.location': e.detail.value || '' });
  },

  onCareNotesInput(e) {
    this.setData({ 'form.careNotes': e.detail.value || '' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  async submitForm() {
    if (!this.checkLoginStatus() || this.data.submitting) return;
    const nickname = (this.data.form.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请给植宠起个名字', icon: 'none' });
      return;
    }

    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    let uploadedCoverFileId = '';
    const payload = {
      ...this.data.form,
      nickname,
      plantLibraryId: this.data.selectedLibraryId || null,
      speciesName: this.data.selectedLibraryId ? '' : (this.data.form.speciesName || '').trim(),
      coverUrl: (this.data.form.coverUrl || '').trim(),
      location: (this.data.form.location || '').trim(),
      careNotes: (this.data.form.careNotes || '').trim()
    };
    if (this.data.mode === 'edit') payload.plantPetId = this.data.plantPetId;

    this.setData({ submitting: true });
    try {
      if (this.data.coverChanged) {
        uploadedCoverFileId = await mediaStorageService.uploadImage(this.data.coverPreview, 'plant_cover', {
          owner: expectedOpenid,
          plantPetId: this.data.mode === 'edit' ? this.data.plantPetId : undefined
        });
        payload.coverFileId = uploadedCoverFileId;
      } else {
        payload.coverFileId = this.data.form.coverFileId || '';
      }
      const result = this.data.mode === 'edit'
        ? await plantService.updatePlantPet(payload)
        : await plantService.createPlantPet(payload);
      if (result?.success === false || !result?.pet) {
        throw new Error(result?.msg || '档案保存失败');
      }
      if (
        result.pet.ownerOpenid !== expectedOpenid ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) {
        throw new Error('登录身份已变化，请重新操作');
      }

      let visionRecordSaved = false;
      if (this.data.mode === 'create' && this._pendingVision?.analysis && this._pendingVision?.coverTempPath) {
        let diagnosisFileId = '';
        try {
          diagnosisFileId = await mediaStorageService.uploadImage(
            this._pendingVision.coverTempPath,
            'diagnosis_image',
            { plantPetId: result.pet.id }
          );
          await agentService.saveDiagnosis({
            plantPetId: result.pet.id,
            mediaFileId: diagnosisFileId,
            analysis: this._pendingVision.analysis,
            modelVersion: this._pendingVision.modelVersion || ''
          });
          visionRecordSaved = true;
        } catch (visionError) {
          if (diagnosisFileId) await mediaStorageService.discard(diagnosisFileId).catch(() => {});
          console.warn('[plantPetForm] diagnosis save after assisted create failed:', visionError.message);
        }
        wx.removeStorageSync('nvp_pending_vision_plant');
        this._pendingVision = null;
      }
      wx.showToast({
        title: this.data.mode === 'edit' ? '档案已更新' : (visionRecordSaved ? '档案与观察已保存' : '档案已建立'),
        icon: 'success'
      });
      setTimeout(() => {
        if (this.data.mode === 'edit') {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
          return;
        }
        wx.redirectTo({
          url: `/pages/plantPetDetail/plantPetDetail?plantPetId=${result.pet.id}`
        });
      }, 500);
    } catch (err) {
      if (uploadedCoverFileId) await mediaStorageService.discard(uploadedCoverFileId).catch(() => {});
      console.error('[plantPetForm] submit failed:', err);
      wx.showToast({ title: err.message || '档案保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
