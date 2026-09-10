// 通过 automator.evaluate 在小程序上下文执行；快照只保留在测试进程内存，禁止落日志。
function captureStorage() {
  return (wx.getStorageInfoSync().keys || []).map((key) => ({ key, value: wx.getStorageSync(key) }));
}

function restoreStorage(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.some((entry) => !entry || typeof entry.key !== 'string'
    || !Object.prototype.hasOwnProperty.call(entry, 'value'))) {
    throw new Error('无有效缓存快照，不能清理或恢复');
  }
  wx.clearStorageSync();
  snapshot.forEach((entry) => wx.setStorageSync(entry.key, entry.value));
  return snapshot.length;
}

module.exports = { captureStorage, restoreStorage };
