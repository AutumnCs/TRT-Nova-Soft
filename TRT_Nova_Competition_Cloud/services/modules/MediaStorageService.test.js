const test = require('node:test');
const assert = require('node:assert/strict');

function installWxMock(openid = 'owner-a') {
  const storage = new Map([
    ['apiAccessTokenMeta', { openid }]
  ]);
  const files = new Set();
  const directories = new Set();
  const succeed = (options, value = {}) => options.success && options.success(value);
  const fail = (options) => options.fail && options.fail({ errMsg: 'not found' });
  global.wx = {
    env: { USER_DATA_PATH: '/user-data' },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    getFileSystemManager() {
      return {
        access(options) {
          if (files.has(options.path) || directories.has(options.path)) succeed(options);
          else fail(options);
        },
        mkdir(options) {
          directories.add(options.dirPath);
          succeed(options);
        },
        writeFile(options) {
          files.add(options.filePath);
          succeed(options);
        },
        unlink(options) {
          files.delete(options.filePath);
          succeed(options);
        },
        readdir(options) {
          const prefix = `${options.dirPath}/`;
          succeed(options, {
            files: Array.from(files).filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length))
          });
        }
      };
    }
  };
  return { storage, files };
}

function installCloudAvatarMock({ imageFailure = false, imagePath = '/tmp/avatar.jpg', byteSize = 128, switchOwner = false } = {}) {
  const { storage } = installWxMock('avatar-owner');
  const calls = [];
  const envId = 'avatar-test-env';
  const cloudPath = 'nova-staging/test/media/12345678-1234-1234-1234-123456789abc.jpg';
  const fileId = `cloud://${envId}.test-bucket/${cloudPath}`;
  global.getApp = () => ({ globalData: { runtimeConfig: {
    mediaStorageProvider: 'cloudbase', cloudbaseStorageEnvId: envId
  } } });
  global.wx.getImageInfo = options => {
    calls.push(['download', options.src]);
    if (switchOwner) storage.set('apiAccessTokenMeta', { openid: 'another-owner' });
    if (imageFailure) options.fail({ errMsg: 'url not in domain list' });
    else options.success({ path: imagePath });
  };
  global.wx.getFileSystemManager = () => ({
    getFileInfo(options) { calls.push(['size', options.filePath]); options.success({ size: byteSize }); },
    readFile(options) { calls.push(['read', options.filePath]); options.success({ data: 'cGl4ZWw=' }); }
  });
  global.wx.cloud = { uploadFile(options) {
    calls.push(['upload', options.filePath, options.config.env]);
    options.success({ fileID: fileId });
  } };
  const adapter = {
    async uploadMedia(input) {
      calls.push(['prepare', input]);
      return { success: true, upload: { mode: 'cloudbase-client', envId, cloudPath, fileId } };
    },
    async completeMediaUpload(id) { calls.push(['complete', id]); return { success: true, media: { fileId: id } }; },
    async discardMedia(id) { calls.push(['discard', id]); return { success: true }; }
  };
  return { calls, adapter, fileId, envId };
}

test('CloudBase converts a WeChat HTTPS avatar to an owned, completed cloud file', async () => {
  const { calls, adapter, fileId, envId } = installCloudAvatarMock();
  const { MediaStorageService } = require('./MediaStorageService');
  try {
    assert.equal(await new MediaStorageService(adapter).uploadImage('https://thirdwx.qlogo.cn/avatar', 'profile_avatar'), fileId);
    assert.deepEqual(calls.map(call => call[0]), ['download', 'size', 'read', 'prepare', 'upload', 'complete']);
    assert.deepEqual(calls[4], ['upload', '/tmp/avatar.jpg', envId]);
    assert.equal(calls[3][1].purpose, 'profile_avatar');
    assert.equal(calls[3][1].dataBase64, 'cGl4ZWw=');
    assert.equal(calls[3][1].originalName, 'avatar.jpg');
  } finally { delete global.wx; delete global.getApp; }
});

test('non-CloudBase HTTPS avatars retain the existing direct URL behavior', async () => {
  installWxMock();
  global.getApp = () => ({ globalData: { runtimeConfig: { mediaStorageProvider: 'local' } } });
  const { MediaStorageService } = require('./MediaStorageService');
  try {
    const url = 'https://thirdwx.qlogo.cn/avatar';
    assert.equal(await new MediaStorageService({}).uploadImage(url, 'profile_avatar'), url);
  } finally { delete global.wx; delete global.getApp; }
});

