const crypto = require('crypto');

let pool;

/**
 * 说明：
 * - 本文件直接参考 reference/onenetWebhook.example.js 的已验证处理思路
 * - 保留原版里真正有价值的部分：入口解析、验签、解密、latest/history 归一化、错误处理
 * - 唯一核心变化是：落库目标从 CloudBase 改为轻量数据库
 * - 数据库驱动刻意保持抽象，便于迁移到 mysql2/promise、ORM 或其他兼容实现
 */

const ONE_NET_TOKEN = process.env.ONE_NET_TOKEN || '';
const ONE_NET_AES_KEY = process.env.ONE_NET_AES_KEY || '';
const EMQX_WEBHOOK_TOKEN = process.env.EMQX_WEBHOOK_TOKEN || '';
const EMQX_PRODUCT_ID = process.env.EMQX_PRODUCT_ID || 'emqx';

function buildLogicalKey(productId, deviceName) {
  return `${productId}::${deviceName}`;
}

function verifySignature(msg, nonce, signature, token) {
  if (!msg || !nonce || !signature || !token) {
    return false;
  }

  const strA = token + nonce + msg;
  const md5 = crypto.createHash('md5').update(strA).digest('hex');
  const calSignature = Buffer.from(md5, 'hex').toString('base64');
  return calSignature === signature;
}

function decryptMsg(cryptedMsg, aesKey) {
  if (!aesKey) {
    return cryptedMsg;
  }

  try {
    const cryptedBuffer = Buffer.from(cryptedMsg, 'base64');
    const iv = aesKey.substring(0, 16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    let decodedMsg = decipher.update(cryptedBuffer, null, 'utf8');
    decodedMsg += decipher.final('utf8');
    return decodedMsg;
  } catch (err) {
    console.error('decryptMsg failed:', err);
    return cryptedMsg;
  }
}

function getHttpMethod(event) {
  return (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    event?.requestContext?.httpMethod ||
    ''
  ).toUpperCase();
}

function getQuery(event) {
  if (event?.queryStringParameters && Object.keys(event.queryStringParameters).length > 0) {
    return event.queryStringParameters;
  }

  if (event?.queryString && typeof event.queryString === 'object') {
    return event.queryString;
  }

  const multi = event?.multiValueQueryStringParameters || {};
  const query = {};
  Object.keys(multi).forEach((key) => {
    const value = multi[key];
    query[key] = Array.isArray(value) ? value[0] : value;
  });
  return query;
}

function getBody(event) {
  if (event?.body === undefined || event?.body === null) {
    return {};
  }

  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (err) {
      return {};
    }
  }

  return typeof event.body === 'object' ? event.body : {};
}

function getHeaders(event) {
  return event?.headers || {};
}

function getHeaderValue(headers, keys) {
  if (!headers) {
    return '';
  }

  const normalized = {};
  Object.entries(headers).forEach(([key, value]) => {
    normalized[String(key).toLowerCase()] = value;
  });

  for (const key of keys) {
    const value = normalized[String(key).toLowerCase()];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return '';
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
}

function parseEmqxTopic(topic) {
  const text = typeof topic === 'string' ? topic.trim() : '';
  if (!text) {
    return {};
  }

  const parts = text.split('/').filter(Boolean);
  if (parts.length >= 4) {
    return {
      productId: parts[1] || '',
      deviceName: parts[2] || '',
      topicType: parts.slice(3).join('/')
    };
  }

  if (parts.length >= 3) {
    return {
      productId: parts[1] || '',
      deviceName: parts[2] || '',
      topicType: parts.slice(3).join('/')
    };
  }

  return {};
}

function toSqlDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeParamValue(value) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return {
      valueNum: num,
      valueText: null
    };
  }

  return {
    valueNum: null,
    valueText: value === undefined || value === null ? null : String(value)
  };
}

function pickFirstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function buildParamItem(value, time) {
  return {
    value,
    time
  };
}

