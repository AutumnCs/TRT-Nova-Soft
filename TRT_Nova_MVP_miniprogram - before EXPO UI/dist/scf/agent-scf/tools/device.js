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

async function getDeviceSnapshot(db, openid, logicalKey) {
  const aclRows = await getActiveAclRows(db, openid, logicalKey);
  if (!aclRows.length) return null;

  const acl = aclRows[0];
  const [latestRows] = await db.execute(
    `SELECT logical_key, product_id, device_name, updated_at_ms, params_json
     FROM device_latest
     WHERE logical_key = ?
     LIMIT 1`,
    [logicalKey]
  );

  const [deviceRows] = await db.execute(
    `SELECT logical_key, product_id, device_name, status
     FROM devices
     WHERE logical_key = ?
     LIMIT 1`,
    [logicalKey]
  );

  const latest = latestRows[0] || {};
  const device = deviceRows[0] || {};

  return {
    logicalKey,
    alias: acl.alias || device.device_name || '未命名设备',
    location: acl.location || '',
    plantType: acl.plant_type || '',
    plantLibraryId: acl.plant_library_id || null,
    productId: latest.product_id || device.product_id || '',
    deviceName: latest.device_name || device.device_name || '',
    updatedAt: latest.updated_at_ms || null,
    hasLatest: !!latestRows.length,
    params: parseJsonField(latest.params_json, {})
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

async function getHistorySummary(db, logicalKey, paramKey, range = '24h', granularity = '5m', limit = 288) {
  const startMs = getRangeStartMs(range);
  const [rows] = await db.execute(
    `SELECT bucket_start_ms, min_value, max_value, avg_value, sample_count
     FROM device_history_agg
     WHERE logical_key = ? AND granularity = ? AND param_key = ? AND bucket_start_ms >= ?
     ORDER BY bucket_start_ms ASC
     LIMIT ?`,
    [logicalKey, granularity, paramKey, startMs, limit]
  );

  const points = rows
    .map((row) => ({
      bucketStart: row.bucket_start_ms,
      avg: row.avg_value === null ? null : Number(row.avg_value)
    }))
    .filter((item) => Number.isFinite(item.avg));

  if (!points.length) {
    return {
      trend: 'unknown',
      min: null,
      max: null,
      avg: null,
      pointCount: 0
    };
  }

  const values = points.map((item) => item.avg);
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const trend = diff > 1 ? 'up' : diff < -1 ? 'down' : 'stable';
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    trend,
    min: Math.min(...values),
    max: Math.max(...values),
    avg,
    pointCount: values.length
  };
}

module.exports = {
  getActiveAclRows,
  getDeviceSnapshot,
  getHistorySummary
};
