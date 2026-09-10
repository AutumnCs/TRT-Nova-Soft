import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMediaStore, storageConfig } = require('../overlays/cloud-media');
const config = { MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-media-test',
  CLOUDBASE_STORAGE_REGION: 'ap-shanghai', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/test/media/' };
const bucket = 'fixture-1250000000';
const objectKey = config.CLOUDBASE_STORAGE_PREFIX + '12345678-1234-1234-1234-123456789abc.txt';
const fileId = 'cloud://' + config.CLOUDBASE_STORAGE_ENV_ID + '.' + bucket + '/' + objectKey;

test('CloudBase 显式环境和前缀，不接受目录遍历或已退役的 COS 配置', async () => {
  assert.throws(() => storageConfig({ ...config, CLOUDBASE_STORAGE_PREFIX: '../anything/' }));
  assert.throws(() => storageConfig({ ...config, MEDIA_STORAGE_PROVIDER: 'cos' }));
  const store = createMediaStore({ env: config, cloudbase: { read() { assert.fail('Must not read provider'); } } });
  await assert.rejects(store.read({ async execute() { return [[{
    object_key: '../other-object', bucket, region: config.CLOUDBASE_STORAGE_REGION, byte_size: 1
  }]]; } }, 'owner', fileId), error => error.statusCode === 503);
});
test('读文件先查 owner，未授权不请求云开发存储', async () => {
  let query;
  const store = createMediaStore({ env: config, cloudbase: { read() { assert.fail('Must not read provider'); } } });
  const db = { async execute(sql, params) { query = { sql, params }; return [[]]; } };
  await assert.rejects(store.read(db, 'other-owner', fileId), error => error.statusCode === 404);
  assert.match(query.sql, /c.openid = \?/);
  assert.deepEqual(query.params, [fileId, 'other-owner']);
});
test('文件字节经 sha256 与长度校验，拒绝丢字节或文件被替换', async () => {
  const original = Buffer.from('care notes');
  const row = { object_key: objectKey, bucket, region: config.CLOUDBASE_STORAGE_REGION,
    byte_size: original.length, sha256: crypto.createHash('sha256').update(original).digest('hex') };
  let body = original;
  const store = createMediaStore({ env: config, cloudbase: { async read(id, key) {
    assert.equal(id, fileId); assert.equal(key, objectKey); return body;
  } } });
  const db = { async execute() { return [[row]]; } };
  assert.deepEqual(await store.read(db, 'owner', fileId), original);
  body = Buffer.from('other text');
  await assert.rejects(store.read(db, 'owner', fileId), /CLOUD_MEDIA_INTEGRITY_FAILED/);
});
test('上传准备只登记 pending 意图，失败不泄漏服务端信息，也不伪装成已保存', async () => {
  const calls = []; let fail = true;
  const db = { async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const store = createMediaStore({ env: config, cloudbase: { async prepare(key) {
    if (fail) throw new Error('provider-secret-details');
    return { fileId: 'cloud://' + config.CLOUDBASE_STORAGE_ENV_ID + '.' + bucket + '/' + key, bucket };
  } } });
  const value = { buffer: Buffer.from('text'), mimeType: 'text/plain', byteSize: 4, purpose: 'conversation_document' };
  await assert.rejects(store.prepareUpload(db, 'owner-secret', value),
    error => error.statusCode === 503 && !error.message.includes('provider-secret'));
  assert.equal(calls.length, 0);
  fail = false;
  const grant = await store.prepareUpload(db, 'owner-secret', value);
  assert.equal(grant.mode, 'cloudbase-client');
  assert.ok(grant.cloudPath.endsWith('.txt')); assert.ok(!grant.cloudPath.includes('owner-secret'));
  assert.match(calls[0].sql, /INSERT INTO cloud_media_objects/);
  assert.match(calls[0].sql, /'pending'/);
  assert.equal(calls.some(call => /INSERT INTO media_objects/.test(call.sql)), false);
});
