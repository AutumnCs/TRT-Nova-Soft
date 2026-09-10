import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSecretLoader, parseReference, roleCredentials } = require('../overlays/cloud-secrets');
const { createMediaStore, storageConfig } = require('../overlays/cloud-media');

const config = { MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'nova-staging-1234567890',
  COS_REGION: 'ap-guangzhou', COS_PREFIX: 'nova-staging/acceptance/' };
test('SSM以逻辑引用取字段，同一凭据只读一次，全部就绪才注入', async () => {
  const env = { NOVA_SECRET_STRATEGY: 'runtime-ssm-sdk',
    NOVA_SECRET_REFS: JSON.stringify({ DB_USER: 'secret://nova/db#user', DB_PASSWORD: 'secret://nova/db#password' }) };
  let calls = 0;
  const load = createSecretLoader({ env, async getSecret(name) {
    assert.equal(name, 'nova/db'); calls++;
    assert.equal(env.DB_USER, undefined);
    return { SecretString: JSON.stringify({ user: 'synthetic-user', password: 'synthetic-pass' }) };
  } });
  await Promise.all([load(), load()]);
  assert.equal(calls, 1);
  assert.equal(env.DB_USER, 'synthetic-user');
  assert.equal(env.DB_PASSWORD, 'synthetic-pass');
});
test('SSM失败不半写env、不暴露Provider错误中的秘密，并允许重试', async () => {
  const env = { NOVA_SECRET_STRATEGY: 'runtime-ssm-sdk',
    NOVA_SECRET_REFS: JSON.stringify({ JWT_SECRET: 'secret://nova/auth', WECHAT_SECRET: 'secret://nova/wechat' }) };
  let shouldFail = true;
  const load = createSecretLoader({ env, async getSecret(name) {
    if (name.endsWith('wechat') && shouldFail) throw new Error('forbidden-secret-in-provider-error');
    return { SecretString: 'synthetic-content' };
  } });
  await assert.rejects(load(), error => error.message === 'CLOUD_SECRET_RESOLUTION_FAILED');
  assert.equal(env.JWT_SECRET, undefined);
  shouldFail = false; await load();
  assert.equal(env.WECHAT_SECRET, 'synthetic-content');
});
test('SSM只接受密钥目标白名单和逻辑引用，不接受本机文件或运行环境注入', async () => {
  for (const reference of ['file:///tmp/key', 'secret://nova/../auth', 'https://example.invalid/key']) {
    assert.throws(() => parseReference(reference));
  }
  assert.throws(() => roleCredentials({ TENCENTCLOUD_SECRETID: 'permanent', TENCENTCLOUD_SECRETKEY: 'key' }));
  const load = createSecretLoader({ env: { NOVA_SECRET_STRATEGY: 'runtime-ssm-sdk',
    NOVA_SECRET_REFS: JSON.stringify({ NODE_OPTIONS: 'secret://nova/auth' }) },
    getSecret() { assert.fail('Must not fetch'); } });
  await assert.rejects(load(), /CLOUD_SECRET_RESOLUTION_FAILED/);
});
test('COS必须限定私有staging桶和前缀，不接受对象路径遍历', async () => {
  assert.throws(() => storageConfig({ ...config, COS_PREFIX: '../anything/' }));
  assert.throws(() => storageConfig({ ...config, COS_BUCKET: '' }));
  const store = createMediaStore({ env: config, clientFactory() { assert.fail('Must not call COS'); } });
  await assert.rejects(store.read({ async execute() { return [[{
    object_key: '../other-object', bucket: config.COS_BUCKET, region: config.COS_REGION, byte_size: 1
  }]]; } }, 'owner', 'cos://object'), error => error.statusCode === 503);
});
test('COS读文件先查owner且不暴露原始objectKey，未授权不请求COS', async () => {
  let query;
  const store = createMediaStore({ env: config, clientFactory() { assert.fail('Must not call COS'); } });
  const db = { async execute(sql, params) { query = { sql, params }; return [[]]; } };
  await assert.rejects(store.read(db, 'other-owner', 'cos://object'), error => error.statusCode === 404);
  assert.match(query.sql, /c.openid = \?/);
  assert.deepEqual(query.params, ['cos://object', 'other-owner']);
});
test('COS字节经sha256与长度校验，拒绝丢字节或对象被替换', async () => {
  const original = Buffer.from('care notes');
  const row = { object_key: config.COS_PREFIX + 'opaque', bucket: config.COS_BUCKET,
    region: config.COS_REGION, byte_size: original.length,
    sha256: crypto.createHash('sha256').update(original).digest('hex') };
  let body = original;
  const store = createMediaStore({ env: config, clientFactory() {
    return { getObject(options, callback) {
      assert.equal(options.DataType, 'buffer'); assert.equal(options.Bucket, config.COS_BUCKET);
      assert.match(options.Range, /^bytes=0-/); callback(null, { Body: body });
    } };
  } });
  const db = { async execute() { return [[row]]; } };
  assert.deepEqual(await store.read(db, 'owner', 'cos://object'), original);
  body = Buffer.from('other text');
  await assert.rejects(store.read(db, 'owner', 'cos://object'), /CLOUD_MEDIA_INTEGRITY_FAILED/);
});
test('COS上传先持久化意图，远端写失败留待清理，不伪装成已保存', async () => {
  const calls = [];
  const db = { async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const store = createMediaStore({ env: config, clientFactory() { return {
    putObject(options, callback) {
      assert.match(calls[0].sql, /INSERT INTO cloud_media_objects/);
      assert.equal(options.ACL, 'private');
      assert.ok(!options.Key.includes('owner-secret'));
      callback(new Error('credential-and-request-details'));
    }
  }; } });
  await assert.rejects(store.upload(db, 'owner-secret', {
    buffer: Buffer.from('text'), mimeType: 'text/plain', byteSize: 4, purpose: 'conversation_document'
  }), error => error.statusCode === 503 && !error.message.includes('credential'));
  assert.match(calls.at(-1).sql, /state = 'pending'/);
  assert.equal(calls.some(call => /INSERT INTO media_objects/.test(call.sql)), false);
});
