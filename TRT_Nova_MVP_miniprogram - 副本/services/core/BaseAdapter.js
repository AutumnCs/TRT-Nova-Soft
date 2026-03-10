/**
 * @class BaseAdapter
 * @description 数据库适配器基类，定义标准接口
 * 任何具体的数据库实现（如云开发、HTTP、SQLite）都必须继承此类并实现这些方法
 */
class BaseAdapter {
  constructor() {
    if (new.target === BaseAdapter) {
      throw new Error("BaseAdapter 无法被直接实例化，请使用具体的子类");
    }
  }

  /**
   * 连接/初始化数据库
   * @param {Object} config - 配置信息
   */
  connect(config) {
    throw new Error("必须实现 connect 方法");
  }

  /**
   * 查询列表
   * @param {string} collectionName - 集合/表名
   * @param {Object} query - 查询条件
   * @returns {Promise<Array>}
   */
  query(collectionName, query) {
    throw new Error("必须实现 query 方法");
  }

  /**
   * 获取单条详情
   * @param {string} collectionName - 集合/表名
   * @param {string|number} id - ID
   * @returns {Promise<Object>}
   */
  get(collectionName, id) {
    throw new Error("必须实现 get 方法");
  }

  /**
   * 新增数据
   * @param {string} collectionName - 集合/表名
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} - 返回新增的数据（包含ID）
   */
  add(collectionName, data) {
    throw new Error("必须实现 add 方法");
  }

  /**
   * 更新数据
   * @param {string} collectionName - 集合/表名
   * @param {string|number} id - ID
   * @param {Object} data - 更新的数据
   * @returns {Promise<boolean>}
   */
  update(collectionName, id, data) {
    throw new Error("必须实现 update 方法");
  }

  /**
   * 删除数据
   * @param {string} collectionName - 集合/表名
   * @param {string|number} id - ID
   * @returns {Promise<boolean>}
   */
  delete(collectionName, id) {
    throw new Error("必须实现 delete 方法");
  }
}

module.exports = BaseAdapter;
