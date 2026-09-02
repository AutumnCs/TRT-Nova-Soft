let pool;

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
    raw: Math.max(1, Number(process.env.RAW_RETENTION_DAYS) || 7),
    agg5m: Math.max(1, Number(process.env.AGG_5M_RETENTION_DAYS) || 7),
    agg1h: Math.max(1, Number(process.env.AGG_1H_RETENTION_DAYS) || 30),
    agg1d: Math.max(1, Number(process.env.AGG_1D_RETENTION_DAYS) || 365)
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

async function deleteAggHistory(db, granularity, days) {
  const [result] = await db.execute(
    `DELETE FROM device_history_agg
     WHERE granularity = ?
       AND bucket_start_ms < UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL ? DAY)) * 1000`,
    [granularity, days]
  );
  return result.affectedRows || 0;
}

exports.main = async () => {
  try {
    const db = await getDb();
    const retention = getRetentionDays();

    const rawDeleted = await deleteRawHistory(db, retention.raw);
    const agg5mDeleted = await deleteAggHistory(db, '5m', retention.agg5m);
    const agg1hDeleted = await deleteAggHistory(db, '1h', retention.agg1h);
    const agg1dDeleted = await deleteAggHistory(db, '1d', retention.agg1d);

    return toJson(200, {
      success: true,
      service: 'history-cleanup-scf',
      retentionDays: retention,
      deleted: {
        device_history_raw: rawDeleted,
        device_history_agg_5m: agg5mDeleted,
        device_history_agg_1h: agg1hDeleted,
        device_history_agg_1d: agg1dDeleted
      },
      cleanedAt: Date.now()
    });
  } catch (err) {
    console.error('history-cleanup-scf error:', {
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
