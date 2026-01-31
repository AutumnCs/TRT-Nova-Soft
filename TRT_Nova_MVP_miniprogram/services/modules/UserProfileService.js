const db = require('../DB');

const COLLECTION_NAME = 'user_profiles';

/**
 * @class UserProfileService
 * @description 用户资料业务逻辑层（读写当前登录用户的资料）
 */
class UserProfileService {

  /**
   * 获取当前用户 openid（优先云函数，其次本地缓存）
   * @returns {Promise<string>}
   */
  async getMyOpenid() {
    try {
      const openid = await db.getOpenid();
      if (openid) return openid;
    } catch (err) {
      // ignore
    }
    try {
      const userInfo = wx.getStorageSync('userInfo');
      return userInfo && (userInfo.openid || userInfo.openId) ? (userInfo.openid || userInfo.openId) : '';
    } catch (err) {
      return '';
    }
  }

  /**
   * 获取当前用户资料（不存在则返回 null）
   * @returns {Promise<Object|null>}
   */
  async getMyProfile() {
    const openid = await this.getMyOpenid();
    if (!openid) return null;

    const records = await db.query(COLLECTION_NAME, { openid });
    if (!records || records.length === 0) return null;
    return records[0];
  }

  /**
   * 保存当前用户资料（不存在则新增，存在则更新）
   * @param {Object} profile
   * @returns {Promise<Object>}
   */
  async saveMyProfile(profile = {}) {
    const openid = await this.getMyOpenid();
    if (!openid) throw new Error('无法获取 openid');

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

    const existing = await this.getMyProfile();
    if (existing && existing._id) {
      await db.update(COLLECTION_NAME, existing._id, payload);
      return { ...existing, ...payload };
    }

    return await db.add(COLLECTION_NAME, payload);
  }
}

module.exports = new UserProfileService();

