const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MediaStorageService } = require('./MediaStorageService');
const envId = 'nova-images-test';
const cloudPath = 'nova-staging/test/images/12345678-1234-1234-1234-123456789abc.png';
const fileId = 'cloud://' + envId + '.bucket-1250000000/' + cloudPath;

function setup() {
  const config = { useCloudBase: false, mediaStorageProvider: 'cloudbase', cloudbaseStorageEnvId: envId };
  const storage = new Map([['apiAccessTokenMeta', { openid: 'owner-a' }]]);
  const calls = []; const files = new Map(); const faults = {};
  let uploadPath = cloudPath; let uploadId = fileId;
  global.getApp = () => ({ globalData: { runtimeConfig: config } });
  global.wx = {
    env: { USER_DATA_PATH: '/user-data' },
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    getFileSystemManager: () => ({
      getFileInfo: value => value.success({ size: faults.oversize ? 3 * 1024 * 1024 : faults.documentOversize ? 1024 * 1024 + 1 : 32 }),
      readFile: value => value.success({ data: 'aW1hZ2U=' }),
      access: value => files.has(value.path) ? value.success() : value.fail(),
      mkdir: value => value.success(),
      writeFile: value => { files.set(value.filePath, value.data); value.success(); },
      unlink: value => { files.delete(value.filePath); value.success(); }
    }),
    cloud: {
      uploadFile: value => {
        calls.push('wx-upload'); assert.equal(value.cloudPath, uploadPath); assert.equal(value.config.env, envId);
        if (faults.switchAccount) storage.set('apiAccessTokenMeta', { openid: 'owner-b' });
        if (faults.upload) value.fail({ errMsg: 'raw-sdk-secret-must-not-leak' });
        else value.success({ fileID: faults.wrongId ? uploadId + '-wrong' : uploadId });
      },
      getTempFileURL: () => { throw new Error('Business images must resolve through authenticated SCF'); }
    }
  };
  const adapter = {
    uploadMedia: async input => {
      calls.push(input.purpose);
      uploadPath = input.purpose === 'conversation_document' ? cloudPath.replace('.png', '.txt') : cloudPath;
      uploadId = fileId.replace(cloudPath, uploadPath);
      return { success: true, upload: { mode: 'cloudbase-client', envId: faults.wrongEnv ? 'another-env' : envId, cloudPath: uploadPath, fileId: uploadId } };
    },
    completeMediaUpload: async id => {
      calls.push('complete'); assert.equal(id, uploadId);
      return faults.complete ? { success: false, msg: '登记失败' } : { success: true, media: { fileId: uploadId } };
    },
    discardMedia: async id => { calls.push('discard'); assert.equal(id, uploadId); return { success: true }; },
    resolveMedia: async ids => {
      calls.push('resolve'); assert.equal(ids.length, 1);
      return { success: true, media: [{ fileId: ids[0], extension: 'png', contentBase64: 'aW1hZ2U=' }] };
    }
  };
  return { config, storage, calls, files, faults, adapter, service: new MediaStorageService(adapter) };
}
test.afterEach(() => { delete global.wx; delete global.getApp; });

test('小程序为附件独立初始化云开发，缺配置时不借用旧环境', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  for (const configured of [true, false]) {
    let app; const calls = [];
    vm.runInNewContext(source, {
      require: name => {
        if (name === './envList') return { envList: ['old-env-never-use'] };
        if (name.endsWith('runtime-profile')) return { resolveAppRuntimeConfig: () => ({
          useCloudBase: false, mediaStorageProvider: 'cloudbase', cloudbaseStorageEnvId: configured ? envId : ''
        }) };
        return {};
      },
      App: value => { app = value; }, console: { warn() {}, error() {} },
      wx: { weixinMiniProgramLogin() {}, cloud: { init: value => calls.push(value.env) } }
    });
    app.checkLoginStatus = () => {}; app.onLaunch();
    assert.deepEqual(calls, configured ? [envId] : []);
  }
});

test('图片和文档都经过 SCF 准备、原生微信上传和登记', async () => {
  const { service, calls } = setup();
  assert.equal(await service.uploadImage('/tmp/photo.png', 'profile_avatar'), fileId);
  assert.deepEqual(calls, ['profile_avatar', 'wx-upload', 'complete']);
  const doc = await service.uploadDocument({ path: '/tmp/notes.txt', name: 'notes.txt' });
  assert.equal(doc.fileId, fileId.replace('.png', '.txt'));
  assert.deepEqual(calls.slice(3), ['conversation_document', 'wx-upload', 'complete']);
});

test('未配置环境、超限图片、SDK失败、错误环境/标识和登记失败均不返回已保存图片', async () => {
  for (const fault of ['missingEnv', 'oversize', 'upload', 'wrongEnv', 'wrongId', 'complete']) {
    const { service, config, faults, calls } = setup();
    if (fault === 'missingEnv') config.cloudbaseStorageEnvId = '';
    else faults[fault] = true;
    await assert.rejects(service.uploadImage('/tmp/photo.png', 'conversation_image'),
      error => !error.message.includes('raw-sdk-secret'));
    if (['missingEnv', 'oversize'].includes(fault)) assert.equal(calls.length, 0);
    else assert.equal(calls.at(-1), 'discard');
    if (['upload', 'wrongEnv', 'wrongId'].includes(fault)) assert.equal(calls.includes('complete'), false);
  }
});

test('上传中切换账号后不登记到新账号，也不借新账号删除原账号文件', async () => {
  const { service, faults, calls } = setup(); faults.switchAccount = true;
  await assert.rejects(service.uploadImage('/tmp/photo.png', 'conversation_image'), /账号已变化/);
  assert.deepEqual(calls, ['conversation_image', 'wx-upload']);
});

test('CloudBase 原生标识沿用 SCF 归属检查、跨启动缓存和账号隔离', async () => {
  const { service, adapter, calls, storage } = setup();
  const first = await service.resolveFileIds([fileId]);
  assert.ok(first[fileId]);
  assert.deepEqual(await new MediaStorageService(adapter).resolveFileIds([fileId]), first);
  assert.deepEqual(calls, ['resolve']);
  storage.set('apiAccessTokenMeta', { openid: 'owner-b' });
  const other = await new MediaStorageService(adapter).resolveFileIds([fileId]);
  assert.notEqual(other[fileId], first[fileId]);
  await service.discard(fileId); assert.equal(calls.at(-1), 'discard');
});
test('文档保持 1 MiB 限制，上传失败取消，切换账号后不登记或越权删除', async () => {
  for (const fault of ['documentOversize', 'upload', 'complete', 'switchAccount']) {
    const { service, faults, calls } = setup(); faults[fault] = true;
    await assert.rejects(service.uploadDocument({ path: '/tmp/notes.txt', name: 'notes.txt' }));
    if (fault === 'documentOversize') assert.equal(calls.length, 0);
    else if (fault === 'switchAccount') assert.deepEqual(calls, ['conversation_document', 'wx-upload']);
    else assert.equal(calls.at(-1), 'discard');
  }
});
