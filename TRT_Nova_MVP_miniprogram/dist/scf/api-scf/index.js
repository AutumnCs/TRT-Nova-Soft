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
 * - POST /device/commands
 * - POST /device/command/detail
 * - POST /device/command/retry
 * - GET /user/profile
 * - POST /user/profile
 * - POST /journal/month
 * - POST /journal/day
 * - POST /journal/add
 *
 * Authentication order:
 * 1. x-access-token / Authorization: Bearer <jwt> if JWT_SECRET is configured
 * 2. x-wx-openid / x-openid header
 * 3. body.openid
 */

const crypto = require('crypto');
const { createRuntimeCache } = require('./lib/runtimeCache');

let pool;
const runtimeCache = createRuntimeCache('api-scf');

function logInfo(event, payload = {}) {
  console.log(JSON.stringify({
    level: 'info',
    service: 'api-scf',
    event,
    ts: Date.now(),
    ...payload
  }));
}

function logError(event, payload = {}) {
  console.error(JSON.stringify({
    level: 'error',
    service: 'api-scf',
    event,
    ts: Date.now(),
    ...payload
  }));
}

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

function normalizeProvider(input) {
  const provider = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (provider === 'onenet' || provider === 'emqx') {
    return provider;
  }
  return '';
}

function normalizeFullDeviceName(deviceCode) {
  const code = normalizeDeviceCode(deviceCode);
  if (!code) return '';
  return code.startsWith('Nova_') ? code : `Nova_${code}`;
}

