const BaseAdapter = require('./BaseAdapter');

/**
 * WeChat cloud database adapter.
 */
class CloudAdapter extends BaseAdapter {
  constructor() {
    super();
    this.db = null;
  }

  connect(config = {}) {
    if (!wx || !wx.cloud) {
      throw new Error('wx.cloud is not available');
    }
    this.db = wx.cloud.database(config);
  }

  ensureDb() {
    if (!this.db) {
      this.connect();
    }
  }

  /**
   * keep the 3rd arg for backward compatibility
   */
  async query(collectionName, query = {}, _requireUserIsolation = true) {
    this.ensureDb();
    const res = await this.db.collection(collectionName).where(query).get();
    return res.data || [];
  }

  async get(collectionName, id) {
    this.ensureDb();
    const res = await this.db.collection(collectionName).doc(id).get();
    return res.data;
  }

  async add(collectionName, data) {
    this.ensureDb();
    const payload = {
      ...data,
      createTime: this.db.serverDate(),
      updateTime: this.db.serverDate()
    };
    const res = await this.db.collection(collectionName).add({ data: payload });
    return { _id: res._id, ...payload };
  }

  async update(collectionName, id, data) {
    this.ensureDb();
    const payload = {
      ...data,
      updateTime: this.db.serverDate()
    };
    const res = await this.db.collection(collectionName).doc(id).update({ data: payload });
    return !!(res.stats && res.stats.updated > 0);
  }

  async delete(collectionName, id) {
    this.ensureDb();
    const res = await this.db.collection(collectionName).doc(id).remove();
    return !!(res.stats && res.stats.removed > 0);
  }

  /**
   * Resolve current user's openid from login cloud function response.
   * No fake fallback to avoid polluting production data.
   */
  async getOpenid() {
    if (!wx || !wx.cloud) {
      throw new Error('wx.cloud is not available');
    }

    const res = await wx.cloud.callFunction({
      name: 'login',
      data: {}
    });

    const openid =
      res?.result?.openid ||
      res?.result?.openId ||
      res?.result?.userInfo?.openid ||
      res?.result?.userInfo?.openId ||
      res?.result?.result?.openid ||
      res?.result?.result?.openId ||
      res?.result?.result?.userInfo?.openid ||
      res?.result?.result?.userInfo?.openId ||
      res?.openid ||
      '';

    if (!openid) {
      throw new Error('Failed to resolve openid from login cloud function');
    }

    return openid;
  }
}

module.exports = CloudAdapter;
