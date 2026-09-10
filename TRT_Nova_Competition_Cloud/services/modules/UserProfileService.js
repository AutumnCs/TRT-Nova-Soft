const ScfApiAdapter = require('../core/ScfApiAdapter');
const authService = require('./AuthService');
const mediaStorageService = require('./MediaStorageService');

const scfApi = new ScfApiAdapter();

class UserProfileService {
  async getMyOpenid() {
    try {
      const tokenMeta = authService.getTokenMeta();
      if (tokenMeta?.openid) return tokenMeta.openid;
    } catch (err) {
      // ignore
    }

    try {
      const userInfo = wx.getStorageSync('userInfo');
      return userInfo && (userInfo.openid || userInfo.openId)
        ? (userInfo.openid || userInfo.openId)
        : '';
    } catch (err) {
      return '';
    }
  }

  normalizeProfile(profile = {}) {
    return {
      openid: profile.openid || '',
      unionid: profile.unionid || '',
      nickName: profile.nickName || profile.nick_name || '',
      avatarUrl: profile.avatarUrl || profile.avatar_url || '',
      avatarFileId: profile.avatarFileId || profile.avatar_file_id || '',
      gender: typeof profile.gender === 'number' ? profile.gender : 0,
      birthday: profile.birthday || '',
      region: Array.isArray(profile.region)
        ? profile.region
        : Array.isArray(profile.region_json)
          ? profile.region_json
          : [],
      experienceLevel: profile.experienceLevel || profile.experience_level || '',
      signature: profile.signature || '',
      phone: profile.phone || '',
      email: profile.email || '',
      lastLoginAt: profile.lastLoginAt || profile.last_login_at || ''
    };
  }

  async getMyProfile() {
    const result = await scfApi.getUserProfile();
    if (result?.success === false) {
      throw new Error(result.msg || 'Failed to load profile');
    }

    if (!result?.profile) return null;
    const profile = this.normalizeProfile(result.profile);
    profile.avatarUrl = await mediaStorageService.resolveFileId(profile.avatarFileId, profile.avatarUrl);
    return profile;
  }

  async saveMyProfile(profile = {}) {
    const result = await scfApi.saveUserProfile(profile);
    if (result?.success === false) {
      throw new Error(result.msg || 'Failed to save profile');
    }

    if (!result?.profile) return null;
    const saved = this.normalizeProfile(result.profile);
    saved.avatarUrl = await mediaStorageService.resolveFileId(saved.avatarFileId, saved.avatarUrl);
    return saved;
  }
}

module.exports = new UserProfileService();
