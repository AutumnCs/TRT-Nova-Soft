/**
 * 判断是否为需要上传的本地临时路径
 * cloud:// 和 https:// 开头的都视为已持久化，不重复上传
 */
function isTempPath(url) {
  if (!url || typeof url !== 'string') return false;
  return !url.startsWith('cloud://') && !url.startsWith('https://') && !url.startsWith('http://mmbiz');
}

class CloudStorageService {
  async uploadPreparedFile(tempFilePath, upload, envId) {
    if (!envId || upload?.envId !== envId || upload?.mode !== 'cloudbase-client' ||
        !/^nova-staging\/[a-z0-9_-]{1,32}\/(?:images|media)\/[a-f0-9-]{36}\.(?:jpg|png|webp|pdf|docx|txt|md|csv|json)$/.test(upload.cloudPath || '') ||
        !String(upload.fileId || '').startsWith('cloud://' + envId + '.') ||
        !String(upload.fileId).endsWith('/' + upload.cloudPath)) {
      throw new Error('云开发附件上传配置不匹配');
    }
    if (!wx.cloud?.uploadFile) throw new Error('云存储不可用');
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath: upload.cloudPath, filePath: tempFilePath, config: { env: envId },
        success: result => result?.fileID === upload.fileId
          ? resolve(result.fileID) : reject(new Error('云开发返回的附件标识不匹配')),
        fail: () => reject(new Error('附件上传失败，请重试'))
      });
    });
  }

  async uploadImage(tempFilePath, options = {}) {
    if (!isTempPath(tempFilePath)) return tempFilePath;
    if (!wx.cloud) throw new Error('云存储不可用');

    const purpose = String(options.purpose || 'image').replace(/[^a-z0-9_-]/gi, '') || 'image';
    const owner = String(options.owner || 'anon').replace(/[^a-z0-9_-]/gi, '') || 'anon';
    const ext = (String(tempFilePath).split('.').pop().split('?')[0] || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
    const cloudPath = `${purpose}/${owner}_${Date.now()}.${safeExt}`;

    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        success: (res) => resolve(res.fileID),
        fail: (err) => reject(new Error(err.errMsg || '图片上传失败'))
      });
    });
  }

  /**
   * 上传头像临时路径到云存储，返回永久 cloud:// fileID
   * @param {string} tempFilePath  wx 给的临时路径
   * @param {string} openid        用户 openid，用于文件命名隔离
   * @returns {Promise<string>}    cloud:// fileID
   */
  async uploadAvatar(tempFilePath, openid) {
    return this.uploadImage(tempFilePath, {
      purpose: 'avatars',
      owner: openid
    });
  }

  async resolveFileIds(fileIds = []) {
    const cloudIds = (Array.isArray(fileIds) ? fileIds : []).filter((item) => String(item || '').startsWith('cloud://'));
    if (!cloudIds.length) return {};
    if (!wx.cloud) throw new Error('云存储不可用');
    const result = await wx.cloud.getTempFileURL({ fileList: cloudIds });
    return (result?.fileList || []).reduce((map, item) => {
      if (item?.fileID && item?.tempFileURL) map[item.fileID] = item.tempFileURL;
      return map;
    }, {});
  }
}

module.exports = new CloudStorageService();
