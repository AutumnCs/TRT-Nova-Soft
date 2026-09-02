const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');
const authService = require('../../services/modules/AuthService');
const cloudStorageService = require('../../services/modules/CloudStorageService');
const { isDevPhoneLoginEnabled } = require('./auth-state');
const themeBehavior = require('../../services/modules/ThemeBehavior');

const defaultAvatarUrl =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  behaviors: [themeBehavior],

  onShow() {
    this.syncTheme();
  },

  data: {
    statusBarHeight: 20,
    loginState: 'choose',
    transitioning: false,
    userInfo: { avatarUrl: defaultAvatarUrl, nickName: '' },
    defaultAvatarUrl,
    phone: '',
    saving: false,
    canSave: false,
    isApp: false,
    devPhoneLoginEnabled: false
  },

  onLoad() {
    const isApp = typeof wx.weixinMiniProgramLogin === 'function';
    this.setData({
      statusBarHeight: isApp ? 0 : getStatusBarHeight(),
      loginState: 'choose',
      isApp,
      devPhoneLoginEnabled: isDevPhoneLoginEnabled(app.globalData.runtimeConfig),
      theme: app.globalData.theme || 'light'
    });
  },

  async onWeixinLogin() {
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      const tokenMeta = await authService.loginWithScf();
      await this._handleWechatAuthSuccess(tokenMeta);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: '微信登录失败，请重试', icon: 'none', duration: 1800 });
    }
  },

  async _handleWechatAuthSuccess(tokenMeta) {
    const openid = tokenMeta?.openid || '';
    if (!openid) throw new Error('无法获取 openid');
    this._openid = openid;
    app.globalData.hasLogin = true;

    let profile = null;
    try {
      profile = await userProfileService.getMyProfile();
    } catch (err) {
      profile = null;
    }

    this.setData({
      loginState: 'wechat-profile',
      saving: false,
      userInfo: {
        avatarUrl: profile?.avatarUrl || defaultAvatarUrl,
        nickName: profile?.nickName || ''
      }
    });
    this._updateCanSave();
  },

  async onUseWechatProfile() {
    if (this.data.saving) return;
    if (typeof wx.getUserProfile !== 'function') {
      wx.showToast({ title: '请手动选择头像和昵称', icon: 'none' });
      return;
    }

    try {
      const res = await wx.getUserProfile({ desc: '用于展示账号头像和昵称' });
      const wxUserInfo = res?.userInfo || {};
      this.setData({
        userInfo: {
          avatarUrl: wxUserInfo.avatarUrl || defaultAvatarUrl,
          nickName: wxUserInfo.nickName || ''
        }
      });
      this._updateCanSave();
    } catch (err) {
      wx.showToast({ title: '请手动选择头像和昵称', icon: 'none' });
    }
  },

  onUseCustomProfile() {
    this.setData({
      userInfo: { avatarUrl: defaultAvatarUrl, nickName: '' },
      canSave: false
    });
  },

  onChooseAvatar(e) {
    const avatarUrl = e && e.detail ? e.detail.avatarUrl : '';
    if (!avatarUrl) return;
    this.setData({ 'userInfo.avatarUrl': avatarUrl });
    this._updateCanSave();
  },

  onPickAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = (res.tempFilePaths || [])[0] || '';
        if (filePath) {
          this.setData({ 'userInfo.avatarUrl': filePath });
          this._updateCanSave();
        }
      }
    });
  },

  onNickNameChange(e) {
    this.setData({ 'userInfo.nickName': (e.detail.value || '').trim() });
    this._updateCanSave();
  },

  _updateCanSave() {
    const { avatarUrl, nickName } = this.data.userInfo;
    this.setData({
      canSave: Boolean(nickName && avatarUrl && avatarUrl !== defaultAvatarUrl)
    });
  },

  async onSaveProfile() {
    if (!this.data.canSave || this.data.saving) return;
    this.setData({ saving: true });

    try {
      const openid = this._openid || '';
      let avatarUrl = this.data.userInfo.avatarUrl;
      try {
        avatarUrl = await cloudStorageService.uploadAvatar(avatarUrl, openid);
      } catch (err) {
        // Cloud storage is optional in the current SCF-first runtime.
      }

      const nickName = this.data.userInfo.nickName;
      await userProfileService.saveMyProfile({ nickName, avatarUrl });

      const userInfo = { avatarUrl, nickName, openId: openid, openid, loginTime: Date.now() };
      wx.setStorageSync('userInfo', userInfo);
      app.globalData.userInfo = userInfo;
      this._goHome();
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  showPhoneLogin() {
    if (!this.data.devPhoneLoginEnabled) return;
    this.setData({ loginState: 'phone-login', phone: '', saving: false });
  },

  onPhoneInput(e) {
    this.setData({ phone: (e.detail.value || '').replace(/\D/g, '').slice(0, 11) });
  },

  onPhoneLogin() {
    if (!this.data.devPhoneLoginEnabled) return;
    if (this.data.saving) return;
    const phone = this.data.phone;
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' });
      return;
    }

    const userInfo = {
      openId: `phone_${phone}`,
      openid: `phone_${phone}`,
      nickName: `用户${phone.slice(-4)}`,
      avatarUrl: defaultAvatarUrl,
      phone,
      loginType: 'phone',
      loginTime: Date.now()
    };

    wx.setStorageSync('userInfo', userInfo);
    app.globalData.userInfo = userInfo;
    app.globalData.hasLogin = true;
    this._goHome();
  },

  backToChoose() {
    this.setData({
      loginState: 'choose',
      saving: false,
      phone: ''
    });
  },

  _goHome() {
    this.setData({ transitioning: true });
    setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 800);
  }
});
