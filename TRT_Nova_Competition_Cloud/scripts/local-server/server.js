/**
 * 本地开发服务器：把现有 api-scf / agent-scf 包装为 127.0.0.1 HTTP 服务。
 * 仅存在于 scripts/，不属于 SCF 部署源。
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { createLocalAuthHandler, signLocalJwt } = require('./local-auth');

const ROOT = path.resolve(__dirname, '..', '..');

function loadLocalEnv() {
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) {
    throw new Error('缺少 .env.local，请从 .env.local.example 创建');
  }

  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const separator = value.indexOf('=');
    if (separator <= 0) continue;
    const key = value.slice(0, separator).trim();
    const raw = value.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = raw;
  }

  const keyFile = String(process.env.LLM_API_KEY_FILE || '').trim();
  if (!process.env.LLM_API_KEY && keyFile) {
    const resolved = path.isAbsolute(keyFile) ? keyFile : path.resolve(ROOT, keyFile);
    if (fs.existsSync(resolved)) {
      process.env.LLM_API_KEY = fs.readFileSync(resolved, 'utf8').trim();
    }
  }

  const weatherPrivateKeyFile = String(process.env.QWEATHER_PRIVATE_KEY_FILE || '').trim();
  if (!process.env.QWEATHER_PRIVATE_KEY && weatherPrivateKeyFile) {
    const resolved = path.isAbsolute(weatherPrivateKeyFile)
      ? weatherPrivateKeyFile
      : path.resolve(ROOT, weatherPrivateKeyFile);
    if (fs.existsSync(resolved)) {
      process.env.QWEATHER_PRIVATE_KEY = fs.readFileSync(resolved, 'utf8').trim();
    }
  }
}

loadLocalEnv();

if (!process.env.JWT_SECRET) {
  throw new Error('本地服务器缺少 JWT_SECRET');
}

const apiMain = require(path.join(ROOT, 'dist', 'scf', 'api-scf', 'index.js')).main;
const agentMain = require(path.join(ROOT, 'dist', 'scf', 'agent-scf', 'index.js')).main;
const authMain = require(path.join(ROOT, 'dist', 'scf', 'auth-scf', 'index.js')).main;
const handleLocalAuth = createLocalAuthHandler();

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    ...headers
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {}, '');

    const url = new URL(req.url, 'http://127.0.0.1');
    const rawBody = await readBody(req);

    if (req.method === 'GET' && url.pathname === '/dev/token') {
      if (String(process.env.LOCAL_DEV_AUTH_ENABLED).toLowerCase() !== 'true') {
        return send(res, 404, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ success: false }));
      }
      const openid = url.searchParams.get('openid') || 'dev_local_user';
      const token = signLocalJwt(openid, process.env.JWT_SECRET);
      return send(res, 200, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
        success: true,
        openid,
        token,
        expiresInDays: 7
      }));
    }

    const event = {
      httpMethod: req.method,
      path: url.pathname,
      headers: req.headers,
      body: rawBody,
      isBase64Encoded: false
    };
    const localAuthResult = await handleLocalAuth(event);
    const handler = url.pathname.startsWith('/auth')
      ? authMain
      : url.pathname.startsWith('/agent') ||
          url.pathname.startsWith('/vision') ||
          url.pathname.startsWith('/document')
        ? agentMain
        : apiMain;
    const result = localAuthResult || await handler(event, {});

    const statusCode = Number(result?.statusCode) || 200;
    const headers = result?.headers || { 'content-type': 'application/json; charset=utf-8' };
    const body = result?.body === undefined ? JSON.stringify(result || {}) : result.body;
    console.log(`[local-server] ${req.method} ${url.pathname} -> ${statusCode} (${Date.now() - startedAt}ms)`);
    return send(res, statusCode, headers, body);
  } catch (err) {
    console.error('[local-server] request failed:', err.message);
    return send(res, 500, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({
      success: false,
      msg: '本地服务请求失败'
    }));
  }
});

const port = Number(process.env.LOCAL_PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`[local-server] 已启动 http://127.0.0.1:${port}`);
  console.log(`[local-server] 数据库 ${process.env.DB_NAME || '(未配置)'}`);
  console.log(`[local-server] 本地测试身份 ${String(process.env.LOCAL_DEV_AUTH_ENABLED).toLowerCase() === 'true' ? '已启用' : '未启用'}`);
  if (String(process.env.LOCAL_DEV_AUTH_ENABLED).toLowerCase() === 'true') {
    console.log(`[local-server] 本地微信登录身份 ${process.env.LOCAL_DEV_OPENID || 'dev_wechat_user'}`);
  }
  console.log(`[local-server] LLM ${String(process.env.LLM_API_ENABLED).toLowerCase() === 'true' ? '已启用' : '未启用'}`);
  console.log(`[local-server] QWeather ${String(process.env.QWEATHER_ENABLED).toLowerCase() === 'true' ? '已启用' : '未启用'}`);
});
