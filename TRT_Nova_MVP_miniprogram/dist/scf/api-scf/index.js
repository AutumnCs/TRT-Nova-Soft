/**
 * api-scf MySQL reference implementation.
 * Routes:
 * - GET /health
 * - POST /device/latest
 * - POST /device/history
 * - POST /device/bind
 * - POST /device/unbind
 * - POST /device/profile
 * - POST /device/cmd
 * - GET /user/profile
 * - POST /user/profile
 *
 * Authentication order:
 * 1. Authorization: Bearer <jwt> if JWT_SECRET is configured
 * 2. x-wx-openid / x-openid header
 * 3. body.openid
 */

const crypto = require('crypto');

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

function getHeaders(event) {
  return event?.headers || {};
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

function normalizeLogicalKey(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeDeviceCode(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeFullDeviceName(deviceCode) {
  const code = normalizeDeviceCode(deviceCode);
  if (!code) return '';
  return code.startsWith('Nova_') ? code : `Nova_${code}`;
}

function parseJsonField(input, fallback) {
  if (!input) return fallback;
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (err) {
      return fallback;
    }
  }
  return fallback;
}

function toSqlDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  ].join(' ');
}

function getRangeStartMs(range) {
  const now = Date.now();
  const spanMap = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  return now - (spanMap[range] || spanMap['24h']);
}

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input) {
  const normalized = String(input)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(padding), 'base64').toString('utf8');
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedBody, signature] = parts;
  const content = `${encodedHeader}.${encodedBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(content)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  if (expected !== signature) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64urlDecode(encodedBody));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) < now) {
    throw new Error('Token expired');
  }

  return payload;
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
    throw new Error('Missing DB_HOST/DB_NAME/DB_USER/DB_PASSWORD');
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

function resolveAuthorizationOpenid(event) {
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    return '';
  }

  const headers = getHeaders(event);
  const authorization =
    headers.authorization ||
    headers.Authorization ||
    '';

  if (!authorization.startsWith('Bearer ')) {
    return '';
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return '';
  }

  const payload = verifyJwt(token, jwtSecret);
  return payload?.openid ? String(payload.openid).trim() : '';
}

function resolveOpenid(event, body) {
  const authOpenid = resolveAuthorizationOpenid(event);
  if (authOpenid) {
    return authOpenid;
  }

  const headers = getHeaders(event);
  const headerOpenid =
    headers['x-wx-openid'] ||
    headers['X-WX-OPENID'] ||
    headers['x-openid'] ||
    headers['X-OPENID'];

  const bodyOpenid = body?.openid || '';
  const openid = headerOpenid || bodyOpenid;

  if (!openid) {
    throw new Error('Missing openid or bearer token');
  }

  return String(openid).trim();
}

function mapUserRow(row = {}) {
  return {
    openid: row.openid || '',
    unionid: row.unionid || '',
    nickName: row.nick_name || '',
    avatarUrl: row.avatar_url || '',
    gender: typeof row.gender === 'number' ? row.gender : 0,
    birthday: row.birthday || '',
    region: parseJsonField(row.region_json, []),
    experienceLevel: row.experience_level || '',
    signature: row.signature || '',
    phone: row.phone || '',
    email: row.email || '',
    lastLoginAt: row.last_login_at || null,
    updatedAt: row.updated_at || null
  };
}

async function healthCheck(db) {
  const [rows] = await db.query('SELECT 1 AS ok');
  return {
    success: true,
    service: 'api-scf',
    db: 'mysql',
    now: Date.now(),
    ok: rows[0]?.ok === 1
  };
}

async function getActiveAclRows(db, openid, logicalKey = '') {
  const sql = logicalKey
    ? `SELECT id, openid, logical_key, role, status, alias, location, plant_type, plant_library_id
       FROM device_acl
       WHERE openid = ? AND status = 'active' AND logical_key = ?
       ORDER BY updated_at DESC`
    : `SELECT id, openid, logical_key, role, status, alias, location, plant_type, plant_library_id
       FROM device_acl
       WHERE openid = ? AND status = 'active'
       ORDER BY updated_at DESC`;

  const params = logicalKey ? [openid, logicalKey] : [openid];
  const [rows] = await db.execute(sql, params);
  return rows;
}

// 将 plant_library 行映射为前端格式
function mapPlantRow(row, favoriteIdSet) {
  const tags = parseJsonField(row.tags_json, []);
  return {
    id: row.id,
    name: row.name || '',
    family: row.family || '',
    scientificName: row.scientific_name || '',
    feature: row.feature || '',
    featureText: row.feature_text || '',
    category: row.category || '',
    image: row.image_url || '',
    tags: Array.isArray(tags) ? tags : [],
    description: row.description || '',
    care: {
      light: row.care_light || '',
      water: row.care_water || ''
    },
    isFavorite: favoriteIdSet ? favoriteIdSet.has(row.id) : false
  };
}

// GET /plant/library — 返回全部植物，并标记当前用户的收藏
async function getPlantLibrary(db, openid) {
  const [plantRows] = await db.execute(
    `SELECT id, name, family, scientific_name, feature, feature_text, category,
            image_url, tags_json, description, care_light, care_water, sort_order
     FROM plant_library
     WHERE is_active = 1
     ORDER BY sort_order ASC, id ASC`
  );

  const plantIds = plantRows.map(r => r.id);
  let favoriteIdSet = new Set();

  if (plantIds.length > 0) {
    const placeholders = plantIds.map(() => '?').join(', ');
    const [favRows] = await db.execute(
      `SELECT plant_id FROM user_plant_favorites WHERE openid = ? AND plant_id IN (${placeholders})`,
      [openid, ...plantIds]
    );
    favoriteIdSet = new Set(favRows.map(r => r.plant_id));
  }

  return {
    success: true,
    plants: plantRows.map(r => mapPlantRow(r, favoriteIdSet))
  };
}

// POST /plant/favorite/toggle — 切换收藏状态，返回新的 isFavorite 值
async function togglePlantFavorite(db, openid, input) {
  const plantId = Number(input?.plantId);
  if (!plantId) {
    return { success: false, msg: 'plantId is required' };
  }

  // 检查植物存在
  const [plantRows] = await db.execute(
    `SELECT id FROM plant_library WHERE id = ? AND is_active = 1 LIMIT 1`,
    [plantId]
  );
  if (!plantRows.length) {
    return { success: false, msg: 'Plant not found' };
  }

  // 检查是否已收藏
  const [favRows] = await db.execute(
    `SELECT id FROM user_plant_favorites WHERE openid = ? AND plant_id = ? LIMIT 1`,
    [openid, plantId]
  );

  let isFavorite;
  if (favRows.length > 0) {
    // 已收藏 → 取消
    await db.execute(
      `DELETE FROM user_plant_favorites WHERE openid = ? AND plant_id = ?`,
      [openid, plantId]
    );
    isFavorite = false;
  } else {
    // 未收藏 → 收藏
    await db.execute(
      `INSERT INTO user_plant_favorites (openid, plant_id) VALUES (?, ?)`,
      [openid, plantId]
    );
    isFavorite = true;
  }

  return { success: true, plantId, isFavorite };
}

async function queryLatestByUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const aclRows = await getActiveAclRows(db, openid, logicalKey);

  if (!aclRows.length) {
    return {
      success: true,
      deviceData: []
    };
  }

  const logicalKeys = aclRows.map((item) => item.logical_key);
  const placeholders = logicalKeys.map(() => '?').join(', ');

  const [latestRows] = await db.execute(
    `SELECT logical_key, product_id, device_name, updated_at_ms, data_id, notify_type, message_type, params_json
     FROM device_latest
     WHERE logical_key IN (${placeholders})`,
    logicalKeys
  );

  const [deviceRows] = await db.execute(
    `SELECT logical_key, product_id, device_name, status, external_device_id
     FROM devices
     WHERE logical_key IN (${placeholders})`,
    logicalKeys
  );

  const latestMap = latestRows.reduce((acc, row) => {
    acc[row.logical_key] = row;
    return acc;
  }, {});

  const deviceMap = deviceRows.reduce((acc, row) => {
    acc[row.logical_key] = row;
    return acc;
  }, {});

  // 批量拉取已关联植物的信息
  const plantLibraryIds = aclRows
    .map(a => a.plant_library_id)
    .filter(Boolean);

  let plantMap = {};
  if (plantLibraryIds.length > 0) {
    const placeholders2 = plantLibraryIds.map(() => '?').join(', ');
    const [plantRows] = await db.execute(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              image_url, tags_json, description, care_light, care_water
       FROM plant_library WHERE id IN (${placeholders2}) AND is_active = 1`,
      plantLibraryIds
    );
    // 收藏状态
    const [favRows] = await db.execute(
      `SELECT plant_id FROM user_plant_favorites WHERE openid = ? AND plant_id IN (${placeholders2})`,
      [openid, ...plantLibraryIds]
    );
    const favSet = new Set(favRows.map(r => r.plant_id));
    plantMap = plantRows.reduce((acc, r) => {
      acc[r.id] = mapPlantRow(r, favSet);
      return acc;
    }, {});
  }

  const deviceData = logicalKeys.map((key) => {
    const acl = aclRows.find((item) => item.logical_key === key) || {};
    const latest = latestMap[key] || {};
    const device = deviceMap[key] || {};
    const mergedDeviceName = latest.device_name || device.device_name || '';
    const plantLibraryId = acl.plant_library_id || null;

    return {
      logicalKey: key,
      productId: latest.product_id || device.product_id || '',
      deviceName: mergedDeviceName,
      alias: acl.alias || (mergedDeviceName.startsWith('Nova_') ? mergedDeviceName.slice(5) : mergedDeviceName) || key,
      location: acl.location || '',
      plantType: acl.plant_type || '',
      plantLibraryId,
      plant: plantLibraryId ? (plantMap[plantLibraryId] || null) : null,
      role: acl.role || '',
      aclStatus: acl.status || '',
      params: parseJsonField(latest.params_json, {}),
      updatedAt: latest.updated_at_ms || null,
      hasLatest: !!latestMap[key]
    };
  });

  return {
    success: true,
    deviceData
  };
}

