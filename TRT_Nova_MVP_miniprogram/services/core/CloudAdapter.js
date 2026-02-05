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
   * @param {boolean} requireUserIsolation - 是否需要用户隔离，默认true
   */
  async query(collectionName, query = {}, requireUserIsolation = true) {
    this._checkDb();
    try {
      console.log('查询条件:', query);
      
      let finalQuery = query;
      
      // 获取当前用户的openid
      const openid = await this.getOpenid();
      console.log('查询数据时使用的openid:', openid);
      
      // 如果需要用户隔离，添加用户身份过滤
      if (requireUserIsolation) {
        // 显式添加_openid过滤，确保只返回当前用户的数据
        finalQuery = {
          ...query
          // 注意：不要显式添加_openid字段，云开发会自动处理
          // _openid: openid
        };
        console.log('启用用户隔离，只返回当前用户的数据');
      }
      
      const res = await this.db.collection(collectionName).where(finalQuery).get();
      console.log('查询结果:', res.data);
      
      // 过滤结果，只返回当前用户的数据
      if (requireUserIsolation) {
        const filteredData = res.data.filter(item => {
          // 检查数据是否属于当前用户
          return item._openid === openid;
        });
        console.log('过滤后的结果:', filteredData);
        return filteredData;
      }
      
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
      // 自动添加创建时间和更新时间，_openid由系统自动管理
      const payload = {
        ...data,
        createTime: this.db.serverDate(),
        updateTime: this.db.serverDate()
      };
      console.log('添加的数据:', payload);
      
      const res = await this.db.collection(collectionName).add({ data: payload });
      console.log('添加结果:', res);
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
      console.log('更新的数据:', payload);
      
      const res = await this.db.collection(collectionName).doc(id).update({ data: payload });
      console.log('更新结果:', res);
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
      console.log('准备删除文档:', id);
      const res = await this.db.collection(collectionName).doc(id).remove();
      console.log('删除结果:', res);
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
      } else if (res && res.result && res.result.userInfo && (res.result.userInfo.openId || res.result.userInfo.openid)) {
        const openid = res.result.userInfo.openId || res.result.userInfo.openid;
        console.log('从result.userInfo中获取openid:', openid);
        return openid;
      } else if (res && res.openid) {
        console.log('直接获取openid:', res.openid);
        return res.openid;
      } else if (res && res.result && res.result.result && res.result.result.openid) {
        console.log('从result.result中获取openid:', res.result.result.openid);
        return res.result.result.openid;
      } else if (res && res.result && res.result.result && res.result.result.userInfo && (res.result.result.userInfo.openId || res.result.result.userInfo.openid)) {
        const openid = res.result.result.userInfo.openId || res.result.result.userInfo.openid;
        console.log('从result.result.userInfo中获取openid:', openid);
        return openid;
      } else if (res && res.result && res.result.result && (res.result.result.openid || res.result.result.openId)) {
        const openid = res.result.result.openid || res.result.result.openId;
        console.log('从result.result中获取openid:', openid);
        return openid;
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