function renderTemplate(template, values = {}) {
  return String(template || '').replace(/\$\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function parseBooleanEnv(input, fallback = false) {
  if (input === undefined || input === null || input === '') {
    return fallback;
  }
  const normalized = String(input).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
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

function parseCommaList(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRuntimeServiceProxyConfig() {
  const enabled = parseBooleanEnv(process.env.API_SCF_RUNTIME_PROXY_ENABLED, false);
  const baseUrl = String(process.env.RUNTIME_SERVICE_BASE_URL || '').trim().replace(/\/+$/g, '');
  const timeoutMs = Math.max(1000, Number(process.env.API_SCF_RUNTIME_PROXY_TIMEOUT_MS) || 8000);
  const routeList = parseCommaList(
    process.env.API_SCF_RUNTIME_PROXY_ROUTES ||
    '/device/latest,/device/cmd,/device/commands'
  );

  return {
    enabled,
    baseUrl,
    timeoutMs,
    routes: routeList,
    routeSet: new Set(routeList)
  };
}

function shouldProxyRuntimeRoute(path) {
  const config = getRuntimeServiceProxyConfig();
  if (!config.enabled || !config.baseUrl) {
    return false;
  }

  return config.routes.some((route) => path.endsWith(route));
}

function buildRuntimeServiceUrl(runtimePath) {
  const config = getRuntimeServiceProxyConfig();
  if (!config.baseUrl) {
    throw new Error('Missing RUNTIME_SERVICE_BASE_URL');
  }
  return `${config.baseUrl}${runtimePath.startsWith('/') ? runtimePath : `/${runtimePath}`}`;
}

function buildRuntimeServiceHeaders(sourceHeaders = {}, openid = '') {
  const headers = {
    'content-type': 'application/json'
  };
  if (openid) {
    headers['x-wx-openid'] = openid;
  }
  const requestId =
    sourceHeaders['x-request-id'] ||
    sourceHeaders['X-REQUEST-ID'] ||
    sourceHeaders['xRequestId'] ||
    '';
  if (requestId) {
    headers['x-request-id'] = String(requestId).trim();
  }
  return headers;
}

async function httpJsonRequest(urlString, { method = 'POST', headers = {}, body = null, timeoutMs = 8000 } = {}) {
  const parsedUrl = new URL(urlString);
  const transport = parsedUrl.protocol === 'http:' ? require('http') : require('https');
  const requestBody = body === null || body === undefined
    ? ''
    : (typeof body === 'string' ? body : JSON.stringify(body));
  const requestHeaders = {
    ...headers
  };

  if (requestBody) {
    requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search || ''}`,
      method,
      headers: requestHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
          return;
        }
        const error = new Error(parsed?.msg || parsed?.message || `Runtime service HTTP ${res.statusCode}`);
        error.statusCode = res.statusCode;
        error.payload = parsed;
        reject(error);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Runtime service request timeout')));
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function requestRuntimeService(runtimePath, payload, sourceHeaders = {}, openid = '') {
  const config = getRuntimeServiceProxyConfig();
  const url = buildRuntimeServiceUrl(runtimePath);
  return httpJsonRequest(url, {
    method: 'POST',
    timeoutMs: config.timeoutMs,
    headers: buildRuntimeServiceHeaders(sourceHeaders, openid),
    body: payload
  });
}

function normalizePlantRow(row = {}) {
  const rowTags = parseJsonField(row.tags_json, []);
  return {
    id: row.id,
    name: row.name || '',
    aliases: parseJsonField(row.aliases_json, []),
    family: row.family || '',
    scientificName: row.scientific_name || '',
    feature: row.feature || '',
    featureText: row.feature_text || '',
    category: row.category || '',
    image: row.image_url || '',
    tags: Array.isArray(rowTags) ? rowTags : [],
    description: row.description || '',
    difficulty: row.difficulty || '',
    care: {
      light: row.care_light || '',
      water: row.care_water || '',
      temperature: row.care_temperature || '',
      humidity: row.care_humidity || '',
      soil: row.care_soil || '',
      fertilizer: row.care_fertilizer || '',
      ventilation: row.care_ventilation || ''
    },
    seasonalTips: parseJsonField(row.seasonal_tips_json, []),
    commonIssues: parseJsonField(row.common_issues_json, []),
    faq: parseJsonField(row.faq_json, []),
    recommendQuestions: parseJsonField(row.recommend_questions_json, []),
    deviceInterpretation: parseJsonField(row.device_interpretation_json, {}),
    agentNotes: row.agent_notes || ''
  };
}

function toSqlDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  ].join(' ');
}

function buildCommandId(logicalKey) {
  const seed = `${logicalKey || 'device'}|${Date.now()}|${Math.random()}`;
  return crypto.createHash('md5').update(seed).digest('hex');
}

function getDeviceOfflineThresholdMs() {
  const raw = Number(process.env.DEVICE_OFFLINE_THRESHOLD_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

function deriveDeviceOnlineState(updatedAtMs, hasLatest) {
  const lastSeenAt = Number(updatedAtMs || 0);
  if (!hasLatest || !lastSeenAt) {
    return {
      online: false,
      offline: true,
      lastSeenAt: lastSeenAt || null,
      offlineSinceMs: null,
      status: 'never_reported'
    };
  }

  const thresholdMs = getDeviceOfflineThresholdMs();
  const now = Date.now();
  const delta = Math.max(0, now - lastSeenAt);
  const online = delta <= thresholdMs;

  return {
    online,
    offline: !online,
    lastSeenAt,
    offlineSinceMs: online ? null : lastSeenAt + thresholdMs,
    status: online ? 'online' : 'offline'
  };
}

function getParamNode(params = {}, keys = []) {
  for (const key of keys) {
    const node = params[key];
    if (node === undefined || node === null || node === '') {
      continue;
    }
    return node;
  }
  return null;
}

function getParamValue(node) {
  if (node && typeof node === 'object' && !Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, 'value')) {
    return node.value;
  }
  return node;
}

function getParamTime(node) {
  if (node && typeof node === 'object' && !Array.isArray(node) && node.time) {
    return Number(node.time) || null;
  }
  return null;
}

function normalizeBooleanMetric(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === '1') return true;
  if (raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (['true', 'yes', 'dead', 'on', 'open'].includes(value)) return true;
    if (['false', 'no', 'alive', 'off', 'close', 'closed'].includes(value)) return false;
  }
  return null;
}

function formatSoulStateByIr(raw) {
  const normalized = normalizeBooleanMetric(raw);
  if (normalized === true) return '没出窝';
  if (normalized === false) return '出窝';
  return '--';
}

function formatTimestampText(ts) {
  const value = Number(ts || 0);
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  const pad = (part) => String(part).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildLatestAggregates(row = {}) {
  const params = row.params || {};
  const latestCommand = row.latestCommand || null;

  const tempNode = getParamNode(params, ['dht_temp', 'temp', 'temperature', 'air_temp']);
  const humidityNode = getParamNode(params, ['dht_humi', 'humidity', 'air_humidity']);
  const lightNode = getParamNode(params, ['light_val', 'light', 'illuminance', 'lux']);
  const soilNode = getParamNode(params, ['soil_percent', 'soil', 'soil_moisture']);
  const fanNode = getParamNode(params, ['fan_switch', 'test']);
  const runStateNode = getParamNode(params, ['run_state']);
  const irStatusNode = getParamNode(params, ['ir_status']);
  const isDeadNode = getParamNode(params, ['is_dead']);
  const favorabilityNode = getParamNode(params, ['favorability', 'favor', 'affinity', 'likability', 'haogandu']);
  const personalityNode = getParamNode(params, ['plant_personality', 'personality', 'character']);
  const plantTypeNode = getParamNode(params, ['plant_type', 'ptype']);

  const fanReportedState = normalizeBooleanMetric(getParamValue(fanNode));
  const latestCommandStatus = String((latestCommand && latestCommand.status) || '').toLowerCase();
  const fanPending = ['pending', 'sent', 'acked'].includes(latestCommandStatus);

  return {
    sensorSnapshot: {
      temp: {
        value: getParamValue(tempNode),
        time: getParamTime(tempNode),
        unit: '℃'
      },
      humidity: {
        value: getParamValue(humidityNode),
        time: getParamTime(humidityNode),
        unit: '%'
      },
      light: {
        value: getParamValue(lightNode),
        time: getParamTime(lightNode),
        unit: 'lx'
      },
      soil: {
        value: getParamValue(soilNode),
        time: getParamTime(soilNode),
        unit: '%'
      }
    },
    controlSnapshot: {
      fan: {
        hasReportedState: fanReportedState !== null,
        reportedState: fanReportedState,
        reportedAt: getParamTime(fanNode),
        pending: fanPending,
        latestCommandStatus: latestCommandStatus || '',
        latestCommandId: latestCommand ? latestCommand.commandId : ''
      }
    },
    plantSnapshot: {
      runState: normalizeBooleanMetric(getParamValue(runStateNode)),
      irStatus: normalizeBooleanMetric(getParamValue(irStatusNode)),
      isDead: normalizeBooleanMetric(getParamValue(isDeadNode)),
      soulState: formatSoulStateByIr(getParamValue(irStatusNode)),
      favorability: getParamValue(favorabilityNode),
      personality: getParamValue(personalityNode),
      reportedPlantType: getParamValue(plantTypeNode) || row.plantType || ''
    },
    displaySnapshot: {
      updatedAtText: formatTimestampText(row.updatedAt || row.lastSeenAt),
      lastSeenAtText: formatTimestampText(row.lastSeenAt),
      onlineStatusText: row.onlineStatus === 'online'
        ? '在线'
        : (row.onlineStatus === 'offline' ? '离线' : '待上报')
    }
  };
}

function mergeLatestRowWithCache(deviceRow = {}, cacheSnapshot = {}) {
  const merged = {
    ...deviceRow
  };

  if (cacheSnapshot.latest && typeof cacheSnapshot.latest === 'object') {
    if (cacheSnapshot.latest.provider) merged.provider = cacheSnapshot.latest.provider;
    if (cacheSnapshot.latest.productId) merged.productId = cacheSnapshot.latest.productId;
    if (cacheSnapshot.latest.deviceName) merged.deviceName = cacheSnapshot.latest.deviceName;
    if (cacheSnapshot.latest.updatedAt) merged.updatedAt = cacheSnapshot.latest.updatedAt;
    if (cacheSnapshot.latest.params && typeof cacheSnapshot.latest.params === 'object') {
      merged.params = cacheSnapshot.latest.params;
      merged.hasLatest = true;
    }
  }

  if (cacheSnapshot.online && typeof cacheSnapshot.online === 'object') {
    if (typeof cacheSnapshot.online.online === 'boolean') merged.online = cacheSnapshot.online.online;
    if (typeof cacheSnapshot.online.offline === 'boolean') merged.offline = cacheSnapshot.online.offline;
    if (cacheSnapshot.online.onlineStatus) merged.onlineStatus = cacheSnapshot.online.onlineStatus;
    if (cacheSnapshot.online.lastSeenAt) merged.lastSeenAt = cacheSnapshot.online.lastSeenAt;
  }

  if ((!merged.lastSeenAt || merged.lastSeenAt < (merged.updatedAt || 0)) && merged.updatedAt) {
    merged.lastSeenAt = merged.updatedAt;
  }

  if (cacheSnapshot.command && typeof cacheSnapshot.command === 'object') {
    merged.latestCommand = {
      ...(merged.latestCommand || {}),
      ...cacheSnapshot.command,
      commandId: cacheSnapshot.command.commandId || cacheSnapshot.command.command_id || (merged.latestCommand && merged.latestCommand.commandId) || ''
    };
  }

  const onlineState = deriveDeviceOnlineState(merged.lastSeenAt || merged.updatedAt || null, !!merged.hasLatest);
  merged.online = onlineState.online;
  merged.offline = onlineState.offline;
  merged.onlineStatus = onlineState.status;
  merged.lastSeenAt = onlineState.lastSeenAt;
  merged.offlineSinceMs = onlineState.offlineSinceMs;

  return merged;
}

function mergeCommandRowWithCache(commandRow = {}, cacheState = {}) {
  if (!cacheState || typeof cacheState !== 'object') {
    return {
      ...commandRow
    };
  }

  const merged = {
    ...commandRow
  };

  if (cacheState.logicalKey) merged.logicalKey = cacheState.logicalKey;
  if (cacheState.provider) merged.provider = cacheState.provider;
  if (cacheState.productId) merged.productId = cacheState.productId;
  if (cacheState.deviceName) merged.deviceName = cacheState.deviceName;
  if (cacheState.commandName) merged.commandName = cacheState.commandName;
  if (cacheState.status) merged.status = cacheState.status;
  if (cacheState.errorMessage !== undefined) merged.errorMessage = cacheState.errorMessage || '';
  if (cacheState.sentParams && typeof cacheState.sentParams === 'object') merged.sentParams = cacheState.sentParams;
  if (cacheState.latestSnapshot && typeof cacheState.latestSnapshot === 'object') merged.latestSnapshot = cacheState.latestSnapshot;
  if (cacheState.providerResponse && typeof cacheState.providerResponse === 'object') merged.providerResponse = cacheState.providerResponse;
  if (cacheState.requestedAt) merged.requestedAt = cacheState.requestedAt;
  if (cacheState.sentAt) merged.sentAt = cacheState.sentAt;
  if (cacheState.ackedAt) merged.ackedAt = cacheState.ackedAt;
  if (cacheState.doneAt) merged.doneAt = cacheState.doneAt;
  if (cacheState.failedAt) merged.failedAt = cacheState.failedAt;

  return merged;
}

function summarizeLatestCacheUsage(logicalKeys = [], cacheMap = {}) {
  const summary = {
    requested: logicalKeys.length,
    latestHits: 0,
    onlineHits: 0,
    commandHits: 0
  };

  for (const key of logicalKeys) {
    const cacheEntry = cacheMap[key] || {};
    if (cacheEntry.latest) summary.latestHits += 1;
    if (cacheEntry.online) summary.onlineHits += 1;
    if (cacheEntry.command) summary.commandHits += 1;
  }

  summary.latestMisses = Math.max(0, summary.requested - summary.latestHits);
  summary.onlineMisses = Math.max(0, summary.requested - summary.onlineHits);
  summary.commandMisses = Math.max(0, summary.requested - summary.commandHits);
  return summary;
}

function summarizeCommandCacheUsage(commandIds = [], cacheMap = {}) {
  const requested = commandIds.length;
  const hits = commandIds.reduce((count, id) => count + (cacheMap[id] ? 1 : 0), 0);
  return {
    requested,
    hits,
    misses: Math.max(0, requested - hits)
  };
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
  const customAccessToken =
    headers['x-access-token'] ||
    headers['X-ACCESS-TOKEN'] ||
    headers['xAccessToken'] ||
    '';
  if (customAccessToken) {
    const payload = verifyJwt(String(customAccessToken).trim(), jwtSecret);
    return payload?.openid ? String(payload.openid).trim() : '';
  }

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
  const profile = normalizePlantRow(row);
  return {
    ...profile,
    isFavorite: favoriteIdSet ? favoriteIdSet.has(row.id) : false
  };
}

// GET /plant/library — 返回全部植物，并标记当前用户的收藏
async function getPlantLibrary(db, openid) {
  const [plantRows] = await db.execute(
    `SELECT id, name, family, scientific_name, feature, feature_text, category,
            image_url, tags_json, description, aliases_json, difficulty,
            care_light, care_water, care_temperature, care_humidity, care_soil,
            care_fertilizer, care_ventilation, seasonal_tips_json,
            common_issues_json, faq_json, recommend_questions_json,
            device_interpretation_json, agent_notes, sort_order
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

function mapTodoRow(row = {}) {
  return {
    _id: row.id || row._id || '',
    id: row.id || row._id || '',
    openid: row.openid || '',
    logicalKey: row.logical_key || row.logicalKey || '',
    title: row.title || '',
    urgent: Number(row.urgent) === 1 || row.urgent === true,
    icon: row.icon || '📝',
    iconColor: row.icon_color || row.iconColor || 'text-blue-500',
    iconBg: row.icon_bg || row.iconBg || 'bg-blue-50',
    desc: row.description_text || row.desc || '',
    status: row.status || 'pending',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapJournalRow(row = {}) {
  return {
    id: row.id || '',
    openid: row.openid || '',
    logicalKey: row.logical_key || '',
    plantLibraryId: row.plant_library_id || null,
    eventDate: row.event_date || '',
    eventType: row.event_type || 'note',
    title: row.title || '',
    content: row.content_text || '',
    photos: parseJsonField(row.photos_json, []),
    relatedTodoId: row.related_todo_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeJournalEventType(input) {
  const value = String(input || '').trim().toLowerCase();
  const allow = new Set(['watering', 'fertilizing', 'pruning', 'relocation', 'note', 'photo', 'todo_done']);
  return allow.has(value) ? value : 'note';
}

function normalizeJournalDate(input) {
  const value = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function normalizeJournalMonth(input) {
  const value = String(input || '').trim();
  return /^\d{4}-\d{2}$/.test(value) ? value : '';
}

async function listJournalMonthForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const month = normalizeJournalMonth(input?.month);
  if (!logicalKey || !month) {
    return { success: false, msg: 'logicalKey and month are required' };
  }

  const aclRows = await getActiveAclRows(db, openid, logicalKey);
  if (!aclRows.length) {
    return { success: true, records: [], days: [] };
  }

  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, plant_library_id, event_date, event_type, title, content_text,
            photos_json, related_todo_id, created_at, updated_at
     FROM plant_journal
     WHERE openid = ? AND logical_key = ? AND DATE_FORMAT(event_date, '%Y-%m') = ?
     ORDER BY event_date ASC, created_at ASC, id ASC`,
    [openid, logicalKey, month]
  );

  const records = rows.map(mapJournalRow);
  const days = Array.from(new Set(records.map((item) => item.eventDate)));
  return { success: true, records, days };
}

async function listJournalDayForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const date = normalizeJournalDate(input?.date);
  if (!logicalKey || !date) {
    return { success: false, msg: 'logicalKey and date are required' };
  }

  const aclRows = await getActiveAclRows(db, openid, logicalKey);
  if (!aclRows.length) {
    return { success: true, records: [] };
  }

  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, plant_library_id, event_date, event_type, title, content_text,
            photos_json, related_todo_id, created_at, updated_at
     FROM plant_journal
     WHERE openid = ? AND logical_key = ? AND event_date = ?
     ORDER BY created_at ASC, id ASC`,
    [openid, logicalKey, date]
  );

  return {
    success: true,
    records: rows.map(mapJournalRow)
  };
}

async function addJournalRecordForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const eventDate = normalizeJournalDate(input?.eventDate) || toSqlDateTime(Date.now()).slice(0, 10);
  const eventType = normalizeJournalEventType(input?.eventType);
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const content = typeof input?.content === 'string' ? input.content.trim() : '';
  const plantLibraryId = input?.plantLibraryId ? Number(input.plantLibraryId) : null;
  const photos = Array.isArray(input?.photos) ? input.photos.filter(Boolean) : [];

  if (!logicalKey) {
    return { success: false, msg: 'logicalKey is required' };
  }
  if (!title) {
    return { success: false, msg: 'title is required' };
  }

  const aclRows = await getActiveAclRows(db, openid, logicalKey);
  if (!aclRows.length) {
    return { success: false, msg: 'permission denied' };
  }

  const now = toSqlDateTime(Date.now());
  const [result] = await db.execute(
    `INSERT INTO plant_journal
      (openid, logical_key, plant_library_id, event_date, event_type, title, content_text, photos_json, related_todo_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      openid,
      logicalKey,
      plantLibraryId || null,
      eventDate,
      eventType,
      title,
      content || null,
      JSON.stringify(photos),
      now,
      now
    ]
  );

  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, plant_library_id, event_date, event_type, title, content_text,
            photos_json, related_todo_id, created_at, updated_at
     FROM plant_journal
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  return {
    success: true,
    record: rows.length ? mapJournalRow(rows[0]) : null
  };
}

async function listTodosForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const sql = logicalKey
    ? `SELECT id, openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at
       FROM todos
       WHERE openid = ? AND logical_key = ?
       ORDER BY urgent DESC, updated_at DESC, id DESC`
    : `SELECT id, openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at
       FROM todos
       WHERE openid = ? AND (logical_key = '' OR logical_key IS NULL)
       ORDER BY urgent DESC, updated_at DESC, id DESC`;
  const params = logicalKey ? [openid, logicalKey] : [openid];
  const [rows] = await db.execute(sql, params);
  return {
    success: true,
    todos: rows.map(mapTodoRow)
  };
}

async function listGlobalTodosForUser(db, openid) {
  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at
     FROM todos
     WHERE openid = ? AND logical_key = 'global'
     ORDER BY urgent DESC, updated_at DESC, id DESC`,
    [openid]
  );
  return {
    success: true,
    todos: rows.map(mapTodoRow)
  };
}

async function addTodoForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const title = typeof input?.content === 'string'
    ? input.content.trim()
    : typeof input?.title === 'string'
      ? input.title.trim()
      : '';

  if (!title) {
    return {
      success: false,
      msg: 'content is required'
    };
  }

  const urgent = input?.urgent ? 1 : 0;
  const icon = typeof input?.icon === 'string' && input.icon.trim() ? input.icon.trim() : '📝';
  const iconColor = typeof input?.iconColor === 'string' && input.iconColor.trim() ? input.iconColor.trim() : 'text-blue-500';
  const iconBg = typeof input?.iconBg === 'string' && input.iconBg.trim() ? input.iconBg.trim() : 'bg-blue-50';
  const desc = typeof input?.desc === 'string' ? input.desc.trim() : '长按切换优先级';
  const now = toSqlDateTime(Date.now());

  const [result] = await db.execute(
    `INSERT INTO todos
      (openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      openid,
      logicalKey || '',
      title,
      urgent,
      icon,
      iconColor,
      iconBg,
      desc,
      now,
      now
    ]
  );

  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at
     FROM todos
     WHERE id = ?
     LIMIT 1`,
    [result.insertId]
  );

  return {
    success: true,
    todo: rows.length ? mapTodoRow(rows[0]) : null
  };
}

async function completeTodoForUser(db, openid, input) {
  const todoId = Number(input?.todoId || input?.id || 0);
  if (!todoId) {
    return {
      success: false,
      msg: 'todoId is required'
    };
  }

  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, title FROM todos WHERE id = ? LIMIT 1`,
    [todoId]
  );

  if (!rows.length || rows[0].openid !== openid) {
    return {
      success: false,
      msg: 'permission denied'
    };
  }

  if (logicalKey && rows[0].logical_key && rows[0].logical_key !== logicalKey) {
    return {
      success: false,
      msg: 'device mismatch'
    };
  }

  const todo = rows[0];
  const eventLogicalKey = todo.logical_key || logicalKey;
  if (eventLogicalKey) {
    const [aclRows] = await db.execute(
      `SELECT plant_library_id
       FROM device_acl
       WHERE openid = ? AND logical_key = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [openid, eventLogicalKey]
    );
    const now = toSqlDateTime(Date.now());
    await db.execute(
      `INSERT INTO plant_journal
        (openid, logical_key, plant_library_id, event_date, event_type, title, content_text, photos_json, related_todo_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo_done', ?, ?, '[]', ?, ?, ?)`,
      [
        openid,
        eventLogicalKey,
        aclRows.length ? (aclRows[0].plant_library_id || null) : null,
        now.slice(0, 10),
        '完成待办',
        todo.title || '',
        todoId,
        now,
        now
      ]
    );
  }

  await db.execute(`DELETE FROM todos WHERE id = ?`, [todoId]);
  return {
    success: true,
    todoId
  };
}

async function toggleTodoUrgencyForUser(db, openid, input) {
  const todoId = Number(input?.todoId || input?.id || 0);
  if (!todoId) {
    return {
      success: false,
      msg: 'todoId is required'
    };
  }

  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const [rows] = await db.execute(
    `SELECT id, openid, logical_key, urgent FROM todos WHERE id = ? LIMIT 1`,
    [todoId]
  );

  if (!rows.length || rows[0].openid !== openid) {
    return {
      success: false,
      msg: 'permission denied'
    };
  }

  if (logicalKey && rows[0].logical_key && rows[0].logical_key !== logicalKey) {
    return {
      success: false,
      msg: 'device mismatch'
    };
  }

  const newUrgent = rows[0].urgent ? 0 : 1;
  const desc = newUrgent ? '高优先级' : '普通优先级';
  const iconColor = newUrgent ? 'text-red-500' : 'text-blue-500';
  const iconBg = newUrgent ? 'bg-red-50' : 'bg-blue-50';
  const now = toSqlDateTime(Date.now());

  await db.execute(
    `UPDATE todos
     SET urgent = ?, description_text = ?, icon_color = ?, icon_bg = ?, updated_at = ?
     WHERE id = ?`,
    [newUrgent, desc, iconColor, iconBg, now, todoId]
  );

  const [updatedRows] = await db.execute(
    `SELECT id, openid, logical_key, title, urgent, icon, icon_color, icon_bg, description_text, status, created_at, updated_at
     FROM todos
     WHERE id = ?
     LIMIT 1`,
    [todoId]
  );

  return {
    success: true,
    todo: updatedRows.length ? mapTodoRow(updatedRows[0]) : null
  };
}

async function loadPlantMapForAclRows(db, openid, aclRows = []) {
  const plantLibraryIds = aclRows
    .map((item) => item.plant_library_id)
    .filter(Boolean);

  if (!plantLibraryIds.length) {
    return {};
  }

  const placeholders = plantLibraryIds.map(() => '?').join(', ');
  const [plantRows] = await db.execute(
    `SELECT id, name, family, scientific_name, feature, feature_text, category,
            image_url, tags_json, description, aliases_json, difficulty,
            care_light, care_water, care_temperature, care_humidity, care_soil,
            care_fertilizer, care_ventilation, seasonal_tips_json,
            common_issues_json, faq_json, recommend_questions_json,
            device_interpretation_json, agent_notes
     FROM plant_library WHERE id IN (${placeholders}) AND is_active = 1`,
    plantLibraryIds
  );
  const [favRows] = await db.execute(
    `SELECT plant_id FROM user_plant_favorites WHERE openid = ? AND plant_id IN (${placeholders})`,
    [openid, ...plantLibraryIds]
  );
  const favSet = new Set(favRows.map((row) => row.plant_id));

  return plantRows.reduce((acc, row) => {
    acc[row.id] = mapPlantRow(row, favSet);
    return acc;
  }, {});
}

function buildAclAlias(acl = {}, deviceName = '', logicalKey = '') {
  return acl.alias || (deviceName.startsWith('Nova_') ? deviceName.slice(5) : deviceName) || logicalKey;
}

async function queryLatestByUserLocal(db, openid, input) {
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
    `SELECT logical_key, product_id, device_name, updated_at_ms, data_id, notify_type, message_type, params_json, push_meta_json
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
  const commandMap = await getLatestCommandStateMap(db, logicalKeys);
  const cachedSnapshots = await Promise.all(
    logicalKeys.map(async (key) => ({
      logicalKey: key,
      latest: await runtimeCache.getLatestDeviceState(key),
      online: await runtimeCache.getDeviceOnlineState(key),
      command: await runtimeCache.getLatestDeviceCommandState(key)
    }))
  );
  const cacheMap = cachedSnapshots.reduce((acc, item) => {
    acc[item.logicalKey] = item;
    return acc;
  }, {});
  const cacheSummary = summarizeLatestCacheUsage(logicalKeys, cacheMap);

  // 批量拉取已关联植物的信息
  const plantLibraryIds = aclRows
    .map(a => a.plant_library_id)
    .filter(Boolean);

  let plantMap = {};
  if (plantLibraryIds.length > 0) {
    const placeholders2 = plantLibraryIds.map(() => '?').join(', ');
    const [plantRows] = await db.execute(
      `SELECT id, name, family, scientific_name, feature, feature_text, category,
              image_url, tags_json, description, aliases_json, difficulty,
              care_light, care_water, care_temperature, care_humidity, care_soil,
              care_fertilizer, care_ventilation, seasonal_tips_json,
              common_issues_json, faq_json, recommend_questions_json,
              device_interpretation_json, agent_notes
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
    const command = commandMap[key] || null;
    const mergedDeviceName = latest.device_name || device.device_name || '';
    const plantLibraryId = acl.plant_library_id || null;
    const latestMeta = parseJsonField(latest.push_meta_json, {});
    const provider = normalizeProvider(latestMeta?.provider) || normalizeProvider(latestMeta?.sourceMeta?.provider) || '';
    const hasLatest = !!latestMap[key];
    const onlineState = deriveDeviceOnlineState(latest.updated_at_ms || null, hasLatest);

    const baseDeviceRow = {
      logicalKey: key,
      provider,
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
      hasLatest,
      online: onlineState.online,
      offline: onlineState.offline,
      onlineStatus: onlineState.status,
      lastSeenAt: onlineState.lastSeenAt,
      offlineSinceMs: onlineState.offlineSinceMs,
      latestCommand: command
    };
    const deviceRow = mergeLatestRowWithCache(baseDeviceRow, cacheMap[key] || {});

    return {
      ...deviceRow,
      ...buildLatestAggregates(deviceRow)
    };
  });

  logInfo('device_latest_cache_summary', {
    logicalKey: logicalKey || '',
    cacheSummary
  });

  return {
    success: true,
    deviceData,
    cacheMeta: cacheSummary
  };
}

async function queryLatestByUserViaRuntimeService(db, openid, input, sourceHeaders = {}) {
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
  const [deviceRows] = await db.execute(
    `SELECT logical_key, product_id, device_name, status, external_device_id
     FROM devices
     WHERE logical_key IN (${placeholders})`,
    logicalKeys
  );
  const deviceMap = deviceRows.reduce((acc, row) => {
    acc[row.logical_key] = row;
    return acc;
  }, {});
  const plantMap = await loadPlantMapForAclRows(db, openid, aclRows);

  const runtimeResponses = await Promise.all(
    logicalKeys.map(async (key) => ({
      logicalKey: key,
      response: await requestRuntimeService('/runtime/device/latest', { logicalKey: key }, sourceHeaders, openid)
    }))
  );
  const runtimeMap = runtimeResponses.reduce((acc, item) => {
    acc[item.logicalKey] = item.response || {};
    return acc;
  }, {});

  return {
    success: true,
    deviceData: logicalKeys.map((key) => {
      const acl = aclRows.find((item) => item.logical_key === key) || {};
      const device = deviceMap[key] || {};
      const runtimeRow = runtimeMap[key] || {};
      const mergedDeviceName = runtimeRow.deviceName || device.device_name || '';
      const plantLibraryId = acl.plant_library_id || null;
      return {
        logicalKey: key,
        provider: runtimeRow.provider || '',
        productId: runtimeRow.productId || device.product_id || '',
        deviceName: mergedDeviceName,
        alias: buildAclAlias(acl, mergedDeviceName, key),
        location: acl.location || '',
        plantType: acl.plant_type || '',
        plantLibraryId,
        plant: plantLibraryId ? (plantMap[plantLibraryId] || null) : null,
        role: acl.role || '',
        aclStatus: acl.status || '',
        params: runtimeRow.params || {},
        updatedAt: runtimeRow.updatedAt || null,
        hasLatest: !!(runtimeRow.updatedAt || Object.keys(runtimeRow.params || {}).length),
        online: runtimeRow.online === true,
        offline: runtimeRow.offline === true,
        onlineStatus: runtimeRow.onlineStatus || 'never_reported',
        lastSeenAt: runtimeRow.lastSeenAt || null,
        offlineSinceMs: runtimeRow.offlineSinceMs || null,
        latestCommand: runtimeRow.latestCommand || null,
        sensorSnapshot: runtimeRow.sensorSnapshot || {},
        controlSnapshot: runtimeRow.controlSnapshot || {},
        plantSnapshot: runtimeRow.plantSnapshot || {},
        displaySnapshot: runtimeRow.displaySnapshot || {}
      };
    }),
    cacheMeta: {
      proxy: true,
      requested: logicalKeys.length,
      route: '/runtime/device/latest'
    }
  };
}

async function queryLatestByUser(db, openid, input, sourceHeaders = {}) {
  if (shouldProxyRuntimeRoute('/device/latest')) {
    try {
      return await queryLatestByUserViaRuntimeService(db, openid, input, sourceHeaders);
    } catch (err) {
      logError('runtime_proxy_failed', {
        route: '/device/latest',
        message: err.message,
        statusCode: err.statusCode || null
      });
    }
  }

  return queryLatestByUserLocal(db, openid, input);
}

async function queryHistoryByUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  if (!logicalKey) {
    return {
      success: false,
      msg: '设备标识缺失'
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
      msg: '请输入设备码'
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
        msg: '设备码不存在或设备未激活'
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
          msg: '该设备已绑定到当前账号',
          logicalKey
        };
      }

      await conn.rollback();
      return {
        success: false,
        msg: '该设备已被其他账号绑定'
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
      msg: '绑定成功',
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
      msg: '设备标识缺失'
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
      msg: '未找到绑定记录'
    };
  }

  const now = toSqlDateTime(Date.now());
  const [updateResult] = await db.execute(
    `UPDATE device_acl
     SET status = 'inactive',
         unbind_time = ?,
         updated_at = ?
     WHERE id = ? AND status = 'active'`,
    [now, now, rows[0].id]
  );

  if (!updateResult.affectedRows) {
    return {
      success: false,
      msg: '解绑失败，请稍后重试'
    };
  }

  return {
    success: true,
    msg: '解绑成功',
    logicalKey
  };
}

