'use strict';

const https = require('node:https');
const REQUEST_OPTIONS = Object.freeze({ timeout: 5000, retryOptions: { retries: 0 } });
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9-]{36}\.(?:jpg|png|webp|pdf|docx|txt|md|csv|json)$/;

function storageConfig(env = process.env) {
  const envId = String(env.CLOUDBASE_STORAGE_ENV_ID || '');
  const region = String(env.CLOUDBASE_STORAGE_REGION || '');
  const prefix = String(env.CLOUDBASE_STORAGE_PREFIX || '');
  if (env.MEDIA_STORAGE_PROVIDER !== 'cloudbase' || !/^[a-z0-9][a-z0-9-]{3,63}$/.test(envId) ||
      !/^[a-z]+-[a-z0-9-]+$/.test(region) || !/^nova-staging\/[a-z0-9_-]{1,32}\/(?:images|media)\/$/.test(prefix)) {
    throw new Error('CLOUDBASE_STORAGE_CONFIGURATION_INVALID');
  }
  return { envId, region, prefix };
}

function nativeFileInfo(fileId, config, expectedPath) {
  const match = /^cloud:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\/(.+)$/.exec(String(fileId || ''));
  // All business/media references use the existing VARCHAR(191) contract.
  if (!match || fileId.length > 191 || match[1] !== config.envId || match[2].length > 128 ||
      !match[3].startsWith(config.prefix) || !FILE_NAME.test(match[3].slice(config.prefix.length)) ||
      (expectedPath && match[3] !== expectedPath)) throw new Error('CLOUDBASE_FILE_ID_INVALID');
  return { bucket: match[2], cloudPath: match[3] };
}

// Same WeChat AppID/AppSecret environment configuration as LastScf auth.
// Only the server calls these WeChat CloudBase file APIs; no COS/SSM/CAM SDK.
// https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-http-api/storage/uploadFile.html
// https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getstableaccesstoken.html
function createWechatClient(config, { request = https.request, env = process.env, now = Date.now } = {}) {
  let cachedToken; let pendingToken; let credentialScope;
  async function post(url, payload) {
    const body = JSON.stringify(payload);
    const raw = await new Promise((resolve, reject) => {
      let req; let timer; let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const fail = () => { finish(new Error('CLOUDBASE_HTTP_FAILED')); req?.destroy(); };
      req = request(url, { method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'accept-encoding': 'identity'
      } }, response => {
        if (response.statusCode !== 200 || Number(response.headers['content-length']) > 65536 ||
            (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
          response.destroy(); fail(); return;
        }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 65536) { response.destroy(); fail(); return; }
          chunks.push(chunk);
        });
        response.on('end', () => finish(null, Buffer.concat(chunks)));
        response.on('error', fail); response.on('aborted', fail);
      });
      req.on('error', fail);
      timer = setTimeout(fail, REQUEST_OPTIONS.timeout); timer.unref?.();
      req.end(body);
    });
    let result;
    try { result = JSON.parse(raw.toString('utf8')); }
    catch (_) { throw new Error('CLOUDBASE_HTTP_INVALID_RESPONSE'); }
    return result;
  }
  async function accessToken() {
    const appid = String(env.WECHAT_APPID || '');
    const secret = String(env.WECHAT_SECRET || '');
    if (!/^wx[a-z0-9_-]+$/i.test(appid) || !secret || /__FILL_|__SET_IN_/i.test(secret)) {
      throw new Error('CLOUDBASE_WECHAT_CONFIGURATION_MISSING');
    }
    const scope = appid + '\n' + secret;
    if (credentialScope !== scope) { cachedToken = undefined; pendingToken = undefined; credentialScope = scope; }
    if (cachedToken && cachedToken.expiresAt > now()) return cachedToken.value;
    if (!pendingToken) {
      const operation = (async () => {
        const result = await post(new URL('https://api.weixin.qq.com/cgi-bin/stable_token'), {
          grant_type: 'client_credential', appid, secret, force_refresh: false
        });
        if (Number(result?.errcode || 0) !== 0 || typeof result?.access_token !== 'string' ||
            !result.access_token || !(Number(result.expires_in) > 0)) throw new Error('CLOUDBASE_WECHAT_TOKEN_FAILED');
        // In-memory only. Normal stable_token mode does not revoke other callers' tokens.
        const token = { value: result.access_token, expiresAt: now() + Math.max(1, Number(result.expires_in) - 120) * 1000 };
        if (credentialScope === scope) cachedToken = token;
        return token.value;
      })();
      pendingToken = operation;
      operation.finally(() => { if (pendingToken === operation) pendingToken = undefined; }).catch(() => {});
    }
    return pendingToken;
  }
  async function call(operation, payload) {
    if (!['uploadfile', 'batchdownloadfile', 'batchdeletefile'].includes(operation)) throw new Error('CLOUDBASE_OPERATION_INVALID');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken();
      const url = new URL('https://api.weixin.qq.com/tcb/' + operation);
      url.searchParams.set('access_token', token);
      const result = await post(url, { env: config.envId, ...payload });
      const code = Number(result?.errcode);
      if (code === 0) return result;
      if (attempt === 0 && [40001, 40014, 42001].includes(code)) {
        if (cachedToken?.value === token) cachedToken = undefined;
        continue;
      }
      // Do not expose raw provider messages or URLs containing the access token.
      throw new Error('CLOUDBASE_FILE_API_FAILED');
    }
  }
  return {
    async getUploadMetadata({ cloudPath }) {
      const data = await call('uploadfile', { path: cloudPath });
      return { fileId: data.file_id };
    },
    async getTempFileURL({ fileList }) {
      const data = await call('batchdownloadfile', { file_list: fileList.map(item => ({ fileid: item.fileID, max_age: item.maxAge })) });
      return { fileList: data.file_list };
    },
    async deleteFile({ fileList }) {
      const data = await call('batchdeletefile', { fileid_list: fileList });
      return { fileList: data.delete_list };
    }
  };
}