async function queryHistoryByUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  if (!logicalKey) {
    return {
      success: false,
      msg: 'logicalKey is required'
    };
  }

  const aclRows = await getActiveAclRows(db, openid, logicalKey);
  if (!aclRows.length) {
    return {
      success: true,
      historyData: []
    };
  }

  const granularity = ['5m', '1h', '1d'].includes(input?.granularity)
    ? input.granularity
    : '5m';
  const range = ['24h', '7d', '30d'].includes(input?.range)
    ? input.range
    : '24h';
  const limit = Math.max(1, Math.min(1000, Number(input?.limit) || 288));
  const paramKey = typeof input?.paramKey === 'string' ? input.paramKey.trim() : '';
  const startMs = getRangeStartMs(range);

  const sql = paramKey
    ? `SELECT logical_key, param_key, granularity, bucket_start_ms, min_value, max_value, avg_value, sample_count
       FROM device_history_agg
       WHERE logical_key = ? AND granularity = ? AND param_key = ? AND bucket_start_ms >= ?
       ORDER BY bucket_start_ms DESC
       LIMIT ?`
    : `SELECT logical_key, param_key, granularity, bucket_start_ms, min_value, max_value, avg_value, sample_count
       FROM device_history_agg
       WHERE logical_key = ? AND granularity = ? AND bucket_start_ms >= ?
       ORDER BY bucket_start_ms DESC
       LIMIT ?`;

  const params = paramKey
    ? [logicalKey, granularity, paramKey, startMs, limit]
    : [logicalKey, granularity, startMs, limit];

  const [rows] = await db.execute(sql, params);

  return {
    success: true,
    historyData: rows.map((row) => ({
      logicalKey: row.logical_key,
      paramKey: row.param_key,
      granularity: row.granularity,
      bucketStart: row.bucket_start_ms,
      min: row.min_value === null ? null : Number(row.min_value),
      max: row.max_value === null ? null : Number(row.max_value),
      avg: row.avg_value === null ? null : Number(row.avg_value),
      count: row.sample_count
    }))
  };
}