async function updateDeviceProfileForUser(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  if (!logicalKey) {
    return {
      success: false,
      msg: '设备标识缺失'
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
      msg: '未找到绑定记录'
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
    msg: '保存成功',
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

/**
 * 生成 OneNET 产品级 Authorization token
 * 环境变量: ONENET_ACCESS_KEY（产品 access_key，base64 编码）
 */
function resolveOneNetAuthConfig(productId) {
  const authMode = String(process.env.ONENET_AUTH_MODE || 'product').trim().toLowerCase();
  const version = '2022-05-01';
  const method = String(process.env.ONENET_AUTH_METHOD || 'sha256').trim().toLowerCase();
  const ttlSeconds = Math.max(60, Number(process.env.ONENET_AUTH_TTL_SECONDS) || 3600);

  if (!['md5', 'sha1', 'sha256'].includes(method)) {
    throw new Error(`Unsupported ONENET_AUTH_METHOD: ${method}`);
  }

  if (authMode === 'product') {
    const accessKey = String(process.env.ONENET_PRODUCT_ACCESS_KEY || process.env.ONENET_ACCESS_KEY || '').trim();
    if (!accessKey) {
      throw new Error('Missing ONENET_PRODUCT_ACCESS_KEY or ONENET_ACCESS_KEY env var');
    }
    if (!productId) {
      throw new Error('Missing productId for product auth mode');
    }
    return {
      authMode,
      version,
      method,
      ttlSeconds,
      accessKey,
      res: `products/${productId}`
    };
  }

  if (authMode === 'project') {
    const accessKey = String(process.env.ONENET_PROJECT_ACCESS_KEY || process.env.ONENET_ACCESS_KEY || '').trim();
    const projectId = String(process.env.ONENET_PROJECT_ID || '').trim();
    if (!accessKey) {
      throw new Error('Missing ONENET_PROJECT_ACCESS_KEY or ONENET_ACCESS_KEY env var');
    }
    if (!projectId) {
      throw new Error('Missing ONENET_PROJECT_ID env var');
    }
    return {
      authMode,
      version,
      method,
      ttlSeconds,
      accessKey,
      res: `projects/${projectId}`
    };
  }

  if (authMode === 'user') {
    const accessKey = String(process.env.ONENET_USER_ACCESS_KEY || process.env.ONENET_ACCESS_KEY || '').trim();
    const userId = String(process.env.ONENET_USER_ID || '').trim();
    if (!accessKey) {
      throw new Error('Missing ONENET_USER_ACCESS_KEY or ONENET_ACCESS_KEY env var');
    }
    if (!userId) {
      throw new Error('Missing ONENET_USER_ID env var');
    }
    return {
      authMode,
      version,
      method,
      ttlSeconds,
      accessKey,
      res: `userid/${userId}`
    };
  }

  throw new Error(`Unsupported ONENET_AUTH_MODE: ${authMode}`);
}

function generateOneNetAuth(productId) {
  const authConfig = resolveOneNetAuthConfig(productId);
  const et = Math.ceil(Date.now() / 1000) + authConfig.ttlSeconds;
  const StringForSignature = `${et}\n${authConfig.method}\n${authConfig.res}\n${authConfig.version}`;
  const keyBuf = Buffer.from(authConfig.accessKey, 'base64');
  const sign = encodeURIComponent(
    crypto.createHmac(authConfig.method, keyBuf).update(StringForSignature).digest('base64')
  );

  return {
    authorization: `version=${authConfig.version}&res=${encodeURIComponent(authConfig.res)}&et=${et}&method=${authConfig.method}&sign=${sign}`,
    authInfo: {
      mode: authConfig.authMode,
      method: authConfig.method,
      res: authConfig.res,
      et
    }
  };
}

/**
 * 调用 OneNET 物模型属性设置接口
 * POST https://iot-api.heclouds.com/thingmodel/set-device-property
 */
async function callOneNetSetProperty(productId, deviceName, params) {
  const body = JSON.stringify({ product_id: productId, device_name: deviceName, params });
  const authResult = generateOneNetAuth(productId);

  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request({
      hostname: 'iot-api.heclouds.com',
      path: '/thingmodel/set-device-property',
      method: 'POST',
      headers: {
        'Authorization': authResult.authorization,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('OneNET request timeout')));
    req.write(body);
    req.end();
  }).then((data) => ({
    ...data,
    _authInfo: authResult.authInfo
  }));
}

function resolveEmqxPublishUrl() {
  const raw = String(
    process.env.EMQX_PUBLISH_URL ||
    process.env.EMQX_PUBLISH_API_URL ||
    process.env.EMQX_PUBLISH_BASE_URL ||
    ''
  ).trim();

  if (!raw) {
    throw new Error('Missing EMQX publish url env var: EMQX_PUBLISH_URL or EMQX_PUBLISH_API_URL or EMQX_PUBLISH_BASE_URL');
  }

  const parsed = new URL(raw);
  const pathname = String(parsed.pathname || '').replace(/\/+$/g, '');
  if (!/\/publish$/i.test(pathname)) {
    parsed.pathname = `${pathname || ''}/publish`;
  } else {
    parsed.pathname = pathname;
  }
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  return parsed.toString().replace(/\/+$/g, '');
}

function buildEmqxCommandTopic(logicalKey, productId, deviceName) {
  const template = String(process.env.EMQX_COMMAND_TOPIC_TEMPLATE || 'down/${logicalKey}').trim();
  return renderTemplate(template, {
    logicalKey,
    productId,
    deviceName
  });
}

async function callEmqxPublishCommand({ topic, logicalKey, productId, deviceName, params }) {
  const publishUrl = new URL(resolveEmqxPublishUrl());
  const appId = String(process.env.EMQX_APP_ID || process.env.EMQX_PUBLISH_APP_ID || '').trim();
  const appSecret = String(process.env.EMQX_APP_SECRET || process.env.EMQX_PUBLISH_APP_SECRET || '').trim();

  if (!appId || !appSecret) {
    throw new Error('Missing EMQX_APP_ID / EMQX_APP_SECRET env vars');
  }

  const qos = Number.isFinite(Number(process.env.EMQX_COMMAND_QOS))
    ? Math.max(0, Number(process.env.EMQX_COMMAND_QOS))
    : 1;
  const retain = parseBooleanEnv(process.env.EMQX_COMMAND_RETAIN, false);
  const requestId = `cmd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const commandPayload = {
    ...params
  };
  const body = JSON.stringify({
    topic,
    payload: JSON.stringify(commandPayload),
    payload_encoding: 'plain',
    qos,
    retain
  });

  return new Promise((resolve, reject) => {
    const transport = publishUrl.protocol === 'http:' ? require('http') : require('https');
    const req = transport.request({
      protocol: publishUrl.protocol,
      hostname: publishUrl.hostname,
      port: publishUrl.port || undefined,
      path: `${publishUrl.pathname}${publishUrl.search || ''}`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          parsed = { raw: data };
        }
        resolve({
          httpStatus: res.statusCode,
          ...parsed,
          requestId,
          topic,
          payload: commandPayload
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('EMQX publish request timeout')));
    req.write(body);
    req.end();
  });
}

function resolveCommandParams(input) {
  if (input?.params && typeof input.params === 'object' && !Array.isArray(input.params)) {
    return { ok: true, params: input.params };
  }

  if (typeof input?.cmd === 'string' && input.cmd.trim()) {
    try {
      const parsed = JSON.parse(input.cmd.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, params: parsed };
      }
      return {
        ok: false,
        msg: 'cmd JSON must be an object, e.g. {"run_state": true}'
      };
    } catch (err) {
      return {
        ok: false,
        msg: 'Use params object or cmd JSON string, e.g. {"run_state": true}'
      };
    }
  }

  return {
    ok: false,
    msg: 'params must be an object, e.g. { "run_state": true }'
  };
}

function normalizeThingModelParams(params = {}) {
  const normalized = { ...params };
  const configuredFanKey = String(process.env.FAN_SWITCH_IDENTIFIER || 'test').trim() || 'test';
  const fanAliasKeys = ['fan_switch', 'fan_on', 'test'];

  const incomingFanKey = fanAliasKeys.find((key) => Object.prototype.hasOwnProperty.call(normalized, key));
  if (incomingFanKey) {
    const fanValue = normalized[incomingFanKey];
    fanAliasKeys.forEach((key) => {
      if (key !== configuredFanKey) {
        delete normalized[key];
      }
    });
    normalized[configuredFanKey] = fanValue;
  }

  return normalized;
}

async function resolveCommandProvider(db, logicalKey, preferredProvider = '') {
  const normalizedPreferred = normalizeProvider(preferredProvider);
  if (normalizedPreferred) {
    return normalizedPreferred;
  }

  if (!logicalKey) {
    return normalizeProvider(process.env.DEVICE_CMD_PROVIDER_DEFAULT || 'onenet') || 'onenet';
  }

  const [latestRows] = await db.execute(
    `SELECT push_meta_json
     FROM device_latest
     WHERE logical_key = ?
     ORDER BY updated_at_ms DESC, id DESC
     LIMIT 1`,
    [logicalKey]
  );

  const latestMeta = latestRows.length ? parseJsonField(latestRows[0].push_meta_json, {}) : {};
  const providerFromLatest =
    normalizeProvider(latestMeta?.provider) ||
    normalizeProvider(latestMeta?.sourceMeta?.provider) ||
    normalizeProvider(latestMeta?.source_meta?.provider) ||
    '';

  if (providerFromLatest) {
    return providerFromLatest;
  }

  return normalizeProvider(process.env.DEVICE_CMD_PROVIDER_DEFAULT || 'onenet') || 'onenet';
}

async function insertDeviceCommand(db, payload) {
  await db.execute(
    `INSERT INTO device_commands
      (command_id, logical_key, product_id, device_name, provider, openid, command_name, status, sent_params_json, latest_snapshot_json, requested_at_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.commandId,
      payload.logicalKey,
      payload.productId,
      payload.deviceName,
      payload.provider || '',
      payload.openid || null,
      payload.commandName || 'set_property',
      payload.status || 'pending',
      JSON.stringify(payload.sentParams || {}),
      JSON.stringify(payload.latestSnapshot || {}),
      payload.requestedAtMs,
      toSqlDateTime(payload.requestedAtMs),
      toSqlDateTime(payload.requestedAtMs)
    ]
  );
}

async function updateDeviceCommand(db, commandId, patch = {}) {
  const fields = [];
  const values = [];

  if (patch.provider !== undefined) {
    fields.push('provider = ?');
    values.push(patch.provider || '');
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(patch.errorMessage || null);
  }
  if (patch.providerResponse !== undefined) {
    fields.push('provider_response_json = ?');
    values.push(JSON.stringify(patch.providerResponse || {}));
  }
  if (patch.sentAtMs !== undefined) {
    fields.push('sent_at_ms = ?');
    values.push(patch.sentAtMs || null);
  }
  if (patch.ackedAtMs !== undefined) {
    fields.push('acked_at_ms = ?');
    values.push(patch.ackedAtMs || null);
  }
  if (patch.doneAtMs !== undefined) {
    fields.push('done_at_ms = ?');
    values.push(patch.doneAtMs || null);
  }
  if (patch.failedAtMs !== undefined) {
    fields.push('failed_at_ms = ?');
    values.push(patch.failedAtMs || null);
  }
  if (patch.latestSnapshot !== undefined) {
    fields.push('latest_snapshot_json = ?');
    values.push(JSON.stringify(patch.latestSnapshot || {}));
  }

  fields.push('updated_at = ?');
  values.push(toSqlDateTime(Date.now()));
  values.push(commandId);

  await db.execute(
    `UPDATE device_commands
     SET ${fields.join(', ')}
     WHERE command_id = ?`,
    values
  );
}

async function getLatestCommandStateMap(db, logicalKeys = []) {
  if (!Array.isArray(logicalKeys) || !logicalKeys.length) {
    return {};
  }

  const placeholders = logicalKeys.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT command_id, logical_key, provider, command_name, status, sent_params_json, error_message,
            requested_at_ms, sent_at_ms, acked_at_ms, done_at_ms, failed_at_ms
     FROM device_commands
     WHERE logical_key IN (${placeholders})
     ORDER BY requested_at_ms DESC, id DESC`,
    logicalKeys
  );

  return rows.reduce((acc, row) => {
    if (acc[row.logical_key]) {
      return acc;
    }
    acc[row.logical_key] = {
      commandId: row.command_id,
      provider: row.provider || '',
      commandName: row.command_name || 'set_property',
      status: row.status || 'pending',
      sentParams: parseJsonField(row.sent_params_json, {}),
      errorMessage: row.error_message || '',
      requestedAt: row.requested_at_ms || null,
      sentAt: row.sent_at_ms || null,
      ackedAt: row.acked_at_ms || null,
      doneAt: row.done_at_ms || null,
      failedAt: row.failed_at_ms || null
    };
    return acc;
  }, {});
}

async function queryCommandsByUserLocal(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const limit = Math.min(Math.max(Number(input?.limit) || 20, 1), 100);
  const aclRows = await getActiveAclRows(db, openid, logicalKey);

  if (!aclRows.length) {
    return {
      success: true,
      commands: []
    };
  }

  const logicalKeys = [...new Set(aclRows.map((item) => item.logical_key).filter(Boolean))];
  const placeholders = logicalKeys.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT command_id, logical_key, product_id, device_name, provider, command_name, status,
            sent_params_json, latest_snapshot_json, error_message, provider_response_json,
            requested_at_ms, sent_at_ms, acked_at_ms, done_at_ms, failed_at_ms
     FROM device_commands
     WHERE logical_key IN (${placeholders})
     ORDER BY requested_at_ms DESC, id DESC
     LIMIT ?`,
    [...logicalKeys, limit]
  );

  const aclMap = aclRows.reduce((acc, row) => {
    acc[row.logical_key] = row;
    return acc;
  }, {});
  const commandCacheEntries = await Promise.all(
    rows.map(async (row) => ({
      commandId: row.command_id,
      cacheState: await runtimeCache.getCommandState(row.command_id)
    }))
  );
  const commandCacheMap = commandCacheEntries.reduce((acc, item) => {
    acc[item.commandId] = item.cacheState;
    return acc;
  }, {});
  const cacheSummary = summarizeCommandCacheUsage(rows.map((row) => row.command_id), commandCacheMap);

  logInfo('device_commands_cache_summary', {
    logicalKey: logicalKey || '',
    cacheSummary
  });

  return {
    success: true,
    commands: rows.map((row) => {
      const mapped = {
        commandId: row.command_id,
      logicalKey: row.logical_key,
      alias: aclMap[row.logical_key]?.alias || row.device_name || row.logical_key,
      productId: row.product_id || '',
      deviceName: row.device_name || '',
      provider: row.provider || '',
      commandName: row.command_name || 'set_property',
      status: row.status || 'pending',
      sentParams: parseJsonField(row.sent_params_json, {}),
      latestSnapshot: parseJsonField(row.latest_snapshot_json, {}),
      errorMessage: row.error_message || '',
      providerResponse: parseJsonField(row.provider_response_json, {}),
      requestedAt: row.requested_at_ms || null,
      sentAt: row.sent_at_ms || null,
      ackedAt: row.acked_at_ms || null,
      doneAt: row.done_at_ms || null,
      failedAt: row.failed_at_ms || null
      };
      return mergeCommandRowWithCache(mapped, commandCacheMap[row.command_id] || null);
    }),
    cacheMeta: cacheSummary
  };
}