function downloadBounded(url, { bucket, region }, request = https.request) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash ||
      (target.port && target.port !== '443') ||
      ![`${bucket}.cos.${region}.myqcloud.com`, `${bucket}.tcb.qcloud.la`].includes(target.hostname)) {
    throw new Error('CLOUDBASE_DOWNLOAD_ORIGIN_INVALID');
  }
  return new Promise((resolve, reject) => {
    let settled = false; let timer; let req;
    const finish = (error, body) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(body);
    };
    const fail = () => { finish(new Error('CLOUDBASE_DOWNLOAD_FAILED')); req?.destroy(); };
    req = request(target, { method: 'GET', headers: { Range: `bytes=0-${MAX_MEDIA_BYTES}`, 'accept-encoding': 'identity' } }, response => {
      if (![200, 206].includes(response.statusCode) ||
          Number(response.headers['content-length']) > MAX_MEDIA_BYTES ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.destroy(); fail(); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_MEDIA_BYTES) { response.destroy(); fail(); return; }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks)));
      response.on('error', fail); response.on('aborted', fail);
    });
    req.on('error', fail);
    timer = setTimeout(fail, REQUEST_OPTIONS.timeout);
    timer.unref?.();
    req.end();
  });
}

function createStorage({ env = process.env, clientFactory = config => createWechatClient(config, { env }), download = downloadBounded } = {}) {
  let currentClient; let currentConfig;
  const client = config => {
    const key = JSON.stringify(config);
    if (currentConfig !== key) { currentClient = clientFactory(config); currentConfig = key; }
    return currentClient;
  };
  async function prepare(cloudPath) {
    const config = storageConfig(env);
    if (!cloudPath.startsWith(config.prefix) || !FILE_NAME.test(cloudPath.slice(config.prefix.length))) {
      throw new Error('CLOUDBASE_OBJECT_PATH_INVALID');
    }
    const result = await client(config).getUploadMetadata({ cloudPath });
    const fileId = result?.fileId;
    const info = nativeFileInfo(fileId, config, cloudPath);
    // Upload signatures/tokens from WeChat are discarded, never sent to the client.
    return { fileId, cloudPath, bucket: info.bucket, envId: config.envId, region: config.region };
  }

  async function read(fileId, expectedPath) {
    const config = storageConfig(env);
    const { bucket } = nativeFileInfo(fileId, config, expectedPath);
    const result = await client(config).getTempFileURL({
      fileList: [{ fileID: fileId, maxAge: 60 }]
    });
    const item = result?.fileList?.[0];
    if (item?.status !== 0 || item.fileid !== fileId || !item.download_url) {
      throw new Error('CLOUDBASE_DOWNLOAD_METADATA_FAILED');
    }
    // Downloads have an absolute timeout and byte limit, including chunked responses.
    const bytes = await download(item.download_url, { bucket, region: config.region });
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MEDIA_BYTES) throw new Error('CLOUDBASE_MEDIA_SIZE_INVALID');
    return bytes;
  }

  async function remove(fileId, expectedPath) {
    const config = storageConfig(env);
    nativeFileInfo(fileId, config, expectedPath);
    const result = await client(config).deleteFile({ fileList: [fileId] });
    const item = result?.fileList?.[0];
    if (item?.fileid !== fileId || item.status !== 0) {
      throw new Error('CLOUDBASE_DELETE_FAILED');
    }
  }

  return { prepare, read, remove };
}

module.exports = { storageConfig, nativeFileInfo, createStorage, createWechatClient, downloadBounded, MAX_MEDIA_BYTES, REQUEST_OPTIONS };