function extractParamsFromSource(source, sampleTime) {
  if (!source || typeof source !== 'object') {
    return {};
  }

  const normalizedSource = { ...source };
  const nestedPayload = parseMaybeJson(source?.payload);
  if (nestedPayload && typeof nestedPayload === 'object' && !Array.isArray(nestedPayload)) {
    Object.entries(nestedPayload).forEach(([key, value]) => {
      if (normalizedSource[key] === undefined) {
        normalizedSource[key] = value;
      }
    });
  }

  if (normalizedSource?.data?.params && typeof normalizedSource.data.params === 'object') {
    return normalizedSource.data.params;
  }

  const flatParamMap = {
    soil_percent: ['soil_percent', 'sp'],
    dht_temp: ['dht_temp', 'temperature', 'temp', 'tt'],
    dht_humi: ['dht_humi', 'humidity', 'humi', 'th'],
    run_state: ['run_state', 'rs'],
    light_val: ['light_val', 'lv'],
    ir_status: ['ir_status', 'ir'],
    uid: ['uid'],
    is_dead: ['is_dead', 'dead', 'death_status'],
    soul_state: ['soul_state', 'spirit_state', 'soul', 'ss'],
    favorability: ['favorability', 'favor', 'affinity', 'likability', 'haogandu'],
    plant_personality: ['plant_personality', 'personality', 'character'],
    plant_type: ['plant_type', 'ptype'],
    count: ['count', 'cnt']
  };

  const params = {};
  Object.entries(flatParamMap).forEach(([paramKey, aliases]) => {
    const value = pickFirstValue(normalizedSource, aliases);
    if (value !== undefined) {
      params[paramKey] = buildParamItem(value, sampleTime);
    }
  });

  const rawMessage = pickFirstValue(normalizedSource, ['payload', 'message', 'msg']);
  if (!Object.keys(params).length && typeof rawMessage === 'string' && rawMessage.trim()) {
    params.payload = buildParamItem(rawMessage.trim(), sampleTime);
  }

  return params;
}

function normalizeIncomingMessage(innerMsg, pushTime) {
  const productId = pickFirstValue(innerMsg, ['productId', 'pid']) || '';
  const deviceName = pickFirstValue(innerMsg, ['deviceName', 'dn']) || '';
  const notifyType = pickFirstValue(innerMsg, ['notifyType', 'nt']) || '';
  const messageType = pickFirstValue(innerMsg, ['messageType', 'mt']) || '';
  const dataId = pickFirstValue(innerMsg, ['dataId', 'did']) || innerMsg?.data?.id || '';
  const sampleTime =
    Number(pickFirstValue(innerMsg, ['dataTimestamp', 'ts'])) ||
    Number(innerMsg?.data?.time) ||
    Number(pushTime) ||
    Date.now();

  return {
    productId,
    deviceName,
    notifyType,
    messageType,
    dataId,
    params: extractParamsFromSource(innerMsg, sampleTime)
  };
}