async function queryCommandsByUserViaRuntimeService(db, openid, input, sourceHeaders = {}) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const limit = Math.min(Math.max(Number(input?.limit) || 20, 1), 100);
  const aclRows = await getActiveAclRows(db, openid, logicalKey);

  if (!aclRows.length) {
    return {
      success: true,
      commands: []
    };
  }

  const aclMap = aclRows.reduce((acc, row) => {
    acc[row.logical_key] = row;
    return acc;
  }, {});
  const runtimeResponse = await requestRuntimeService(
    '/runtime/device/commands',
    {
      logicalKey: logicalKey || aclRows[0].logical_key,
      limit
    },
    sourceHeaders,
    openid
  );

  return {
    success: runtimeResponse?.success !== false,
    commands: Array.isArray(runtimeResponse?.commands)
      ? runtimeResponse.commands.map((command) => ({
        ...command,
        alias: aclMap[command.logicalKey]?.alias || command.deviceName || command.logicalKey
      }))
      : [],
    cacheMeta: {
      proxy: true,
      route: '/runtime/device/commands',
      source: runtimeResponse?.cacheMeta?.source || 'runtime-service'
    }
  };
}

async function queryCommandsByUser(db, openid, input, sourceHeaders = {}) {
  if (shouldProxyRuntimeRoute('/device/commands')) {
    try {
      return await queryCommandsByUserViaRuntimeService(db, openid, input, sourceHeaders);
    } catch (err) {
      logError('runtime_proxy_failed', {
        route: '/device/commands',
        message: err.message,
        statusCode: err.statusCode || null
      });
    }
  }

  return queryCommandsByUserLocal(db, openid, input);
}

