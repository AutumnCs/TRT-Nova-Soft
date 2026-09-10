const ScfApiAdapter = require('../core/ScfApiAdapter');
const { resolveRuntimeConfig } = require('../config/runtime');
const cloudStorageService = require('./CloudStorageService');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1 * 1024 * 1024;
const CACHE_DIR_NAME = 'zhichong-media-cache';
const CACHE_INDEX_STORAGE_KEY = 'nvp_media_display_cache_index_v1';

function isLocalFileId(value) {
  return /^(?:local|cos):\/\//.test(String(value || ''));
}

function isCloudFileId(value) {
  return String(value || '').startsWith('cloud://');
}

function isHttpsUrl(value) {
  return String(value || '').startsWith('https://');
}

function callFs(method, options = {}) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fs[method]({
      ...options,
      success: resolve,
      fail: reject
    });
  });
}

function getCacheDirectory() {
  return `${wx.env.USER_DATA_PATH}/${CACHE_DIR_NAME}`;
}

function getCachePath(fileId, extension, scope = getCacheScope()) {
  const safeScope = String(scope || 'anonymous').replace(/[^a-z0-9]/gi, '_').slice(-36) || 'anonymous';
  const safeName = String(fileId || '').replace(/[^a-z0-9]/gi, '_').slice(-90);
  return `${getCacheDirectory()}/${safeScope}_${safeName}.${extension || 'img'}`;
}

function getCacheScope() {
  let tokenMeta = {};
  let userInfo = {};
  try {
    tokenMeta = wx.getStorageSync('apiAccessTokenMeta') || {};
    userInfo = wx.getStorageSync('userInfo') || {};
  } catch (err) {
    // Storage quota/corruption must not prevent media from being displayed.
  }
  return String(tokenMeta.openid || userInfo.openid || userInfo.openId || 'anonymous').trim() || 'anonymous';
}

function getMemoryCacheKey(scope, fileId) {
  return `${scope}\n${fileId}`;
}

