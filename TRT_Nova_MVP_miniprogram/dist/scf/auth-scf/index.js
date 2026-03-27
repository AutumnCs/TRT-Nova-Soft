const crypto = require('crypto');
const https = require('https');

let pool;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
}

function getMethod(event) {
  return (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    ''
  ).toUpperCase();
}

function getPath(event) {
  return (
    event?.path ||
    event?.requestContext?.path ||
    event?.requestContext?.http?.path ||
    ''
  );
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

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(payload, secret, expiresInSeconds) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const content = `${encodedHeader}.${encodedBody}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  return `${content}.${signature}`;
}

function toSqlDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  ].join(' ');
}

async function getDb() {
  if (pool) {
    return pool;
  }

  const mysql = require('mysql2/promise');
  const {
    DB_HOST,
    DB_PORT = '3306',
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DB_CONN_LIMIT = '5'
  } = process.env;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error('缺少数据库环境变量，请配置 DB_HOST/DB_NAME/DB_USER/DB_PASSWORD');
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
}

async function upsertUserOnLogin(db, session) {
  const now = toSqlDateTime(Date.now());
  await db.execute(
    `INSERT INTO users
      (openid, unionid, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       unionid = VALUES(unionid),
       last_login_at = VALUES(last_login_at),
       updated_at = VALUES(updated_at)`,
    [
      session.openid,
      session.unionid || null,
      now,
      now,
      now
    ]
  );
}

async function fetchWechatSession(code) {
  const appId = process.env.WECHAT_APPID || '';
  const appSecret = process.env.WECHAT_SECRET || '';

  if (!appId || !appSecret) {
    throw new Error('缺少 WECHAT_APPID 或 WECHAT_SECRET');
  }

  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(appSecret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    '&grant_type=authorization_code';

  const result = await new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });

  if (!result?.openid) {
    throw new Error(result?.errmsg || '获取微信 openid 失败');
  }

  return result;
}

exports.main = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const body = getBody(event);

  if (method !== 'POST' || !path.endsWith('/auth/login')) {
    return json(404, {
      success: false,
      msg: 'Route not found'
    });
  }

  try {
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return json(400, {
        success: false,
        msg: 'code is required'
      });
    }

    const session = await fetchWechatSession(code);
    const db = await getDb();
    await upsertUserOnLogin(db, session);

    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret) {
      throw new Error('缺少 JWT_SECRET');
    }

    const expiresInSeconds = Number(process.env.TOKEN_EXPIRES_IN_SECONDS || 7 * 24 * 3600);
    const accessToken = signJwt(
      {
        openid: session.openid,
        unionid: session.unionid || '',
        appid: process.env.WECHAT_APPID || ''
      },
      jwtSecret,
      expiresInSeconds
    );

    return json(200, {
      success: true,
      accessToken,
      expiresIn: expiresInSeconds,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      openid: session.openid
    });
  } catch (err) {
    console.error('auth-scf error:', {
      message: err.message,
      stack: err.stack
    });
    return json(500, {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.main_handler = exports.main;