async function getCommandRowForUser(db, openid, commandId) {
  const normalizedCommandId = typeof commandId === 'string' ? commandId.trim() : '';
  if (!normalizedCommandId) {
    return null;
  }

  const [rows] = await db.execute(
    `SELECT dc.command_id, dc.logical_key, dc.product_id, dc.device_name, dc.provider, dc.command_name, dc.status,
            dc.sent_params_json, dc.latest_snapshot_json, dc.error_message, dc.provider_response_json,
            dc.requested_at_ms, dc.sent_at_ms, dc.acked_at_ms, dc.done_at_ms, dc.failed_at_ms,
            acl.alias
     FROM device_commands dc
     INNER JOIN device_acl acl
       ON acl.logical_key = dc.logical_key
      AND acl.openid = ?
      AND acl.status = 'active'
     WHERE dc.command_id = ?
     ORDER BY dc.id DESC
     LIMIT 1`,
    [openid, normalizedCommandId]
  );

  return rows[0] || null;
}

function mapCommandRow(row = {}) {
  return {
    commandId: row.command_id,
    logicalKey: row.logical_key,
    alias: row.alias || row.device_name || row.logical_key,
    productId: row.product_id || '',
    deviceName: row.device_name || '',
    provider: row.provider || '',
    commandName: row.command_name || 'set_property',
    status: row.status || 'pending',
    sentParams: parseJsonField(row.sent_params_json, {}),
    latestSnapshot: parseJsonField(row.latest_snapshot_json, {}),
    errorMessage: row.error_message || '',
    providerResponse: parseJsonField(row.provider_response_json, {}),
    requestedAt: row.requested_at_ms || null,
    sentAt: row.sent_at_ms || null,
    ackedAt: row.acked_at_ms || null,
    doneAt: row.done_at_ms || null,
    failedAt: row.failed_at_ms || null
  };
}

