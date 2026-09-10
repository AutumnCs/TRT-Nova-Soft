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

test('COS附件分批走可信后端、恢复缓存并按账号隔离，取消时调用discard', async () => {
  const { storage } = installWxMock('owner-cos-a');
  const { MediaStorageService } = require('./MediaStorageService');
  const ids = ['cos://12345678-1234-1234-1234-123456789abc', 'cos://12345678-1234-1234-1234-123456789abd'];
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
    storage.set('apiAccessTokenMeta', { openid: 'owner-cos-b' });
    const other = await new MediaStorageService(adapter).resolveFileIds(ids);
    assert.notEqual(first[ids[0]], other[ids[0]]);
    await firstService.discard(ids[0]);
    assert.deepEqual(calls.at(-1), ['discard', ids[0]]);
  } finally { delete global.wx; }
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
