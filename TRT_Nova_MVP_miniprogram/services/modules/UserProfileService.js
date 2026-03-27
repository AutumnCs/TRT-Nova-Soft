const ScfApiAdapter = require('../core/ScfApiAdapter');
const authService = require('./AuthService');

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

    return result?.profile ? this.normalizeProfile(result.profile) : null;
  }

  async saveMyProfile(profile = {}) {
    const result = await scfApi.saveUserProfile(profile);
    if (result?.success === false) {
      throw new Error(result.msg || 'Failed to save profile');
    }

    return result?.profile ? this.normalizeProfile(result.profile) : null;
  }
}

module.exports = new UserProfileService();