async function bindDeviceForUser(db, openid, input) {
  const deviceCode = normalizeDeviceCode(input?.deviceCode);
  const fullDeviceName = normalizeFullDeviceName(deviceCode);
  if (!deviceCode || !fullDeviceName) {
    return {
      success: false,
      msg: 'deviceCode is required'
    };
  }

  const alias = typeof input?.alias === 'string' ? input.alias.trim() : '';
  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  const plantType = typeof input?.plantType === 'string' ? input.plantType.trim() : '';
  const plantLibraryId = input?.plantLibraryId ? Number(input.plantLibraryId) : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [deviceRows] = await conn.execute(
      `SELECT id, logical_key, product_id, device_name, status
       FROM devices
       WHERE device_name = ?
       LIMIT 1`,
      [fullDeviceName]
    );

    if (!deviceRows.length || (deviceRows[0].status && deviceRows[0].status !== 'active')) {
      await conn.rollback();
      return {
        success: false,
        msg: 'Device code not found or inactive'
      };
    }

    const device = deviceRows[0];
    const logicalKey = device.logical_key;

    const [activeRows] = await conn.execute(
      `SELECT id, openid
       FROM device_acl
       WHERE logical_key = ? AND status = 'active'
       LIMIT 1`,
      [logicalKey]
    );

    if (activeRows.length > 0) {
      if (activeRows[0].openid === openid) {
        await conn.commit();
        return {
          success: true,
          msg: 'Already bound',
          logicalKey
        };
      }

      await conn.rollback();
      return {
        success: false,
        msg: 'Device already bound by another user'
      };
    }

    const [inactiveRows] = await conn.execute(
      `SELECT id
       FROM device_acl
       WHERE openid = ? AND logical_key = ? AND status = 'inactive'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [openid, logicalKey]
    );

    const now = toSqlDateTime(Date.now());

    if (inactiveRows.length > 0) {
      await conn.execute(
        `UPDATE device_acl
         SET status = 'active',
             alias = ?,
             location = ?,
             plant_type = ?,
             plant_library_id = ?,
             unbind_time = NULL,
             bind_time = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          alias || null,
          location || null,
          plantType || null,
          plantLibraryId || null,
          now,
          now,
          inactiveRows[0].id
        ]
      );
    } else {
      await conn.execute(
        `INSERT INTO device_acl
          (openid, logical_key, role, status, alias, location, plant_type, plant_library_id, bind_time, created_at, updated_at)
         VALUES (?, ?, 'owner', 'active', ?, ?, ?, ?, ?, ?, ?)`,
        [
          openid,
          logicalKey,
          alias || null,
          location || null,
          plantType || null,
          plantLibraryId || null,
          now,
          now,
          now
        ]
      );
    }

    await conn.commit();
    return {
      success: true,
      msg: 'Binding successful',
      deviceCode,
      deviceName: fullDeviceName,
      logicalKey
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function unbindDeviceForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  if (!logicalKey) {
    return {
      success: false,
      msg: 'logicalKey is required'
    };
  }

  const [rows] = await db.execute(
    `SELECT id
     FROM device_acl
     WHERE openid = ? AND logical_key = ? AND status = 'active'
     LIMIT 1`,
    [openid, logicalKey]
  );

  if (!rows.length) {
    return {
      success: false,
      msg: 'Binding record not found'
    };
  }

  const now = toSqlDateTime(Date.now());
  await db.execute(
    `UPDATE device_acl
     SET status = 'inactive',
         unbind_time = ?,
         updated_at = ?
     WHERE id = ?`,
    [now, now, rows[0].id]
  );

  return {
    success: true,
    msg: 'Unbind successful',
    logicalKey
  };
}

