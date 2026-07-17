let pool;

function logInfo(event, payload = {}) {
  console.log(JSON.stringify({
    level: 'info',
    service: 'history-cleanup-scf',
    event,
    ts: Date.now(),
    ...payload
  }));
}

function logError(event, payload = {}) {
  console.error(JSON.stringify({
    level: 'error',
    service: 'history-cleanup-scf',
    event,
    ts: Date.now(),
    ...payload
  }));
}

function toJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
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

function getRetentionDays() {
  return {
    ingest: Math.max(1, Number(process.env.INGEST_RETENTION_DAYS) || 30),
    raw: Math.max(1, Number(process.env.RAW_RETENTION_DAYS) || 7),
    agg5m: Math.max(1, Number(process.env.AGG_5M_RETENTION_DAYS) || 7),
    agg1h: Math.max(1, Number(process.env.AGG_1H_RETENTION_DAYS) || 30),
    agg1d: Math.max(1, Number(process.env.AGG_1D_RETENTION_DAYS) || 365)
  };
}

function getCommandTimeoutMinutes() {
  return Math.max(1, Number(process.env.COMMAND_TIMEOUT_MINUTES) || 5);
}

function getInspectionConfig() {
  const commandTimeoutMinutes = getCommandTimeoutMinutes();
  const offlineMinutes = Math.max(1, Number(process.env.ALERT_OFFLINE_MINUTES) || 30);
  const commandLagMinutes = Math.max(
    1,
    Number(process.env.ALERT_COMMAND_LAG_MINUTES) || Math.max(1, commandTimeoutMinutes - 1)
  );

  return {
    offlineMinutes,
    commandLagMinutes
  };
}

async function deleteRawHistory(db, days) {
  const [result] = await db.execute(
    `DELETE FROM device_history_raw
     WHERE sample_time_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? DAY)) * 1000`,
    [days]
  );
  return result.affectedRows || 0;
}

async function deleteMessageIngest(db, days) {
  const [result] = await db.execute(
    `DELETE FROM device_message_ingest
     WHERE message_timestamp_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? DAY)) * 1000`,
    [days]
  );
  return result.affectedRows || 0;
}

async function deleteAggHistory(db, granularity, days) {
  const [result] = await db.execute(
    `DELETE FROM device_history_agg
     WHERE granularity = ?
       AND bucket_start_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? DAY)) * 1000`,
    [granularity, days]
  );
  return result.affectedRows || 0;
}

async function failTimedOutCommands(db, timeoutMinutes) {
  const [result] = await db.execute(
    `UPDATE device_commands
     SET status = 'failed',
         error_message = CASE
           WHEN error_message IS NULL OR error_message = '' THEN 'Command timed out without ACK'
           ELSE error_message
         END,
         failed_at_ms = CASE
           WHEN failed_at_ms IS NULL THEN UNIX_TIMESTAMP(NOW()) * 1000
           ELSE failed_at_ms
         END,
         updated_at = NOW()
     WHERE status IN ('pending', 'sent', 'acked')
       AND requested_at_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? MINUTE)) * 1000`,
    [timeoutMinutes]
  );
  return result.affectedRows || 0;
}

async function inspectOfflineDevices(db, offlineMinutes) {
  const [rows] = await db.execute(
    `SELECT dl.logical_key, dl.product_id, dl.device_name, dl.updated_at_ms,
            MAX(acl.alias) AS alias
     FROM device_latest dl
     INNER JOIN device_acl acl
       ON acl.logical_key = dl.logical_key
      AND acl.status = 'active'
     WHERE dl.updated_at_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? MINUTE)) * 1000
     GROUP BY dl.logical_key, dl.product_id, dl.device_name, dl.updated_at_ms
     ORDER BY dl.updated_at_ms ASC
     LIMIT 20`,
    [offlineMinutes]
  );

  return {
    count: rows.length,
    sample: rows.map((row) => ({
      logicalKey: row.logical_key,
      alias: row.alias || row.device_name || row.logical_key,
      productId: row.product_id || '',
      deviceName: row.device_name || '',
      lastSeenAt: row.updated_at_ms || null
    }))
  };
}

async function inspectLaggingCommands(db, lagMinutes) {
  const [rows] = await db.execute(
    `SELECT command_id, logical_key, provider, status, requested_at_ms
     FROM device_commands
     WHERE status IN ('pending', 'sent', 'acked')
       AND requested_at_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? MINUTE)) * 1000
     ORDER BY requested_at_ms ASC
     LIMIT 20`,
    [lagMinutes]
  );

  return {
    count: rows.length,
    sample: rows.map((row) => ({
      commandId: row.command_id,
      logicalKey: row.logical_key,
      provider: row.provider || '',
      status: row.status || 'pending',
      requestedAt: row.requested_at_ms || null
    }))
  };
}

exports.main = async () => {
  try {
    const db = await getDb();
    const retention = getRetentionDays();
    const commandTimeoutMinutes = getCommandTimeoutMinutes();
    const inspection = getInspectionConfig();

    const timedOutCommands = await failTimedOutCommands(db, commandTimeoutMinutes);
    const ingestDeleted = await deleteMessageIngest(db, retention.ingest);
    const rawDeleted = await deleteRawHistory(db, retention.raw);
    const agg5mDeleted = await deleteAggHistory(db, '5m', retention.agg5m);
    const agg1hDeleted = await deleteAggHistory(db, '1h', retention.agg1h);
    const agg1dDeleted = await deleteAggHistory(db, '1d', retention.agg1d);
    const offlineDevices = await inspectOfflineDevices(db, inspection.offlineMinutes);
    const laggingCommands = await inspectLaggingCommands(db, inspection.commandLagMinutes);

    if (offlineDevices.count > 0 || laggingCommands.count > 0) {
      logInfo('cleanup_alerts_detected', {
        inspection,
        alerts: {
          offlineDevices,
          laggingCommands
        }
      });
    }

    logInfo('cleanup_completed', {
      retentionDays: retention,
      commandTimeoutMinutes,
      inspection,
      deleted: {
        timedOutCommands,
        ingestDeleted,
        rawDeleted,
        agg5mDeleted,
        agg1hDeleted,
        agg1dDeleted
      },
      alerts: {
        offlineDevicesCount: offlineDevices.count,
        laggingCommandsCount: laggingCommands.count
      }
    });

    return toJson(200, {
      success: true,
      service: 'history-cleanup-scf',
      retentionDays: retention,
      commandTimeoutMinutes,
      inspection,
      deleted: {
        timed_out_device_commands: timedOutCommands,
        device_message_ingest: ingestDeleted,
        device_history_raw: rawDeleted,
        device_history_agg_5m: agg5mDeleted,
        device_history_agg_1h: agg1hDeleted,
        device_history_agg_1d: agg1dDeleted
      },
      alerts: {
        offlineDevices,
        laggingCommands
      },
      cleanedAt: Date.now()
    });
  } catch (err) {
    logError('cleanup_failed', {
      message: err.message,
      stack: err.stack
    });

    return toJson(500, {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.main_handler = exports.main;
exports.__test__ = {
  getRetentionDays,
  getCommandTimeoutMinutes,
  getInspectionConfig,
  failTimedOutCommands,
  inspectOfflineDevices,
  inspectLaggingCommands
};
