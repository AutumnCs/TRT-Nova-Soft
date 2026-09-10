// Real HTTP serialization to a loopback server only; this does not validate WeChat service behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createStorage, createWechatClient } = require(process.env.NOVA_TEST_USE_BUILT === 'true'
  ? '../build/api-scf/cloudbase-storage.js' : '../overlays/cloudbase-storage.js');
const env = { MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-media-test',
  CLOUDBASE_STORAGE_REGION: 'ap-shanghai', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/test/media/',
  WECHAT_APPID: 'wxfixture', WECHAT_SECRET: 'synthetic-wechat-secret' };
const bucket = 'test-bucket-1250000000';
const cloudPath = env.CLOUDBASE_STORAGE_PREFIX + '12345678-1234-1234-1234-123456789abc.txt';
const fileId = 'cloud://' + env.CLOUDBASE_STORAGE_ENV_ID + '.' + bucket + '/' + cloudPath;

async function withServer(handle, run) {
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      await handle(new URL(request.url, 'http://localhost'), JSON.parse(Buffer.concat(chunks)), response);
    } catch (error) { response.statusCode = 500; response.end('local-fixture-failed'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
    if (options.host !== '127.0.0.1' || Number(options.port) !== port) throw new Error('TEST_EXTERNAL_NETWORK_BLOCKED');
    return connect.apply(this, args);
  };
  try {
    await run((url, options, callback) => {
      assert.equal(url.hostname, 'api.weixin.qq.com'); assert.equal(url.protocol, 'https:');
      assert.equal(options.method, 'POST'); assert.equal(options.headers['content-type'], 'application/json');
      return http.request('http://127.0.0.1:' + port + url.pathname + url.search, options, callback);
    });
  } finally {
    net.Socket.prototype.connect = connect;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
function json(response, value) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); }

test('微信 stable_token 单次并发缓存，三种原生文件 HTTP 协议及 token 隔离', async () => {
  const seen = []; let tokenCount = 0; let now = 1000000; let invalid = false;
  await withServer((url, payload, response) => {
    seen.push({ path: url.pathname, payload });
    if (url.pathname === '/cgi-bin/stable_token') {
      assert.deepEqual(payload, { grant_type: 'client_credential', appid: env.WECHAT_APPID,
        secret: env.WECHAT_SECRET, force_refresh: false });
      tokenCount++; return json(response, { access_token: 'server-only-token-' + tokenCount, expires_in: 7200 });
    }
    assert.equal(payload.env, env.CLOUDBASE_STORAGE_ENV_ID);
    assert.equal(url.searchParams.get('access_token'), 'server-only-token-' + tokenCount);
    if (invalid) { invalid = false; return json(response, { errcode: 42001, errmsg: 'raw-provider-secret' }); }
    if (url.pathname === '/tcb/uploadfile') {
      assert.equal(payload.path, cloudPath);
      json(response, { errcode: 0, file_id: fileId, authorization: 'not-for-client', token: 'not-for-client' });
    } else if (url.pathname === '/tcb/batchdownloadfile') {
      assert.deepEqual(payload.file_list, [{ fileid: fileId, max_age: 60 }]);
      json(response, { errcode: 0, file_list: [{ fileid: fileId, status: 0,
        download_url: 'https://' + bucket + '.tcb.qcloud.la/' + cloudPath }] });
    } else if (url.pathname === '/tcb/batchdeletefile') {
      assert.deepEqual(payload.fileid_list, [fileId]);
      json(response, { errcode: 0, delete_list: [{ fileid: fileId, status: 0 }] });
    } else assert.fail('Unexpected operation');
  }, async request => {
    const client = createWechatClient({ envId: env.CLOUDBASE_STORAGE_ENV_ID }, { request, env, now: () => now });
    const storage = createStorage({ env, clientFactory: () => client, download: async () => Buffer.from('notes') });
    const grants = await Promise.all([storage.prepare(cloudPath), storage.prepare(cloudPath)]);
    assert.equal(tokenCount, 1);
    for (const grant of grants) {
      assert.equal(grant.fileId, fileId); assert.doesNotMatch(JSON.stringify(grant), /server-only|not-for-client|authorization/);
    }
    assert.equal((await storage.read(fileId, cloudPath)).toString(), 'notes');
    await storage.remove(fileId, cloudPath); assert.equal(tokenCount, 1);
    now += 7081000; await storage.prepare(cloudPath); assert.equal(tokenCount, 2);
    invalid = true; await storage.prepare(cloudPath); assert.equal(tokenCount, 3);
    assert.ok(seen.some(item => item.path === '/tcb/batchdeletefile'));
  });
});

test('微信 HTTP 错误、无效 JSON、重定向、压缩和过大响应失败且不泄漏凭据', async () => {
  for (const fault of ['http', 'json', 'redirect', 'compressed', 'oversize', 'token', 'file-api']) {
    let count = 0;
    await withServer((url, payload, response) => {
      count++;
      if (fault === 'http') { response.statusCode = 500; response.end('raw-provider-secret'); }
      else if (fault === 'json') response.end('not-json-raw-provider-secret');
      else if (fault === 'redirect') { response.statusCode = 302; response.setHeader('location', 'https://foreign.invalid'); response.end(); }
      else if (fault === 'compressed') { response.setHeader('content-encoding', 'gzip'); response.end('raw-provider-secret'); }
      else if (fault === 'oversize') response.end('x'.repeat(65537));
      else if (fault === 'token') json(response, { errcode: 40013, errmsg: 'raw-provider-secret' });
      else if (url.pathname === '/cgi-bin/stable_token') json(response, { access_token: 'server-only-token', expires_in: 7200 });
      else json(response, { errcode: 40014, errmsg: 'raw-provider-secret' }); // At most one token refresh.
    }, async request => {
      const client = createWechatClient({ envId: env.CLOUDBASE_STORAGE_ENV_ID }, { request, env });
      await assert.rejects(client.getUploadMetadata({ cloudPath }),
        error => /^CLOUDBASE_/.test(error.message) && !/raw-provider|synthetic|server-only/.test(error.message));
      assert.equal(count, fault === 'file-api' ? 4 : 1);
    });
  }
});