test('a CloudBase avatar download failure never falls back to an external reference', async () => {
  const { calls, adapter } = installCloudAvatarMock({ imageFailure: true });
  const { MediaStorageService } = require('./MediaStorageService');
  try {
    await assert.rejects(new MediaStorageService(adapter).uploadImage('https://thirdwx.qlogo.cn/avatar', 'profile_avatar'), /图片下载失败/);
    assert.deepEqual(calls.map(call => call[0]), ['download']);
  } finally { delete global.wx; delete global.getApp; }
});

test('CloudBase avatar preparation stops if the account changes while downloading', async () => {
  const { calls, adapter } = installCloudAvatarMock({ switchOwner: true });
  const { MediaStorageService } = require('./MediaStorageService');
  try {
    await assert.rejects(new MediaStorageService(adapter).uploadImage('https://thirdwx.qlogo.cn/avatar', 'profile_avatar'), /登录账号已变化/);
    assert.deepEqual(calls.map(call => call[0]), ['download']);
  } finally { delete global.wx; delete global.getApp; }
});

test('downloaded CloudBase avatars retain the two-megabyte limit before upload', async () => {
  const { calls, adapter } = installCloudAvatarMock({ byteSize: 2 * 1024 * 1024 + 1 });
  const { MediaStorageService } = require('./MediaStorageService');
  try {
    await assert.rejects(new MediaStorageService(adapter).uploadImage('https://thirdwx.qlogo.cn/avatar', 'profile_avatar'), /不能超过 2 MB/);
    assert.deepEqual(calls.map(call => call[0]), ['download', 'size']);
  } finally { delete global.wx; delete global.getApp; }
});

test('CloudBase avatar conversion requires a local image path', async () => {
  const { MediaStorageService } = require('./MediaStorageService');
  for (const imagePath of ['', 'https://thirdwx.qlogo.cn/avatar']) {
    const { calls, adapter } = installCloudAvatarMock({ imagePath });
    try {
      await assert.rejects(new MediaStorageService(adapter).uploadImage('https://thirdwx.qlogo.cn/avatar', 'profile_avatar'), /图片下载失败/);
      assert.deepEqual(calls.map(call => call[0]), ['download']);
    } finally { delete global.wx; delete global.getApp; }
  }
});

test('CloudBase附件分批走可信后端、恢复缓存并按账号隔离，取消时调用discard', async () => {
  const { storage } = installWxMock('owner-cloud-a');
  global.getApp = () => ({ globalData: { runtimeConfig: { mediaStorageProvider: 'cloudbase' } } });
  const { MediaStorageService } = require('./MediaStorageService');
  const ids = ['cloud://test-env.bucket/file-a.png', 'cloud://test-env.bucket/file-b.png'];
  const calls = [];
  const adapter = {
    async resolveMedia(fileIds) {
      calls.push(fileIds);
      return { success: true, media: fileIds.map(fileId => ({ fileId, extension: 'png', contentBase64: 'AA==' })) };
    },
    async discardMedia(fileId) { calls.push(['discard', fileId]); return { success: true }; }
  };
  try {
    const firstService = new MediaStorageService(adapter);
    const first = await firstService.resolveFileIds(ids);
    assert.deepEqual(calls, [[ids[0]], [ids[1]]]);
    assert.ok(first[ids[0]]);
    const second = await new MediaStorageService(adapter).resolveFileIds(ids);
    assert.deepEqual(second, first);
    assert.equal(calls.length, 2);
    storage.set('apiAccessTokenMeta', { openid: 'owner-cloud-b' });
    const other = await new MediaStorageService(adapter).resolveFileIds(ids);
    assert.notEqual(first[ids[0]], other[ids[0]]);
    await firstService.discard(ids[0]);
    assert.deepEqual(calls.at(-1), ['discard', ids[0]]);
  } finally { delete global.wx; delete global.getApp; }
});

test('local media cache survives a service restart without another resolve request', async () => {
  const { storage } = installWxMock();
  const { MediaStorageService, CACHE_INDEX_STORAGE_KEY } = require('./MediaStorageService');
  let resolveCalls = 0;
  const adapter = {
    async resolveMedia(fileIds) {
      resolveCalls += 1;
      return {
        success: true,
        media: fileIds.map((fileId) => ({
          fileId,
          extension: 'jpg',
          contentBase64: 'AA=='
        }))
      };
    }
  };
  const fileId = 'local://media-owner-a';
  const firstService = new MediaStorageService(adapter);
  const first = await firstService.resolveFileIds([fileId]);
  assert.match(first[fileId], /zhichong-media-cache/);
  assert.equal(resolveCalls, 1);
  assert.ok(storage.get(CACHE_INDEX_STORAGE_KEY)['owner-a'][fileId]);

  const restartedService = new MediaStorageService({
    async resolveMedia() {
      throw new Error('persistent cache should have been used');
    }
  });
  const second = await restartedService.resolveFileIds([fileId]);
  assert.equal(second[fileId], first[fileId]);
  assert.equal(resolveCalls, 1);
  delete global.wx;
});

