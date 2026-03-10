const db = require('../DB');

const USERS_COLLECTION = 'users';

/**
 * User profile service.
 * Canonical collection: users
 */
class UserProfileService {
  async getMyOpenid() {
    try {
      const openid = await db.getOpenid();
      if (openid) return openid;
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

  async getMyProfile() {
    const openid = await this.getMyOpenid();
    if (!openid) return null;

    const users = await db.query(USERS_COLLECTION, { openid });
    if (users && users.length > 0) return users[0];

    return null;
  }

  async saveMyProfile(profile = {}) {
    const openid = await this.getMyOpenid();
    if (!openid) throw new Error('Unable to resolve openid');

    const payload = {
      openid,
      nickName: profile.nickName || '',
      avatarUrl: profile.avatarUrl || '',
      gender: typeof profile.gender === 'number' ? profile.gender : 0,
      birthday: profile.birthday || '',
      region: Array.isArray(profile.region) ? profile.region : [],
      experienceLevel: profile.experienceLevel || '',
      signature: profile.signature || '',
      phone: profile.phone || '',
      email: profile.email || ''
    };

    const users = await db.query(USERS_COLLECTION, { openid });
    if (users && users.length > 0 && users[0]._id) {
      await db.update(USERS_COLLECTION, users[0]._id, payload);
      return { ...users[0], ...payload };
    }

    return await db.add(USERS_COLLECTION, payload);
  }
}

module.exports = new UserProfileService();
