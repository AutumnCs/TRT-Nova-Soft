let pool;

async function getDb() {
  if (pool) return pool;

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

module.exports = {
  getDb
};
