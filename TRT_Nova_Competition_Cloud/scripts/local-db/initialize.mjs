import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { projectRoot, readLocalEnvironment, validateLocalSettings, argumentsByName } from '../local-env.mjs';
import { bootstrapFiles, splitSql } from '../../deployment/cloud-initial/tools/migrate-database.mjs';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');
const { normalizeArticle, normalizePlant, importContent } = require('../import-knowledge-articles.js');
export function requiredTables(root = projectRoot) {
  const names = bootstrapFiles.flatMap(file => splitSql(fs.readFileSync(path.join(root, file), 'utf8'))
    .flatMap(statement => {
      const match = /^CREATE TABLE (?:IF NOT EXISTS )?([a-zA-Z0-9_]+)/i.exec(statement);
      return match ? [match[1]] : [];
    }));
  return [...new Set(names)];
}
export async function verifyLocalDatabase(db, root = projectRoot) {
  const [rows] = await db.execute('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const found = new Set(rows.map(row => row.name));
  const missing = requiredTables(root).filter(name => !found.has(name));
  if (missing.length) throw new Error('LOCAL_SCHEMA_INCOMPLETE:' + missing.join(','));
  for (const [table, column] of [['users','avatar_file_id'],['todos','plant_pet_id'],['ai_context_memory','summary_text']]) {
    const [columns] = await db.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table,column]);
    if (columns.length !== 1) throw new Error('LOCAL_SCHEMA_INCOMPLETE:' + table + '.' + column);
  }
  return { tables: found.size };
}
export async function initializeLocalDatabase(env, options = {}) {
  validateLocalSettings(env);
  if (!options.verify && options['confirm-database'] !== env.DB_NAME) throw new Error('EXACT_LOCAL_DATABASE_CONFIRMATION_REQUIRED');
  const connection = { host: env.DB_HOST, port: Number(env.DB_PORT), charset: 'utf8mb4' };
  if (options.verify) {
    const db = await mysql.createConnection({ ...connection, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
    try { return { status: 'VERIFIED', database: env.DB_NAME, ...await verifyLocalDatabase(db) }; }
    finally { await db.end(); }
  }
  const admin = await mysql.createConnection({ ...connection, user: process.env.NOVA_LOCAL_ADMIN_USER || 'root',
    password: process.env.NOVA_LOCAL_ADMIN_PASSWORD || '' });
  try {
    const [[existing]] = await admin.execute('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [env.DB_NAME]);
    if (Number(existing.n) > 0) throw new Error('LOCAL_DATABASE_NOT_EMPTY_NO_OVERWRITE');
    const [accounts] = await admin.execute("SELECT User FROM mysql.user WHERE User = ? AND Host IN ('localhost','127.0.0.1')", [env.DB_USER]);
    if (accounts.length) {
      // An existing account must accept this local configuration. Never change its password.
      const check = await mysql.createConnection({ ...connection, user: env.DB_USER, password: env.DB_PASSWORD });
      await check.end();
    }
    await admin.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [env.DB_NAME]);
    for (const host of ['localhost','127.0.0.1']) {
      await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [env.DB_USER, host, env.DB_PASSWORD]);
      await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ??.* TO ?@?', [env.DB_NAME, env.DB_USER, host]);
    }
    await admin.changeUser({ database: env.DB_NAME });
    for (const file of bootstrapFiles) {
      for (const statement of splitSql(fs.readFileSync(path.join(projectRoot, file), 'utf8'))) await admin.query(statement);
    }
    const articles = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/knowledge/articles.json'), 'utf8')).map(normalizeArticle);
    const plants = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/knowledge/plants.json'), 'utf8')).map(normalizePlant);
    await admin.beginTransaction();
    try {
      await importContent(admin, { articles, plants });
      await admin.execute("INSERT INTO users (openid, nick_name) VALUES ('dev_local_user', '本地测试用户')");
      await admin.commit();
    } catch (error) { await admin.rollback(); throw error; }
    return { status: 'INITIALIZED', database: env.DB_NAME, ...await verifyLocalDatabase(admin),
      reviewedArticles: articles.length, reviewedPlants: plants.length, destructiveOperations: false };
  } finally { await admin.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  initializeLocalDatabase(readLocalEnvironment(), argumentsByName()).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(JSON.stringify({ success: false, code: error.code || error.message, note: 'No automatic drop/reset. Inspect the named local database before retrying.' })); process.exitCode = 1; });
}