function normalizeEmqxMessage(body, pushTime) {
  const payloadValue = parseMaybeJson(body?.payload);
  const payloadObject = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
    ? payloadValue
    : {};
  const mergedSource = { ...payloadObject, ...body };
  const topic = pickFirstValue(body, ['topic']) || '';
  const topicParts = parseEmqxTopic(topic);
  const clientAttrs =
    (body?.client_attrs && typeof body.client_attrs === 'object' && body.client_attrs) ||
    (payloadObject?.client_attrs && typeof payloadObject.client_attrs === 'object' && payloadObject.client_attrs) ||
    {};
  const sampleTime =
    Number(pickFirstValue(body, ['timestamp', 'publish_received_at', 'received_at', 'ts'])) ||
    Number(pickFirstValue(payloadObject, ['timestamp', 'ts'])) ||
    Number(pushTime) ||
    Date.now();
  const explicitDeviceName = pickFirstValue(body, ['deviceName', 'device_name', 'device']) ||
    pickFirstValue(payloadObject, ['deviceName', 'device_name', 'device']);
  const explicitProductId = pickFirstValue(body, ['productId', 'product_id', 'pid']) ||
    pickFirstValue(payloadObject, ['productId', 'product_id', 'pid']);
  const explicitLogicalKey = pickFirstValue(body, ['logicalKey', 'logical_key']) ||
    pickFirstValue(payloadObject, ['logicalKey', 'logical_key']);
  const clientId = pickFirstValue(body, ['clientid', 'client_id', 'clientId']) || '';
  const username = pickFirstValue(body, ['username', 'user']) || '';
  const deviceName =
    explicitDeviceName ||
    pickFirstValue(clientAttrs, ['deviceName', 'device_name', 'device']) ||
    pickFirstValue(body, ['client_name']) ||
    pickFirstValue(payloadObject, ['deviceName', 'device_name']) ||
    '';
  const productId =
    explicitProductId ||
    pickFirstValue(clientAttrs, ['productId', 'product_id', 'pid']) ||
    process.env.EMQX_PRODUCT_ID ||
    EMQX_PRODUCT_ID ||
    '';
  const logicalKey =
    explicitLogicalKey ||
    pickFirstValue(clientAttrs, ['logicalKey', 'logical_key']) ||
    ((productId && deviceName) ? buildLogicalKey(productId, deviceName) : '') ||
    '';
  const eventType = String(
    pickFirstValue(body, ['event', 'notifyType', 'notify_type', 'action']) || 'message.publish'
  );
  const messageType = eventType.startsWith('client.')
    ? 'client'
    : eventType.startsWith('session.')
      ? 'session'
      : 'message';
  const dataId =
    pickFirstValue(body, ['id', 'dataId', 'did']) ||
    pickFirstValue(payloadObject, ['id', 'dataId']) ||
    '';

  const params = extractParamsFromSource(mergedSource, sampleTime);
  if (!Object.keys(params).length && typeof payloadValue === 'string' && payloadValue.trim()) {
    params.payload = buildParamItem(payloadValue.trim(), sampleTime);
  }

  return {
    productId,
    deviceName,
    logicalKey,
    notifyType: eventType,
    messageType,
    dataId,
    params,
    sourceMeta: {
      provider: 'emqx',
      event: eventType,
      topic,
      clientId,
      username,
      clientAttrs,
      topicType: topicParts.topicType || '',
      rawPayload: payloadValue
    }
  };
}