async function queryCommandDetailForUserLocal(db, openid, input) {
  const row = await getCommandRowForUser(db, openid, input?.commandId);
  if (!row) {
    return {
      success: false,
      msg: 'Command not found'
    };
  }

  const cacheState = await runtimeCache.getCommandState(row.command_id);
  logInfo('device_command_detail_cache_summary', {
    commandId: row.command_id,
    cacheSummary: {
      requested: 1,
      hits: cacheState ? 1 : 0,
      misses: cacheState ? 0 : 1
    }
  });

  return {
    success: true,
    command: mergeCommandRowWithCache(
      mapCommandRow(row),
      cacheState
    ),
    cacheMeta: {
      requested: 1,
      hits: cacheState ? 1 : 0,
      misses: cacheState ? 0 : 1
    }
  };
}

async function queryCommandDetailForUserViaRuntimeService(db, openid, input, sourceHeaders = {}) {
  const row = await getCommandRowForUser(db, openid, input?.commandId);
  if (!row) {
    return {
      success: false,
      msg: 'Command not found'
    };
  }

  const runtimeResponse = await requestRuntimeService(
    '/runtime/device/command/detail',
    {
      commandId: row.command_id
    },
    sourceHeaders,
    openid
  );

  return {
    success: runtimeResponse?.success !== false,
    command: runtimeResponse?.command
      ? {
        ...runtimeResponse.command,
        alias: row.alias || runtimeResponse.command.deviceName || runtimeResponse.command.logicalKey
      }
      : null,
    cacheMeta: {
      proxy: true,
      route: '/runtime/device/command/detail',
      ...(runtimeResponse?.cacheMeta || {})
    }
  };
}

