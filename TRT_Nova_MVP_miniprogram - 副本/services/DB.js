const CloudAdapter = require('./core/CloudAdapter');

/**
 * 数据库实例工厂
 * 如果未来需要迁移到 HTTP 后端，只需创建一个 HttpAdapter
 * 并在这里替换 CloudAdapter 即可
 */
const adapter = new CloudAdapter();

// 初始化连接（使用默认环境）
adapter.connect();

module.exports = adapter;
