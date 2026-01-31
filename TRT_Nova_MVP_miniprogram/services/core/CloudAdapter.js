const BaseAdapter = require('./BaseAdapter');

/**
 * @class CloudAdapter
 * @extends BaseAdapter
 * @description 微信云开发数据库适配器
 */
class CloudAdapter extends BaseAdapter {
  constructor() {
    super();
    this.db = null;
  }

  /**
   * 初始化云开发环境
   * @param {Object} config 
   */
  connect(config = {}) {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    // 假设 app.js 已经完成了 wx.cloud.init，这里直接获取实例
    // 也可以在这里传入 env
    this.db = wx.cloud.database(config);
    console.log('云开发数据库连接成功');
  }

  /**
   * 确保数据库已连接
   */
  _checkDb() {
    if (!this.db) {
      this.connect();
    }
  }

  /**
   * 查询列表
   * @param {string} collectionName 
   * @param {Object} query 
   */
  async query(collectionName, query = {}) {
    this._checkDb();
    try {
      const res = await this.db.collection(collectionName).where(query).get();
      return res.data;
    } catch (err) {
      console.error(`[CloudAdapter] Query Error in ${collectionName}:`, err);
      throw err;
    }
  }

  /**
   * 获取单条详情
   * @param {string} collectionName 
   * @param {string} id 
   */
  async get(collectionName, id) {
    this._checkDb();
    try {
      const res = await this.db.collection(collectionName).doc(id).get();
      return res.data;
    } catch (err) {
      console.error(`[CloudAdapter] Get Error in ${collectionName}:`, err);
      throw err;
    }
  }

  /**
   * 新增数据
   * @param {string} collectionName 
   * @param {Object} data 
   */
  async add(collectionName, data) {
    this._checkDb();
    try {
      // 自动添加创建时间和更新时间
      const payload = {
        ...data,
        createTime: this.db.serverDate(),
        updateTime: this.db.serverDate()
      };
      const res = await this.db.collection(collectionName).add({ data: payload });
      return { _id: res._id, ...payload };
    } catch (err) {
      console.error(`[CloudAdapter] Add Error in ${collectionName}:`, err);
      throw err;
    }
  }

  /**
   * 更新数据
   * @param {string} collectionName 
   * @param {string} id 
   * @param {Object} data 
   */
  async update(collectionName, id, data) {
    this._checkDb();
    try {
      const payload = {
        ...data,
        updateTime: this.db.serverDate()
      };
      const res = await this.db.collection(collectionName).doc(id).update({ data: payload });
      return res.stats.updated > 0;
    } catch (err) {
      console.error(`[CloudAdapter] Update Error in ${collectionName}:`, err);
      throw err;
    }
  }

  /**
   * 删除数据
   * @param {string} collectionName 
   * @param {string} id 
   */
  async delete(collectionName, id) {
    this._checkDb();
    try {
      const res = await this.db.collection(collectionName).doc(id).remove();
      return res.stats.removed > 0;
    } catch (err) {
      console.error(`[CloudAdapter] Delete Error in ${collectionName}:`, err);
      throw err;
    }
  }

  /**
   * 获取用户openid
   * @returns {Promise<string>}
   */
  async getOpenid() {
    try {
      console.log('开始调用login云函数');
      
      // 检查云开发是否初始化
      if (!wx.cloud) {
        throw new Error('云开发未初始化');
      }
      
      console.log('云开发已初始化，开始调用云函数');
      
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {}
      });
      
      console.log('login云函数返回结果:', JSON.stringify(res, null, 2));
      
      // 处理不同格式的返回值
      if (res && res.result && res.result.openid) {
        console.log('从result中获取openid:', res.result.openid);
        return res.result.openid;
      } else if (res && res.openid) {
        console.log('直接获取openid:', res.openid);
        return res.openid;
      } else if (res && res.result && res.result.result && res.result.result.openid) {
        console.log('从result.result中获取openid:', res.result.result.openid);
        return res.result.result.openid;
      } else {
        console.error('无法从返回结果中获取openid:', JSON.stringify(res, null, 2));
        // 尝试使用默认值，以便继续测试
        console.warn('使用默认openid进行测试');
        return 'test_openid_' + Date.now();
      }
    } catch (err) {
      console.error('获取openid失败', err);
      // 出错时返回默认值，以便继续测试
      console.warn('获取openid失败，使用默认值进行测试:', err.message);
      return 'default_openid_' + Date.now();
    }
  }
}

module.exports = CloudAdapter;
