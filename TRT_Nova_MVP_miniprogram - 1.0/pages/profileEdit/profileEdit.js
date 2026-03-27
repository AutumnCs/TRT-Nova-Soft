const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');

const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

Page({
  data: {
    statusBarHeight: 20,
    form: {
      avatarUrl: defaultAvatarUrl,
      nickName: '',
      gender: 0,
      birthday: '',
      region: [],
      experienceLevel: '',
      signature: '',
      phone: '',
      email: ''
    },
    genderOptions: [
      { label: '保密', value: 0 },
      { label: '男', value: 1 },
      { label: '女', value: 2 }
    ],
    experienceOptions: ['新手', '进阶', '专家'],
    genderIndex: 0,
    experienceIndex: 0,
    saving: false
  },

  onLoad: function() {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight });

    this.checkLoginStatus();
    this.initFormFromLocal();
    this.loadProfileFromCloud();
  },

  /**
   * 检查登录状态（未登录则跳转到认证页）
   * @returns {boolean}
   */
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

  /**
   * 从本地登录信息初始化表单基础字段（昵称、头像）
   */
  initFormFromLocal: function() {
    const { userInfo } = app.globalData;
    if (!userInfo) return;
    this.setData({
      'form.nickName': userInfo.nickName || '',
      'form.avatarUrl': userInfo.avatarUrl || defaultAvatarUrl
    });
  },

  /**
   * 从云端加载资料并回填表单
   */
  loadProfileFromCloud: async function() {
    if (!this.checkLoginStatus()) return;

    try {
      const profile = await userProfileService.getMyProfile();
      if (!profile) return;

      const genderIndex = this.getGenderIndex(profile.gender);
      const experienceIndex = this.getExperienceIndex(profile.experienceLevel);

      this.setData({
        form: {
          ...this.data.form,
          avatarUrl: profile.avatarUrl || this.data.form.avatarUrl,
          nickName: profile.nickName || this.data.form.nickName,
          gender: typeof profile.gender === 'number' ? profile.gender : 0,
          birthday: profile.birthday || '',
          region: Array.isArray(profile.region) ? profile.region : [],
          experienceLevel: profile.experienceLevel || '',
          signature: profile.signature || '',
          phone: profile.phone || '',
          email: profile.email || ''
        },
        genderIndex,
        experienceIndex
      });
    } catch (err) {
      wx.showToast({ title: '资料加载失败', icon: 'none' });
    }
  },

  /**
   * 选择头像
   * @param {Object} e
   */
  onChooseAvatar: function(e) {
    const avatarUrl = e && e.detail ? e.detail.avatarUrl : '';
    if (!avatarUrl) return;
    this.setData({ 'form.avatarUrl': avatarUrl });
  },

  /**
   * 昵称输入
   * @param {Object} e
   */
  onNickNameChange: function(e) {
    this.setData({ 'form.nickName': e.detail.value });
  },

  /**
   * 性别选择
   * @param {Object} e
   */
  onGenderChange: function(e) {
    const index = Number(e.detail.value) || 0;
    const option = this.data.genderOptions[index] || this.data.genderOptions[0];
    this.setData({
      genderIndex: index,
      'form.gender': option.value
    });
  },

  /**
   * 地区选择
   * @param {Object} e
   */
  onRegionChange: function(e) {
    const region = e.detail.value || [];
    this.setData({ 'form.region': region });
  },

  /**
   * 生日选择
   * @param {Object} e
   */
  onBirthdayChange: function(e) {
    this.setData({ 'form.birthday': e.detail.value || '' });
  },

  /**
   * 经验等级选择
   * @param {Object} e
   */
  onExperienceChange: function(e) {
    const index = Number(e.detail.value) || 0;
    const level = this.data.experienceOptions[index] || '';
    this.setData({
      experienceIndex: index,
      'form.experienceLevel': level
    });
  },

  /**
   * 个性签名输入
   * @param {Object} e
   */
  onSignatureInput: function(e) {
    this.setData({ 'form.signature': e.detail.value });
  },

  /**
   * 手机号输入（手动填写，不走微信手机号能力）
   * @param {Object} e
   */
  onPhoneInput: function(e) {
    this.setData({ 'form.phone': e.detail.value });
  },

  /**
   * 邮箱输入
   * @param {Object} e
   */
  onEmailInput: function(e) {
    this.setData({ 'form.email': e.detail.value });
  },

  /**
   * 保存资料到云端，同时同步本地昵称/头像用于页面展示
   */
  onSave: async function() {
    if (this.data.saving) return;
    if (!this.checkLoginStatus()) return;

    const nickName = (this.data.form.nickName || '').trim();
    if (!nickName) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      await userProfileService.saveMyProfile({
        ...this.data.form,
        nickName
      });

      const oldUserInfo = wx.getStorageSync('userInfo') || {};
      const newUserInfo = {
        ...oldUserInfo,
        nickName,
        avatarUrl: this.data.form.avatarUrl || oldUserInfo.avatarUrl
      };
      wx.setStorageSync('userInfo', newUserInfo);
      app.globalData.userInfo = newUserInfo;
      app.globalData.hasLogin = true;

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 计算 gender 对应的 selector index
   * @param {number} gender
   * @returns {number}
   */
  getGenderIndex: function(gender) {
    const idx = this.data.genderOptions.findIndex(o => o.value === gender);
    return idx >= 0 ? idx : 0;
  },

  /**
   * 计算经验等级对应的 selector index
   * @param {string} level
   * @returns {number}
   */
  getExperienceIndex: function(level) {
    const idx = this.data.experienceOptions.findIndex(v => v === level);
    return idx >= 0 ? idx : 0;
  }
});