async function updateDeviceProfileForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  if (!logicalKey) {
    return {
      success: false,
      msg: 'logicalKey is required'
    };
  }

  const alias = typeof input?.alias === 'string' ? input.alias.trim() : '';
  const location = typeof input?.location === 'string' ? input.location.trim() : '';
  const plantType = typeof input?.plantType === 'string' ? input.plantType.trim() : '';
  const plantLibraryId = input?.plantLibraryId ? Number(input.plantLibraryId) : null;

  const [rows] = await db.execute(
    `SELECT id
     FROM device_acl
     WHERE openid = ? AND logical_key = ? AND status = 'active'
     LIMIT 1`,
    [openid, logicalKey]
  );

  if (!rows.length) {
    return {
      success: false,
      msg: 'Binding record not found'
    };
  }

  await db.execute(
    `UPDATE device_acl
     SET alias = ?, location = ?, plant_type = ?, plant_library_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      alias || null,
      location || null,
      plantType || null,
      plantLibraryId || null,
      toSqlDateTime(Date.now()),
      rows[0].id
    ]
  );

  return {
    success: true,
    msg: 'Profile updated',
    logicalKey,
    alias,
    location,
    plantType
  };
}

async function getUserProfile(db, openid) {
  const [rows] = await db.execute(
    `SELECT openid, unionid, nick_name, avatar_url, gender, birthday, region_json,
            experience_level, signature, phone, email, last_login_at, updated_at
     FROM users
     WHERE openid = ?
     LIMIT 1`,
    [openid]
  );

  return {
    success: true,
    profile: rows.length ? mapUserRow(rows[0]) : null
  };
}

async function saveUserProfile(db, openid, input) {
  const now = toSqlDateTime(Date.now());
  const payload = {
    nickName: typeof input?.nickName === 'string' ? input.nickName.trim() : '',
    avatarUrl: typeof input?.avatarUrl === 'string' ? input.avatarUrl.trim() : '',
    gender: typeof input?.gender === 'number' ? input.gender : Number(input?.gender) || 0,
    birthday: typeof input?.birthday === 'string' ? input.birthday.trim() : '',
    region: Array.isArray(input?.region) ? input.region : [],
    experienceLevel: typeof input?.experienceLevel === 'string' ? input.experienceLevel.trim() : '',
    signature: typeof input?.signature === 'string' ? input.signature.trim() : '',
    phone: typeof input?.phone === 'string' ? input.phone.trim() : '',
    email: typeof input?.email === 'string' ? input.email.trim() : ''
  };

  await db.execute(
    `INSERT INTO users
      (openid, nick_name, avatar_url, gender, birthday, region_json, experience_level, signature, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nick_name = VALUES(nick_name),
       avatar_url = VALUES(avatar_url),
       gender = VALUES(gender),
       birthday = VALUES(birthday),
       region_json = VALUES(region_json),
       experience_level = VALUES(experience_level),
       signature = VALUES(signature),
       phone = VALUES(phone),
       email = VALUES(email),
       updated_at = VALUES(updated_at)`,
    [
      openid,
      payload.nickName || null,
      payload.avatarUrl || null,
      payload.gender,
      payload.birthday || null,
      JSON.stringify(payload.region),
      payload.experienceLevel || null,
      payload.signature || null,
      payload.phone || null,
      payload.email || null,
      now,
      now
    ]
  );

  return getUserProfile(db, openid);
}

async function sendDeviceCmdForUser(_db, _openid, input) {
  return {
    success: false,
    msg: 'sendDeviceCmd is not implemented yet',
    logicalKey: normalizeLogicalKey(input?.logicalKey)
  };
}

exports.main = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const body = getBody(event);

  try {
    const db = await getDb();

    if (method === 'GET' && path.endsWith('/health')) {
      return json(200, await healthCheck(db));
    }

    const openid = resolveOpenid(event, body);

    if (method === 'POST' && path.endsWith('/device/latest')) {
      return json(200, await queryLatestByUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/device/history')) {
      return json(200, await queryHistoryByUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/device/bind')) {
      return json(200, await bindDeviceForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/device/unbind')) {
      return json(200, await unbindDeviceForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/device/profile')) {
      return json(200, await updateDeviceProfileForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/device/cmd')) {
      return json(200, await sendDeviceCmdForUser(db, openid, body));
    }

    if (method === 'GET' && path.endsWith('/user/profile')) {
      return json(200, await getUserProfile(db, openid));
    }

    if (method === 'POST' && path.endsWith('/user/profile')) {
      return json(200, await saveUserProfile(db, openid, body));
    }

    if (method === 'GET' && path.endsWith('/plant/library')) {
      return json(200, await getPlantLibrary(db, openid));
    }

    if (method === 'POST' && path.endsWith('/plant/favorite/toggle')) {
      return json(200, await togglePlantFavorite(db, openid, body));
    }

    return json(404, {
      success: false,
      msg: 'Route not found'
    });
  } catch (err) {
    console.error('api-scf error:', {
      message: err.message,
      stack: err.stack,
      path
    });
    return json(500, {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.main_handler = exports.main;