async function queryCommandDetailForUser(db, openid, input, sourceHeaders = {}) {
  if (shouldProxyRuntimeRoute('/device/command/detail')) {
    try {
      return await queryCommandDetailForUserViaRuntimeService(db, openid, input, sourceHeaders);
    } catch (err) {
      logError('runtime_proxy_failed', {
        route: '/device/command/detail',
        message: err.message,
        statusCode: err.statusCode || null
      });
    }
  }

  return queryCommandDetailForUserLocal(db, openid, input);
}

async function retryCommandForUser(db, openid, input) {
  const row = await getCommandRowForUser(db, openid, input?.commandId);
  if (!row) {
    return {
      success: false,
      msg: 'Command not found'
    };
  }

  const retryPayload = {
    logicalKey: row.logical_key,
    params: parseJsonField(row.sent_params_json, {}),
    provider: row.provider || ''
  };

  const retryResult = await sendDeviceCmdForUser(db, openid, retryPayload);
  return {
    ...retryResult,
    retriedFromCommandId: row.command_id
  };
}

async function sendDeviceCmdForUserLocal(db, openid, input) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const resolved = resolveCommandParams(input);

  if (!logicalKey) {
    return { success: false, msg: '设备标识缺失' };
  }
  if (!resolved.ok) {
    return { success: false, msg: resolved.msg };
  }
  const params = normalizeThingModelParams(resolved.params);

  // ACL 权限校验
  const [aclRows] = await db.execute(
    `SELECT id FROM device_acl WHERE openid = ? AND logical_key = ? AND status = 'active' LIMIT 1`,
    [openid, logicalKey]
  );
  if (!aclRows.length) {
    return { success: false, msg: 'Permission denied for this device' };
  }

  // 查 productId / deviceName
  const [deviceRows] = await db.execute(
    `SELECT product_id, device_name FROM devices WHERE logical_key = ? LIMIT 1`,
    [logicalKey]
  );
  if (!deviceRows.length) {
    return { success: false, msg: 'Device not found' };
  }

  const { product_id: productId, device_name: deviceName } = deviceRows[0];
  if (!productId || !deviceName) {
    return { success: false, msg: 'Device missing productId or deviceName' };
  }

  const [latestRows] = await db.execute(
    `SELECT params_json
     FROM device_latest
     WHERE logical_key = ?
     LIMIT 1`,
    [logicalKey]
  );
  const latestSnapshot = latestRows.length ? parseJsonField(latestRows[0].params_json, {}) : {};
  const provider = await resolveCommandProvider(db, logicalKey, input?.provider || input?.transport || '');
  const requestedAtMs = Date.now();
  const commandId = buildCommandId(logicalKey);

  await insertDeviceCommand(db, {
    commandId,
    logicalKey,
    productId,
    deviceName,
    provider,
    openid,
    sentParams: params,
    latestSnapshot,
    requestedAtMs,
    status: 'pending'
  });

  logInfo('device_command_queued', {
    commandId,
    logicalKey,
    productId,
    deviceName,
    provider,
    paramKeys: Object.keys(params || {})
  });
  await runtimeCache.setCommandProcessing({
    commandId,
    logicalKey,
    provider,
    status: 'pending',
    productId,
    deviceName
  });
  await runtimeCache.setCommandState({
    commandId,
    logicalKey,
    provider,
    status: 'pending',
    productId,
    deviceName,
    requestedAt: requestedAtMs,
    sentParams: params,
    latestSnapshot
  });

  if (provider === 'emqx') {
    const topic = buildEmqxCommandTopic(logicalKey, productId, deviceName);
    const emqxResp = await callEmqxPublishCommand({
      topic,
      logicalKey,
      productId,
      deviceName,
      params
    });

    if (Number(emqxResp.httpStatus) < 200 || Number(emqxResp.httpStatus) >= 300) {
      await updateDeviceCommand(db, commandId, {
        provider,
        status: 'failed',
        errorMessage: emqxResp.message || emqxResp.msg || 'EMQX publish error',
        providerResponse: emqxResp,
        failedAtMs: Date.now()
      });
      logInfo('device_command_failed', {
        commandId,
        logicalKey,
        provider,
        reason: emqxResp.message || emqxResp.msg || 'EMQX publish error',
        httpStatus: emqxResp.httpStatus || null
      });
      await runtimeCache.setCommandState({
        commandId,
        logicalKey,
        provider,
        status: 'failed',
        productId,
        deviceName,
        errorMessage: emqxResp.message || emqxResp.msg || 'EMQX publish error',
        failedAt: Date.now(),
        sentParams: params
      });
      await runtimeCache.clearCommandProcessing(commandId);
      return {
        success: false,
        commandId,
        commandStatus: 'failed',
        provider,
        msg: emqxResp.message || emqxResp.msg || 'EMQX publish error',
        logicalKey,
        productId,
        deviceName,
        commandTopic: topic,
        sentParams: params,
        emqxResp
      };
    }

    await updateDeviceCommand(db, commandId, {
      provider,
      status: 'sent',
      providerResponse: emqxResp,
      sentAtMs: Date.now()
    });

    logInfo('device_command_sent', {
      commandId,
      logicalKey,
      provider,
      commandTopic: topic,
      httpStatus: emqxResp.httpStatus || null
    });
    await runtimeCache.setCommandProcessing({
      commandId,
      logicalKey,
      provider,
      status: 'sent',
      productId,
      deviceName,
      commandTopic: topic
    });
    await runtimeCache.setCommandState({
      commandId,
      logicalKey,
      provider,
      status: 'sent',
      productId,
      deviceName,
      commandTopic: topic,
      sentAt: Date.now(),
      sentParams: params
    });

    return {
      success: true,
      commandId,
      commandStatus: 'sent',
      provider,
      logicalKey,
      productId,
      deviceName,
      commandTopic: topic,
      sentParams: params,
      emqxResp
    };
  }

  const oneNetResp = await callOneNetSetProperty(productId, deviceName, params);

  if (oneNetResp.code !== 0) {
    await updateDeviceCommand(db, commandId, {
      provider: 'onenet',
      status: 'failed',
      errorMessage: oneNetResp.msg || 'OneNET error',
      providerResponse: oneNetResp,
      failedAtMs: Date.now()
    });
    logInfo('device_command_failed', {
      commandId,
      logicalKey,
      provider: 'onenet',
      reason: oneNetResp.msg || 'OneNET error',
      providerCode: oneNetResp.code
    });
    await runtimeCache.setCommandState({
      commandId,
      logicalKey,
      provider: 'onenet',
      status: 'failed',
      productId,
      deviceName,
      errorMessage: oneNetResp.msg || 'OneNET error',
      failedAt: Date.now(),
      sentParams: params
    });
    await runtimeCache.clearCommandProcessing(commandId);
    return {
      success: false,
      commandId,
      commandStatus: 'failed',
      provider: 'onenet',
      msg: oneNetResp.msg || 'OneNET error',
      logicalKey,
      productId,
      deviceName,
      sentParams: params,
      authInfo: oneNetResp._authInfo || null,
      oneNetResp
    };
  }

  await updateDeviceCommand(db, commandId, {
    provider: 'onenet',
    status: 'sent',
    providerResponse: oneNetResp,
    sentAtMs: Date.now()
  });

  logInfo('device_command_sent', {
    commandId,
    logicalKey,
    provider: 'onenet',
    providerCode: oneNetResp.code
  });
  await runtimeCache.setCommandProcessing({
    commandId,
    logicalKey,
    provider: 'onenet',
    status: 'sent',
    productId,
    deviceName
  });
  await runtimeCache.setCommandState({
    commandId,
    logicalKey,
    provider: 'onenet',
    status: 'sent',
    productId,
    deviceName,
    sentAt: Date.now(),
    sentParams: params
  });

  return {
    success: true,
    commandId,
    commandStatus: 'sent',
    provider: 'onenet',
    logicalKey,
    productId,
    deviceName,
    sentParams: params,
    authInfo: oneNetResp._authInfo || null,
    oneNetResp
  };
}