function getGranularityBucket(sampleTimeMs, granularity) {
  const time = Number(sampleTimeMs) || Date.now();
  const map = {
    '5m': 5 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  };
  const span = map[granularity];
  if (!span) {
    throw new Error(`Unsupported granularity: ${granularity}`);
  }
  return Math.floor(time / span) * span;
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

async function maybeBeginTransaction(db) {
  if (db && typeof db.beginTransaction === 'function') {
    await db.beginTransaction();
    return true;
  }
  return false;
}

async function maybeCommit(db, beganTransaction) {
  if (beganTransaction && db && typeof db.commit === 'function') {
    await db.commit();
  }
}

async function maybeRollback(db, beganTransaction) {
  if (beganTransaction && db && typeof db.rollback === 'function') {
    await db.rollback();
  }
}

async function findRegisteredDevice(db, logicalKey) {
  const [rows] = await db.execute(
    'SELECT id, logical_key FROM devices WHERE logical_key = ? LIMIT 1',
    [logicalKey]
  );
  return rows[0] || null;
}

async function ensureDeviceRegistered(db, logicalKey, productId, deviceName) {
  const existing = await findRegisteredDevice(db, logicalKey);
  if (existing) {
    return existing;
  }

  await db.execute(
    `INSERT INTO devices
      (logical_key, product_id, device_name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       product_id = VALUES(product_id),
       device_name = VALUES(device_name),
       status = 'active',
       updated_at = VALUES(updated_at)`,
    [
      logicalKey,
      productId,
      deviceName,
      toSqlDateTime(Date.now()),
      toSqlDateTime(Date.now())
    ]
  );

  return findRegisteredDevice(db, logicalKey);
}

async function upsertLatest(db, latestRecord) {
  await db.execute(
    `INSERT INTO device_latest
      (logical_key, product_id, device_name, updated_at_ms, data_id, notify_type, message_type, params_json, push_meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       product_id = VALUES(product_id),
       device_name = VALUES(device_name),
       updated_at_ms = VALUES(updated_at_ms),
       data_id = VALUES(data_id),
       notify_type = VALUES(notify_type),
       message_type = VALUES(message_type),
       params_json = VALUES(params_json),
       push_meta_json = VALUES(push_meta_json),
       updated_at = VALUES(updated_at)`,
    [
      latestRecord.logicalKey,
      latestRecord.productId,
      latestRecord.deviceName,
      latestRecord.updatedAt,
      latestRecord.dataId,
      latestRecord.notifyType,
      latestRecord.messageType,
      JSON.stringify(latestRecord.params || {}),
      JSON.stringify(latestRecord.pushMeta || {}),
      toSqlDateTime(latestRecord.updatedAt),
      toSqlDateTime(latestRecord.updatedAt)
    ]
  );
}

async function insertRawHistory(db, row) {
  const value = normalizeParamValue(row.value);

  await db.execute(
    `INSERT IGNORE INTO device_history_raw
      (logical_key, product_id, device_name, param_key, value_num, value_text, sample_time_ms, data_id, push_id, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.logicalKey,
      row.productId,
      row.deviceName,
      row.paramKey,
      value.valueNum,
      value.valueText,
      row.time,
      row.dataId,
      row.pushId,
      row.dedupKey,
      toSqlDateTime(row.time)
    ]
  );
}

async function upsertAggHistory(db, row, granularity) {
  const value = Number(row.value);
  if (!Number.isFinite(value)) {
    return;
  }

  const bucketStart = getGranularityBucket(row.time, granularity);

  await db.execute(
    `INSERT INTO device_history_agg
      (logical_key, param_key, granularity, bucket_start_ms, min_value, max_value, avg_value, sample_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       min_value = LEAST(min_value, VALUES(min_value)),
       max_value = GREATEST(max_value, VALUES(max_value)),
       avg_value = ((avg_value * sample_count) + VALUES(avg_value)) / (sample_count + 1),
       sample_count = sample_count + 1,
       updated_at = VALUES(updated_at)`,
    [
      row.logicalKey,
      row.paramKey,
      granularity,
      bucketStart,
      value,
      value,
      value,
      toSqlDateTime(row.time),
      toSqlDateTime(row.time)
    ]
  );
}

async function persistNormalizedDeviceData(normalized, db, sourceMeta = {}) {
  const pushId = sourceMeta.pushId || sourceMeta.dataId || '';
  const pushTime = sourceMeta.pushTime || Date.now();
  const nonce = sourceMeta.nonce || '';
  const signature = sourceMeta.signature || '';
  const provider = sourceMeta.provider || 'onenet';

  const productId = normalized.productId;
  const deviceName = normalized.deviceName;
  const notifyType = normalized.notifyType;
  const messageType = normalized.messageType;
  const dataId = normalized.dataId;
  const params = normalized.params || {};

  if (!productId || !deviceName) {
    throw new Error('productId/deviceName missing');
  }

  const logicalKey = buildLogicalKey(productId, deviceName);
  await ensureDeviceRegistered(db, logicalKey, productId, deviceName);

  const latestRecord = {
    logicalKey,
    productId,
    deviceName,
    notifyType,
    messageType,
    dataId,
    updatedAt: pushTime,
    params: {},
    pushMeta: {
      provider,
      pushId,
      pushTime,
      nonce,
      signature,
      ...sourceMeta
    }
  };

  const historyRows = [];
  for (const [paramKey, item] of Object.entries(params)) {
    const isStructuredItem = item && typeof item === 'object' && !Array.isArray(item);
    const value = isStructuredItem && Object.prototype.hasOwnProperty.call(item, 'value')
      ? item.value
      : item;
    const time = isStructuredItem && item?.time ? item.time : pushTime;
    const dedupKey = crypto
      .createHash('md5')
      .update(`${logicalKey}|${pushId}|${paramKey}|${time}`)
      .digest('hex');

    latestRecord.params[paramKey] = { value, time };
    historyRows.push({
      logicalKey,
      productId,
      deviceName,
      paramKey,
      value,
      time,
      dataId,
      pushId,
      receivedAt: pushTime,
      dedupKey
    });
  }

  const conn = typeof db.getConnection === 'function' ? await db.getConnection() : db;
  const beganTransaction = await maybeBeginTransaction(conn);

  try {
    await upsertLatest(conn, latestRecord);

    for (const row of historyRows) {
      await insertRawHistory(conn, row);
      await upsertAggHistory(conn, row, '5m');
      await upsertAggHistory(conn, row, '1h');
      await upsertAggHistory(conn, row, '1d');
    }

    await maybeCommit(conn, beganTransaction);
  } catch (err) {
    await maybeRollback(conn, beganTransaction);
    throw err;
  } finally {
    if (conn !== db && conn && typeof conn.release === 'function') {
      conn.release();
    }
  }

  return {
    success: true,
    logicalKey,
    productId,
    deviceName,
    recordCount: historyRows.length
  };
}

async function processDeviceData(pushData, db) {
  const pushId = pushData.id || '';
  const pushTime = pushData.time || Date.now();
  const nonce = pushData.nonce || '';
  const signature = pushData.signature || '';

  if (!pushData.msg || typeof pushData.msg !== 'string') {
    throw new Error('msg missing');
  }

  const decryptedMsg = decryptMsg(pushData.msg, ONE_NET_AES_KEY);
  const innerMsg = JSON.parse(decryptedMsg);

  const normalized = normalizeIncomingMessage(innerMsg, pushTime);
  return persistNormalizedDeviceData(normalized, db, {
    provider: 'onenet',
    pushId,
    pushTime,
    nonce,
    signature,
    rawEvent: 'webhook'
  });
}

async function processEmqxData(body, db) {
  const pushTime = Number(
    pickFirstValue(body, ['timestamp', 'publish_received_at', 'received_at', 'ts'])
  ) || Date.now();
  const normalized = normalizeEmqxMessage(body, pushTime);

  if (EMQX_WEBHOOK_TOKEN) {
    const token = pickFirstValue(body, ['token', 'webhookToken', 'webhook_token']);
    if (String(token || '').trim() !== EMQX_WEBHOOK_TOKEN) {
      throw new Error('EMQX webhook token mismatch');
    }
  }

  return persistNormalizedDeviceData(normalized, db, {
    provider: 'emqx',
    pushTime,
    pushId: pickFirstValue(body, ['id', 'message_id']) || '',
    topic: pickFirstValue(body, ['topic']) || '',
    clientId: pickFirstValue(body, ['clientid', 'client_id', 'clientId']) || '',
    username: pickFirstValue(body, ['username', 'user']) || '',
    rawEvent: pickFirstValue(body, ['event', 'action']) || 'message.publish'
  });
}

exports.main = async (event) => {
  const method = getHttpMethod(event);
  const query = getQuery(event);
  const body = getBody(event);
  const headers = getHeaders(event);

  console.log('method=', method, 'query=', query);

  if (!ONE_NET_TOKEN && !EMQX_WEBHOOK_TOKEN) {
    return {
      statusCode: 500,
      body: 'ONE_NET_TOKEN or EMQX_WEBHOOK_TOKEN is required'
    };
  }

  if (method === 'GET') {
    if (!ONE_NET_TOKEN) {
      return { statusCode: 200, body: 'ok' };
    }

    const { msg, nonce, signature } = query;
    if (!msg || !nonce || !signature) {
      return { statusCode: 400, body: 'Missing parameters' };
    }

    if (!verifySignature(msg, nonce, signature, ONE_NET_TOKEN)) {
      return { statusCode: 403, body: 'Verification failed' };
    }

    return { statusCode: 200, body: msg };
  }

  if (method !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const db = await getDb();

    const explicitSource = String(
      getHeaderValue(headers, ['x-ingest-source', 'x-provider', 'x-webhook-source']) ||
      pickFirstValue(query, ['source', 'provider']) ||
      body.provider ||
      ''
    ).toLowerCase();
    const looksLikeEmqx =
      explicitSource === 'emqx' ||
      Boolean(body?.event) ||
      Boolean(body?.topic) ||
      Boolean(body?.clientid || body?.client_id || body?.clientId) ||
      Boolean(body?.payload && !body?.msg);
    const result = looksLikeEmqx
      ? await processEmqxData(body, db)
      : await processDeviceData(body, db);
    return {
      statusCode: 200,
      body: JSON.stringify({
        code: 0,
        message: 'success',
        ...result
      })
    };
  } catch (err) {
    console.error('Error processing push:', {
      error: err.message,
      stack: err.stack,
      pushData: body,
      headers
    });
    return {
      statusCode: 200,
      body: JSON.stringify({
        code: 1,
        message: 'success (error caught)',
        error: err.message
      })
    };
  }
};

exports.main_handler = exports.main;
