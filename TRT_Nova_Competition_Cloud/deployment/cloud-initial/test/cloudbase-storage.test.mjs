import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { createStorage, storageConfig, nativeFileInfo, downloadBounded, MAX_MEDIA_BYTES } = require('../overlays/cloudbase-storage');
const env = { MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-images-test',
  CLOUDBASE_STORAGE_REGION: 'ap-guangzhou', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/test/images/' };
const cloudPath = env.CLOUDBASE_STORAGE_PREFIX + '12345678-1234-1234-1234-123456789abc.png';
const bucket = 'test-bucket-1250000000';
const fileId = 'cloud://' + env.CLOUDBASE_STORAGE_ENV_ID + '.' + bucket + '/' + cloudPath;

test('CloudBase requires explicit env and bounded native file IDs, never adopts another environment', () => {
  const config = storageConfig(env);
  assert.deepEqual(nativeFileInfo(fileId, config, cloudPath), { bucket, cloudPath });
  for (const key of Object.keys(env)) assert.throws(() => storageConfig({ ...env, [key]: '' }), /CONFIGURATION/);
  for (const id of [fileId.replace('nova-images-test', 'another-env'), fileId.replace('.png', '.exe'),
    fileId.replace('/images/', '/images/../'), 'cloud://opaque', fileId + 'x'.repeat(200)]) {
    assert.throws(() => nativeFileInfo(id, config, cloudPath), /FILE_ID/);
  }
});

test('CloudBase adapter keeps upload tokens private, checks per-file status, reads and deletes exactly one file', async () => {
  const calls = [];
  const client = {
    async getUploadMetadata(input, opts) {
      calls.push(['prepare', input, opts]); return { fileId, authorization: 'not-for-client', token: 'not-for-client' };
    },
    async getTempFileURL(input, opts) {
      calls.push(['read', input, opts]); return { fileList: [{ fileid: fileId, status: 0,
        download_url: 'https://' + bucket + '.cos.ap-guangzhou.myqcloud.com/' + cloudPath }] };
    },
    async deleteFile(input, opts) { calls.push(['delete', input, opts]); return { fileList: [{ fileid: fileId, status: 0 }] }; }
  };
  const store = createStorage({ env, clientFactory: config => { assert.equal(config.envId, env.CLOUDBASE_STORAGE_ENV_ID); return client; },
    download: async (url, config) => { assert.equal(config.bucket, bucket); return Buffer.from('pixel'); } });
  const prepared = await store.prepare(cloudPath);
  assert.equal(prepared.fileId, fileId); assert.doesNotMatch(JSON.stringify(prepared), /not-for-client|authorization|token/);
  assert.equal((await store.read(fileId, cloudPath)).toString(), 'pixel');
  await store.remove(fileId, cloudPath);
  assert.deepEqual(calls.map(item => item[0]), ['prepare', 'read', 'delete']);
  for (const call of calls) assert.equal(call[2], undefined);
  assert.deepEqual(calls[1][1].fileList, [{ fileID: fileId, maxAge: 60 }]);
  client.deleteFile = async () => ({ fileList: [{ fileid: fileId, status: -501007 }] });
  await assert.rejects(store.remove(fileId, cloudPath), /DELETE_FAILED/);
  client.getTempFileURL = async () => ({ fileList: [{ fileid: 'another-file', status: 0, download_url: 'https://example.invalid' }] });
  await assert.rejects(store.read(fileId, cloudPath), /METADATA_FAILED/);
});

function fakeRequest({ chunks = [Buffer.from('pixel')], status = 200, headers = {} } = {}) {
  return (url, options, callback) => {
    assert.equal(options.headers.Range, 'bytes=0-2097152');
    const request = new EventEmitter(); request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = status; response.headers = headers; response.destroy = () => {};
      callback(response);
      for (const chunk of chunks) response.emit('data', chunk);
      response.emit('end');
    });
    return request;
  };
}

test('CloudBase media download blocks redirects, foreign hosts, compressed or oversized bodies', async () => {
  const origin = 'https://' + bucket + '.cos.ap-guangzhou.myqcloud.com/image';
  const config = { bucket, region: 'ap-guangzhou' };
  assert.equal((await downloadBounded(origin, config, fakeRequest())).toString(), 'pixel');
  for (const url of ['http://example.invalid', 'https://evil.invalid', origin.replace('https://', 'https://user@')]) {
    assert.throws(() => downloadBounded(url, config, fakeRequest()), /ORIGIN/);
  }
  for (const options of [{ status: 302 }, { headers: { 'content-encoding': 'gzip' } },
    { headers: { 'content-length': MAX_MEDIA_BYTES + 1 } }, { chunks: [Buffer.alloc(MAX_MEDIA_BYTES), Buffer.from('x')] }]) {
    await assert.rejects(downloadBounded(origin, config, fakeRequest(options)), /DOWNLOAD_FAILED/);
  }
});
