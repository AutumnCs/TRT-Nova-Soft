// Run AFTER a full candidate build. Real frozen SDKs, local HTTP protocol doubles.
// This exercises signing/serialization, not Tencent service behavior or CAM policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../build/api-scf/cloud-entry.js', import.meta.url));

test('冻结COS和SSM SDK真实序列化、签名和临时token，仅与本机HTTP替身通信', async () => {
  const COS = require('cos-nodejs-sdk-v5');
  const Client = require('tencentcloud-sdk-nodejs-ssm').ssm.v20190923.Client;
  const seen = []; const objects = new Map();
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ method: request.method, path: request.url, headers: request.headers, body });
    if (request.headers['x-tc-action'] === 'GetSecretValue') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ Response: { SecretString: 'synthetic-value', RequestId: 'local-only' } }));
      return;
    }
    if (request.method === 'PUT') {
      objects.set(request.url, body); response.setHeader('etag', '"local-etag"'); response.end(); return;
    }
    if (request.method === 'GET' && objects.has(request.url)) {
      response.setHeader('content-type', 'application/octet-stream'); response.end(objects.get(request.url)); return;
    }
    if (request.method === 'DELETE') { objects.delete(request.url); response.statusCode = 204; response.end(); return; }
    response.statusCode = 404; response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
    if (options.host !== '127.0.0.1' || Number(options.port) !== port) throw new Error('TEST_EXTERNAL_NETWORK_BLOCKED');
    return connect.apply(this, args);
  };
  try {
    const cos = new COS({ SecretId: 'synthetic-id', SecretKey: 'synthetic-key', SecurityToken: 'synthetic-token',
      Protocol: 'http:', Domain: `127.0.0.1:${port}`, Timeout: 1500 });
    const params = { Bucket: 'nova-staging-1234567890', Region: 'ap-guangzhou', Key: 'nova-staging/test/opaque' };
    const invoke = (method, extra = {}) => new Promise((resolve, reject) => cos[method]({ ...params, ...extra },
      (error, result) => error ? reject(new Error('LOCAL_COS_SDK_CALL_FAILED: ' + (error.code || error.message))) : resolve(result)));
    await invoke('putObject', { Body: Buffer.from('real SDK bytes'), ACL: 'private' });
    const downloaded = await invoke('getObject', { DataType: 'buffer' });
    assert.equal(Buffer.from(downloaded.Body).toString(), 'real SDK bytes');
    await invoke('deleteObject');
    assert.equal(objects.size, 0);
    const cosRequests = seen.filter(item => !item.headers['x-tc-action']);
    assert.deepEqual(cosRequests.map(item => item.method), ['PUT', 'GET', 'DELETE']);
    for (const request of cosRequests) {
      assert.match(request.headers.authorization, /q-sign-algorithm=sha1/);
      assert.equal(request.headers['x-cos-security-token'], 'synthetic-token');
    }
    assert.equal(cosRequests[0].headers['x-cos-acl'], 'private');
    const ssm = new Client({ credential: { secretId: 'synthetic-id', secretKey: 'synthetic-key', token: 'synthetic-token' },
      region: 'ap-guangzhou', profile: { httpProfile: { protocol: 'http:', endpoint: `127.0.0.1:${port}`, reqTimeout: 2,
        agent: new http.Agent({ keepAlive: false }) } } });
    const value = await ssm.GetSecretValue({ SecretName: 'nova-staging/mysql', VersionId: 'SSM_Current' });
    assert.equal(value.SecretString, 'synthetic-value');
    const request = seen.at(-1);
    assert.match(request.headers.authorization, /^TC3-HMAC-SHA256 /);
    assert.equal(request.headers['x-tc-token'], 'synthetic-token');
    assert.deepEqual(JSON.parse(request.body.toString()), { SecretName: 'nova-staging/mysql', VersionId: 'SSM_Current' });
  } finally {
    net.Socket.prototype.connect = connect;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
