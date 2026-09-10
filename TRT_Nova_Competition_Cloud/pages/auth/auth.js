const app = getApp();
const userProfileService = require('../../services/modules/UserProfileService');
const authService = require('../../services/modules/AuthService');
const mediaStorageService = require('../../services/modules/MediaStorageService');
const { isDevPhoneLoginEnabled } = require('./auth-state');
const {
  getTokenOpenid,
  isProfileForActiveOpenid
} = require('../../services/modules/auth-session-state');

const defaultAvatarUrl =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

Page({
  data: {
    statusBarHeight: 20,
    loginState: 'choose',
    transitioning: false,
    userInfo: { avatarUrl: defaultAvatarUrl, avatarFileId: '', nickName: '' },
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
      devPhoneLoginEnabled: isDevPhoneLoginEnabled(app.globalData.runtimeConfig)
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
    app.globalData.userInfo = null;
    app.globalData.hasLogin = true;

    let profile = null;
    try {
      profile = await userProfileService.getMyProfile();
      if (profile && !isProfileForActiveOpenid(profile, openid, authService.getTokenMeta())) {
        profile = null;
      }
    } catch (err) {
      profile = null;
    }

    if (getTokenOpenid(authService.getTokenMeta()) !== openid) {
      throw new Error('登录身份已变化');
    }

    this.setData({
      loginState: 'wechat-profile',
      saving: false,
      userInfo: {
        avatarUrl: profile?.avatarUrl || defaultAvatarUrl,
        avatarFileId: profile?.avatarFileId || '',
        nickName: profile?.nickName || ''
      }
    });
    this._updateCanSave();
  },

  onUseCustomProfile() {
    this.setData({
      userInfo: { avatarUrl: defaultAvatarUrl, avatarFileId: '', nickName: '' },
      canSave: false
    });
  },

  onChooseAvatar(e) {
    if (this.data.saving) return;
    const avatarUrl = e && e.detail ? e.detail.avatarUrl : '';
    if (!avatarUrl) return;
    // Native selection changes only the avatar; cancellation never resets the profile draft.
    this.setData({ 'userInfo.avatarUrl': avatarUrl, 'userInfo.avatarFileId': '' });
    this._updateCanSave();
  },

  onPickAvatar() {
    if (this.data.saving) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = (res.tempFilePaths || [])[0] || '';
        this.onChooseAvatar({ detail: { avatarUrl: filePath } });
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

    let uploadedAvatarFileId = '';
    try {
      const openid = this._openid || '';
      let avatarFileId = this.data.userInfo.avatarFileId || '';
      if (!avatarFileId) {
        avatarFileId = await mediaStorageService.uploadImage(
          this.data.userInfo.avatarUrl,
          'profile_avatar',
          { owner: openid }
        );
        uploadedAvatarFileId = avatarFileId;
      }

      const nickName = this.data.userInfo.nickName;
      const savedProfile = await userProfileService.saveMyProfile({
        nickName,
        avatarFileId,
        avatarUrl: String(avatarFileId).startsWith('https://') ? avatarFileId : ''
      });

      const userInfo = {
        avatarUrl: savedProfile?.avatarUrl || this.data.userInfo.avatarUrl,
        avatarFileId,
        nickName,
        openId: openid,
        openid,
        loginTime: Date.now()
      };
      wx.setStorageSync('userInfo', userInfo);
      app.globalData.userInfo = userInfo;
      this._goHome();
    } catch (err) {
      if (uploadedAvatarFileId) await mediaStorageService.discard(uploadedAvatarFileId).catch(() => {});
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
    if (this.data.transitioning) return;
    this.setData({ transitioning: true }, () => {
      wx.switchTab({
        url: '/pages/index/index',
        fail: () => this.setData({ transitioning: false })
      });
    });
  }
});
