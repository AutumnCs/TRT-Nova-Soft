/**
 * 判断是否为需要上传的本地临时路径
 * cloud:// 和 https:// 开头的都视为已持久化，不重复上传
 */
function isTempPath(url) {
  if (!url || typeof url !== 'string') return false;
  return !url.startsWith('cloud://') && !url.startsWith('https://') && !url.startsWith('http://mmbiz');
}

class CloudStorageService {
  /**
   * 上传头像临时路径到云存储，返回永久 cloud:// fileID
   * @param {string} tempFilePath  wx 给的临时路径
   * @param {string} openid        用户 openid，用于文件命名隔离
   * @returns {Promise<string>}    cloud:// fileID
   */
  async uploadAvatar(tempFilePath, openid) {
    if (!isTempPath(tempFilePath)) return tempFilePath;

    if (!wx.cloud) throw new Error('wx.cloud 未初始化');

    const ext = (tempFilePath.split('.').pop().split('?')[0] || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const cloudPath = `avatars/${openid || 'anon'}_${Date.now()}.${safeExt}`;

    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        success: (res) => resolve(res.fileID),
        fail: (err) => reject(new Error(err.errMsg || '头像上传失败'))
      });
    });
  }
}

module.exports = new CloudStorageService();