async function sendDeviceCmdForUserViaRuntimeService(db, openid, input, sourceHeaders = {}) {
  const logicalKey = normalizeLogicalKey(input?.logicalKey);
  const resolved = resolveCommandParams(input);

  if (!logicalKey) {
    return { success: false, msg: '璁惧鏍囪瘑缂哄け' };
  }
  if (!resolved.ok) {
    return { success: false, msg: resolved.msg };
  }

  const params = normalizeThingModelParams(resolved.params);
  const [aclRows] = await db.execute(
    `SELECT id FROM device_acl WHERE openid = ? AND logical_key = ? AND status = 'active' LIMIT 1`,
    [openid, logicalKey]
  );
  if (!aclRows.length) {
    return { success: false, msg: 'Permission denied for this device' };
  }

  const [deviceRows] = await db.execute(
    `SELECT product_id, device_name FROM devices WHERE logical_key = ? LIMIT 1`,
    [logicalKey]
  );
  if (!deviceRows.length) {
    return { success: false, msg: 'Device not found' };
  }

  const provider = await resolveCommandProvider(db, logicalKey, input?.provider || input?.transport || '');
  const { product_id: productId, device_name: deviceName } = deviceRows[0];
  return requestRuntimeService(
    '/runtime/device/command/send',
    {
      logicalKey,
      provider,
      productId,
      deviceName,
      params,
      requestId: input?.requestId || null
    },
    sourceHeaders,
    openid
  );
}

async function sendDeviceCmdForUser(db, openid, input, sourceHeaders = {}) {
  if (shouldProxyRuntimeRoute('/device/cmd')) {
    try {
      return await sendDeviceCmdForUserViaRuntimeService(db, openid, input, sourceHeaders);
    } catch (err) {
      logError('runtime_proxy_failed', {
        route: '/device/cmd',
        message: err.message,
        statusCode: err.statusCode || null
      });
    }
  }

  return sendDeviceCmdForUserLocal(db, openid, input);
}

exports.main = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const headers = getHeaders(event);
  const body = getBody(event);

  try {
    const db = await getDb();

    if (method === 'GET' && path.endsWith('/health')) {
      return json(200, await healthCheck(db));
    }

    const openid = resolveOpenid(event, body);

    if (method === 'POST' && path.endsWith('/device/latest')) {
      return json(200, await queryLatestByUser(db, openid, body, headers));
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
      return json(200, await sendDeviceCmdForUser(db, openid, body, headers));
    }

    if (method === 'POST' && path.endsWith('/device/commands')) {
      return json(200, await queryCommandsByUser(db, openid, body, headers));
    }

    if (method === 'POST' && path.endsWith('/device/command/detail')) {
      return json(200, await queryCommandDetailForUser(db, openid, body, headers));
    }

    if (method === 'POST' && path.endsWith('/device/command/retry')) {
      return json(200, await retryCommandForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/todo/list')) {
      return json(200, await listTodosForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/todo/global')) {
      return json(200, await listGlobalTodosForUser(db, openid));
    }

    if (method === 'POST' && path.endsWith('/todo/add')) {
      return json(200, await addTodoForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/todo/complete')) {
      return json(200, await completeTodoForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/todo/toggle-urgent')) {
      return json(200, await toggleTodoUrgencyForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/journal/month')) {
      return json(200, await listJournalMonthForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/journal/day')) {
      return json(200, await listJournalDayForUser(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/journal/add')) {
      return json(200, await addJournalRecordForUser(db, openid, body));
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
        msg: '接口不存在'
      });
  } catch (err) {
    logError('request_failed', {
      message: err.message,
      stack: err.stack,
      path,
      method
    });
    return json(500, {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.__test__ = {
  deriveDeviceOnlineState,
  getDeviceOfflineThresholdMs,
  buildLatestAggregates,
  mergeLatestRowWithCache,
  mergeCommandRowWithCache,
  summarizeLatestCacheUsage,
  summarizeCommandCacheUsage,
  parseCommaList,
  getRuntimeServiceProxyConfig,
  shouldProxyRuntimeRoute,
  buildRuntimeServiceHeaders,
  buildRuntimeServiceUrl
};

exports.main_handler = exports.main;