test('persistent media cache is isolated by the current account', async () => {
  const { storage } = installWxMock('owner-a');
  const { MediaStorageService } = require('./MediaStorageService');
  let resolveCalls = 0;
  const adapter = {
    async resolveMedia(fileIds) {
      resolveCalls += 1;
      return {
        success: true,
        media: fileIds.map((fileId) => ({ fileId, extension: 'png', contentBase64: 'AA==' }))
      };
    }
  };
  const fileId = 'local://shared-looking-id';
  const first = await new MediaStorageService(adapter).resolveFileIds([fileId]);
  storage.set('apiAccessTokenMeta', { openid: 'owner-b' });
  const second = await new MediaStorageService(adapter).resolveFileIds([fileId]);
  assert.equal(resolveCalls, 2);
  assert.notEqual(first[fileId], second[fileId]);
  delete global.wx;
});

test('parallel media resolutions merge their persistent cache entries', async () => {
  const { storage } = installWxMock('owner-a');
  const { MediaStorageService, CACHE_INDEX_STORAGE_KEY } = require('./MediaStorageService');
  const adapter = {
    async resolveMedia(fileIds) {
      return {
        success: true,
        media: fileIds.map((fileId) => ({ fileId, extension: 'jpg', contentBase64: 'AA==' }))
      };
    }
  };
  const service = new MediaStorageService(adapter);
  const firstId = 'local://parallel-first';
  const secondId = 'local://parallel-second';
  await Promise.all([
    service.resolveFileIds([firstId]),
    service.resolveFileIds([secondId])
  ]);

  const scopedIndex = storage.get(CACHE_INDEX_STORAGE_KEY)['owner-a'];
  assert.ok(scopedIndex[firstId]);
  assert.ok(scopedIndex[secondId]);
  delete global.wx;
});

test('storage index failure does not block a resolved image', async () => {
  installWxMock('owner-a');
  global.wx.setStorageSync = () => { throw new Error('storage full'); };
  const { MediaStorageService } = require('./MediaStorageService');
  const fileId = 'local://storage-failure';
  const service = new MediaStorageService({
    async resolveMedia() {
      return {
        success: true,
        media: [{ fileId, extension: 'png', contentBase64: 'AA==' }]
      };
    }
  });

  const resolved = await service.resolveFileIds([fileId]);
  assert.match(resolved[fileId], /zhichong-media-cache/);
  delete global.wx;
});

test('clearing during an in-flight write prevents stale cache resurrection', async () => {
  const { storage, files } = installWxMock('owner-a');
  const originalGetFileSystemManager = global.wx.getFileSystemManager;
  let releaseWrite = null;
  global.wx.getFileSystemManager = () => {
    const fs = originalGetFileSystemManager();
    fs.writeFile = (options) => {
      releaseWrite = () => {
        files.add(options.filePath);
        options.success({});
      };
    };
    return fs;
  };

  const { MediaStorageService, CACHE_INDEX_STORAGE_KEY } = require('./MediaStorageService');
  const fileId = 'local://clear-race';
  const service = new MediaStorageService({
    async resolveMedia() {
      return {
        success: true,
        media: [{ fileId, extension: 'jpg', contentBase64: 'AA==' }]
      };
    }
  });

  const resolving = service.resolveFileIds([fileId]);
  for (let attempt = 0; attempt < 10 && !releaseWrite; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof releaseWrite, 'function');
  const clearing = service.clearDisplayCache();
  await new Promise((resolve) => setImmediate(resolve));
  releaseWrite();
  const resolved = await resolving;
  await clearing;

  assert.equal(resolved[fileId], undefined);
  assert.equal(service.displayCache.size, 0);
  assert.equal(storage.has(CACHE_INDEX_STORAGE_KEY), false);
  assert.equal(files.size, 0);
  delete global.wx;
});

test('media resolve outage falls back without failing the surrounding page data', async () => {
  installWxMock('owner-a');
  const { MediaStorageService } = require('./MediaStorageService');
  const service = new MediaStorageService({
    async resolveMedia() { throw new Error('media endpoint offline'); }
  });

  const resolved = await service.resolveFileId('local://offline-image', 'fallback.png');
  assert.equal(resolved, 'fallback.png');
  delete global.wx;
});