function readCacheIndex() {
  try {
    const stored = wx.getStorageSync(CACHE_INDEX_STORAGE_KEY);
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch (err) {
    return {};
  }
}

function updateScopedCacheIndex(scope, entries = {}, removals = []) {
  const index = readCacheIndex();
  const scopedIndex = { ...(index[scope] || {}) };
  Object.keys(entries).forEach((fileId) => {
    if (entries[fileId]) scopedIndex[fileId] = entries[fileId];
  });
  removals.forEach((fileId) => delete scopedIndex[fileId]);
  if (Object.keys(scopedIndex).length) index[scope] = scopedIndex;
  else delete index[scope];
  try {
    wx.setStorageSync(CACHE_INDEX_STORAGE_KEY, index);
    return true;
  } catch (err) {
    return false;
  }
}

class MediaStorageService {
  constructor(adapter = new ScfApiAdapter()) {
    this.scfApiAdapter = adapter;
    this.displayCache = new Map();
    this.cacheGeneration = 0;
    this._activeCacheResolveCount = 0;
    this._cacheResolveWaiters = [];
  }

  isCacheGenerationCurrent(generation) {
    return Number(generation) === Number(this.cacheGeneration);
  }

  finishActiveCacheResolution() {
    this._activeCacheResolveCount = Math.max(0, this._activeCacheResolveCount - 1);
    if (this._activeCacheResolveCount) return;
    const waiters = this._cacheResolveWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  waitForActiveCacheResolutions() {
    if (!this._activeCacheResolveCount) return Promise.resolve();
    return new Promise((resolve) => this._cacheResolveWaiters.push(resolve));
  }

  async restorePersistentCache(
    fileIds = [],
    scope = getCacheScope(),
    generation = this.cacheGeneration
  ) {
    const scopedIndex = { ...(readCacheIndex()[scope] || {}) };
    const staleFileIds = [];
    const restored = {};
    await Promise.all((Array.isArray(fileIds) ? fileIds : []).map(async (fileId) => {
      const cachePath = String(scopedIndex[fileId] || '');
      if (!cachePath) return;
      try {
        await callFs('access', { path: cachePath });
        restored[fileId] = cachePath;
      } catch (err) {
        staleFileIds.push(fileId);
      }
    }));
    if (!this.isCacheGenerationCurrent(generation)) return {};
    Object.keys(restored).forEach((fileId) => {
      this.displayCache.set(getMemoryCacheKey(scope, fileId), restored[fileId]);
    });
    if (staleFileIds.length) updateScopedCacheIndex(scope, {}, staleFileIds);
    return restored;
  }

  async ensureCacheDirectory() {
    try {
      await callFs('access', { path: getCacheDirectory() });
    } catch (err) {
      await callFs('mkdir', { dirPath: getCacheDirectory(), recursive: true });
    }
  }

  async uploadImage(tempFilePath, purpose, options = {}) {
    const path = String(tempFilePath || '').trim();
    if (!path) throw new Error('请选择图片');
    if (isLocalFileId(path) || isCloudFileId(path) || isHttpsUrl(path)) return path;

    const config = resolveRuntimeConfig();
    if (config.useCloudBase) {
      return cloudStorageService.uploadImage(path, {
        purpose,
        owner: options.owner || 'user'
      });
    }

    const info = await callFs('getFileInfo', { filePath: path });
    if (Number(info?.size) > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 2 MB');
    const file = await callFs('readFile', { filePath: path, encoding: 'base64' });
    const result = await this.scfApiAdapter.uploadMedia({
      purpose,
      plantPetId: Number(options.plantPetId) || undefined,
      originalName: options.originalName || path.split('/').pop() || '',
      dataBase64: file.data
    });
    if (result?.success === false || !result?.media?.fileId) {
      throw new Error(result?.msg || '图片上传失败');
    }
    return result.media.fileId;
  }

  async uploadImages(paths = [], purpose, options = {}) {
    const source = Array.isArray(paths) ? paths : [];
    if (source.length > 3) throw new Error('每条日记最多添加 3 张图片');
    const uploaded = [];
    try {
      for (const path of source) {
        uploaded.push(await this.uploadImage(path, purpose, options));
      }
      return uploaded;
    } catch (err) {
      await Promise.all(uploaded.map((fileId) => this.discard(fileId).catch(() => {})));
      throw err;
    }
  }

  async uploadDocument(file = {}, options = {}) {
    const path = String(file.path || file.tempFilePath || '').trim();
    const originalName = String(file.name || file.originalName || path.split('/').pop() || '').trim();
    if (!path || !originalName) throw new Error('请选择文档');
    const config = resolveRuntimeConfig();
    if (config.useCloudBase) {
      throw new Error('云端文档附件尚未启用，请在本地开发环境验证');
    }
    const info = await callFs('getFileInfo', { filePath: path });
    const byteSize = Number(info?.size) || Number(file.size) || 0;
    if (!byteSize || byteSize > MAX_DOCUMENT_BYTES) throw new Error('单个文档不能超过 1 MB');
    const content = await callFs('readFile', { filePath: path, encoding: 'base64' });
    const result = await this.scfApiAdapter.uploadMedia({
      purpose: 'conversation_document',
      plantPetId: Number(options.plantPetId) || undefined,
      originalName,
      dataBase64: content.data
    });
    if (result?.success === false || !result?.media?.fileId) {
      throw new Error(result?.msg || '文档上传失败');
    }
    return {
      fileId: result.media.fileId,
      mimeType: result.media.mimeType || '',
      byteSize: Number(result.media.byteSize) || byteSize,
      originalName
    };
  }

  async resolveFileIds(fileIds = []) {
    while (this._cacheClearPromise) await this._cacheClearPromise;
    this._activeCacheResolveCount += 1;
    try {
      const requested = Array.from(new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean)));
      const scope = getCacheScope();
      const generation = this.cacheGeneration;
      const directResult = {};
      requested.forEach((fileId) => {
        if (isHttpsUrl(fileId)) directResult[fileId] = fileId;
      });
      const result = { ...directResult };
      requested.forEach((fileId) => {
        const memoryKey = getMemoryCacheKey(scope, fileId);
        if (this.displayCache.has(memoryKey)) result[fileId] = this.displayCache.get(memoryKey);
      });

      const unresolvedLocalIds = requested.filter((fileId) => isLocalFileId(fileId) && !result[fileId]);
      if (unresolvedLocalIds.length) {
        Object.assign(result, await this.restorePersistentCache(unresolvedLocalIds, scope, generation));
        if (!this.isCacheGenerationCurrent(generation)) return directResult;
      }

      const localIds = unresolvedLocalIds.filter((fileId) => !result[fileId]);
      if (localIds.length) {
        let response = null;
        try {
          // One COS object per authenticated response keeps payloads below SCF's 6 MiB limit.
          if (localIds.some(id => id.startsWith('cos://'))) {
            const replies = [];
            for (const id of localIds) replies.push(await this.scfApiAdapter.resolveMedia([id]));
            response = { success: true, media: replies.flatMap(item => item?.success === false ? [] : item?.media || []) };
          } else response = await this.scfApiAdapter.resolveMedia(localIds);
        } catch (err) {
          return result;
        }
        if (response?.success === false) return result;
        if (!this.isCacheGenerationCurrent(generation)) return directResult;
        try {
          await this.ensureCacheDirectory();
        } catch (err) {
          return result;
        }
        if (!this.isCacheGenerationCurrent(generation)) return directResult;
        const writes = await Promise.all((response?.media || []).map(async (item) => {
          if (!item?.fileId || !item?.contentBase64 || !item?.extension) return null;
          const cachePath = getCachePath(item.fileId, item.extension, scope);
          try {
            await callFs('writeFile', {
              filePath: cachePath,
              data: item.contentBase64,
              encoding: 'base64'
            });
            return { fileId: item.fileId, cachePath };
          } catch (err) {
            return null;
          }
        }));
        if (!this.isCacheGenerationCurrent(generation)) {
          await Promise.all(writes.filter(Boolean).map(({ cachePath }) =>
            callFs('unlink', { filePath: cachePath }).catch(() => {})
          ));
          return directResult;
        }
        const cacheEntries = {};
        writes.filter(Boolean).forEach(({ fileId, cachePath }) => {
          this.displayCache.set(getMemoryCacheKey(scope, fileId), cachePath);
          cacheEntries[fileId] = cachePath;
          result[fileId] = cachePath;
        });
        updateScopedCacheIndex(scope, cacheEntries);
      }

      const cloudIds = requested.filter((fileId) => isCloudFileId(fileId) && !result[fileId]);
      if (cloudIds.length) {
        const cloudMap = await cloudStorageService.resolveFileIds(cloudIds);
        if (!this.isCacheGenerationCurrent(generation)) return directResult;
        Object.keys(cloudMap).forEach((fileId) => {
          this.displayCache.set(getMemoryCacheKey(scope, fileId), cloudMap[fileId]);
          result[fileId] = cloudMap[fileId];
        });
      }
      return result;
    } finally {
      this.finishActiveCacheResolution();
    }
  }

  async resolveFileId(fileId, fallbackUrl = '') {
    if (!fileId) return fallbackUrl || '';
    const map = await this.resolveFileIds([fileId]);
    return map[fileId] || fallbackUrl || '';
  }

  async discard(fileId) {
    if (!isLocalFileId(fileId)) return { success: true };
    if (this._cacheClearPromise) await this._cacheClearPromise;
    this.cacheGeneration += 1;
    const scope = getCacheScope();
    this.displayCache.delete(getMemoryCacheKey(scope, fileId));
    const scopedIndex = { ...(readCacheIndex()[scope] || {}) };
    const cachePath = scopedIndex[fileId] || '';
    updateScopedCacheIndex(scope, {}, [fileId]);
    if (cachePath) await callFs('unlink', { filePath: cachePath }).catch(() => {});
    return this.scfApiAdapter.discardMedia(fileId);
  }

  clearDisplayCache() {
    if (this._cacheClearPromise) return this._cacheClearPromise;
    this.cacheGeneration += 1;
    this.displayCache.clear();
    try {
      wx.removeStorageSync(CACHE_INDEX_STORAGE_KEY);
    } catch (err) {
      // Disk cleanup can still proceed when the lightweight index is unavailable.
    }
    const operation = (async () => {
      try {
        await this.waitForActiveCacheResolutions();
        const result = await callFs('readdir', { dirPath: getCacheDirectory() });
        await Promise.all((result?.files || []).map((name) =>
          callFs('unlink', { filePath: `${getCacheDirectory()}/${name}` }).catch(() => {})
        ));
        return true;
      } catch (err) {
        return true;
      }
    })();
    const tracked = operation.finally(() => {
      if (this._cacheClearPromise === tracked) this._cacheClearPromise = null;
    });
    this._cacheClearPromise = tracked;
    return tracked;
  }
}

module.exports = new MediaStorageService();
module.exports.MediaStorageService = MediaStorageService;
module.exports.CACHE_INDEX_STORAGE_KEY = CACHE_INDEX_STORAGE_KEY;
module.exports.getCacheScope = getCacheScope;
