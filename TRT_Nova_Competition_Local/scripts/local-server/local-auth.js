const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signLocalJwt(openid, secret, ttlSeconds = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ openid, iat: now, exp: now + ttlSeconds }));
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${content}.${signature}`;
}

function toSqlDateTime(ms) {
  const date = new Date(Number(ms) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  ].join(' ');
}

function getBody(event) {
  if (event?.body === undefined || event?.body === null) return {};
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (err) {
      return {};
    }
  }
  return typeof event.body === 'object' ? event.body : {};
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

function createDbFactory(env = process.env) {
  let pool;
  return async function getDb() {
    if (pool) return pool;

    const mysql = require('mysql2/promise');
    const {
      DB_HOST,
      DB_PORT = '3306',
      DB_NAME,
      DB_USER,
      DB_PASSWORD,
      DB_CONN_LIMIT = '5'
    } = env;

    if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
      throw new Error('本地登录缺少数据库配置');
    }

    pool = mysql.createPool({
      host: DB_HOST,
      port: Number(DB_PORT) || 3306,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: Math.max(1, Number(DB_CONN_LIMIT) || 5),
      charset: 'utf8mb4'
    });
    return pool;
  };
}

function createLocalAuthHandler(options = {}) {
  const env = options.env || process.env;
  const getDb = options.getDb || createDbFactory(env);

  return async function handleLocalAuth(event = {}) {
    const method = String(event.httpMethod || '').toUpperCase();
    const path = String(event.path || '');
    if (method !== 'POST' || !path.endsWith('/auth/login')) return null;
    if (String(env.LOCAL_DEV_AUTH_ENABLED).toLowerCase() !== 'true') return null;

    const body = getBody(event);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return json(400, { success: false, msg: '登录参数缺失' });
    }

    const jwtSecret = String(env.JWT_SECRET || '').trim();
    if (!jwtSecret) {
      throw new Error('本地登录缺少 JWT_SECRET');
    }

    const openid = String(env.LOCAL_DEV_OPENID || 'dev_wechat_user').trim();
    if (!openid) {
      throw new Error('本地登录缺少 LOCAL_DEV_OPENID');
    }

    const now = Date.now();
    const db = await getDb();
    const sqlNow = toSqlDateTime(now);
    await db.execute(
      `INSERT INTO users
        (openid, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_login_at = VALUES(last_login_at),
         updated_at = VALUES(updated_at)`,
      [openid, sqlNow, sqlNow, sqlNow]
    );

    const expiresIn = Number(env.TOKEN_EXPIRES_IN_SECONDS || 7 * 24 * 3600);
    return json(200, {
      success: true,
      accessToken: signLocalJwt(openid, jwtSecret, expiresIn),
      expiresIn,
      expiresAt: now + expiresIn * 1000,
      openid
    });
  };
}

module.exports = {
  createLocalAuthHandler,
  signLocalJwt
};