test('a resolution started during cache clearing waits for a clean generation', async () => {
  const { storage, files } = installWxMock('owner-a');
  const originalGetFileSystemManager = global.wx.getFileSystemManager;
  let releaseDirectoryRead = null;
  global.wx.getFileSystemManager = () => {
    const fs = originalGetFileSystemManager();
    fs.readdir = (options) => {
      releaseDirectoryRead = () => options.success({ files: [] });
    };
    return fs;
  };
  const { MediaStorageService, CACHE_INDEX_STORAGE_KEY } = require('./MediaStorageService');
  let resolveCalls = 0;
  const fileId = 'local://after-clear';
  const service = new MediaStorageService({
    async resolveMedia() {
      resolveCalls += 1;
      return {
        success: true,
        media: [{ fileId, extension: 'png', contentBase64: 'AA==' }]
      };
    }
  });

  const clearing = service.clearDisplayCache();
  const resolving = service.resolveFileIds([fileId]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolveCalls, 0);
  releaseDirectoryRead();
  await clearing;
  const resolved = await resolving;

  assert.equal(resolveCalls, 1);
  assert.ok(resolved[fileId]);
  assert.equal(files.has(resolved[fileId]), true);
  assert.equal(storage.get(CACHE_INDEX_STORAGE_KEY)['owner-a'][fileId], resolved[fileId]);
  delete global.wx;
});

test('cache clearing removes an earlier memory hit from a mixed in-flight result', async () => {
  installWxMock('owner-a');
  const { MediaStorageService } = require('./MediaStorageService');
  const cachedId = 'local://already-cached';
  const pendingId = 'local://still-resolving';
  let releasePending = null;
  const service = new MediaStorageService({
    async resolveMedia(fileIds) {
      if (fileIds.includes(pendingId)) {
        return new Promise((resolve) => {
          releasePending = () => resolve({
            success: true,
            media: [{ fileId: pendingId, extension: 'jpg', contentBase64: 'AA==' }]
          });
        });
      }
      return {
        success: true,
        media: [{ fileId: cachedId, extension: 'jpg', contentBase64: 'AA==' }]
      };
    }
  });
  assert.ok((await service.resolveFileIds([cachedId]))[cachedId]);

  const resolving = service.resolveFileIds([cachedId, pendingId]);
  for (let attempt = 0; attempt < 10 && !releasePending; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof releasePending, 'function');
  const clearing = service.clearDisplayCache();
  releasePending();
  const resolved = await resolving;
  await clearing;

  assert.deepEqual(resolved, {});
  delete global.wx;
});

test('an old write cannot delete a same-id cache committed after clearing', async () => {
  const { storage, files } = installWxMock('owner-a');
  const originalGetFileSystemManager = global.wx.getFileSystemManager;
  let releaseOldWrite = null;
  let writeCount = 0;
  global.wx.getFileSystemManager = () => {
    const fs = originalGetFileSystemManager();
    fs.writeFile = (options) => {
      writeCount += 1;
      if (writeCount === 1) {
        releaseOldWrite = () => {
          files.add(options.filePath);
          options.success({});
        };
        return;
      }
      files.add(options.filePath);
      options.success({});
    };
    return fs;
  };
  const { MediaStorageService, CACHE_INDEX_STORAGE_KEY } = require('./MediaStorageService');
  const fileId = 'local://same-id-across-clear';
  let resolveCalls = 0;
  const service = new MediaStorageService({
    async resolveMedia() {
      resolveCalls += 1;
      return {
        success: true,
        media: [{ fileId, extension: 'jpg', contentBase64: 'AA==' }]
      };
    }
  });

  const oldResolution = service.resolveFileIds([fileId]);
  for (let attempt = 0; attempt < 10 && !releaseOldWrite; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof releaseOldWrite, 'function');
  const clearing = service.clearDisplayCache();
  const freshResolution = service.resolveFileIds([fileId]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolveCalls, 1, '新代解析必须等待旧代完成并清理');

  releaseOldWrite();
  assert.deepEqual(await oldResolution, {});
  await clearing;
  const fresh = await freshResolution;

  assert.equal(resolveCalls, 2);
  assert.ok(fresh[fileId]);
  assert.equal(files.has(fresh[fileId]), true);
  assert.equal(storage.get(CACHE_INDEX_STORAGE_KEY)['owner-a'][fileId], fresh[fileId]);
  delete global.wx;
});
