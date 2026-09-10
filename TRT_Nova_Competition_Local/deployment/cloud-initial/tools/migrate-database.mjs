import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
export const bootstrapFiles = [
  'reference/lightdb.mysql.schema.sql', 'reference/plant_pets.v1.sql',
  'reference/plant_journal.v1.sql', 'reference/care_tasks.v1.sql',
  'reference/media_storage.v1.sql', 'reference/admin-console.v1.sql',
  'reference/weather.m5.sql', 'reference/ai_assistant.m6.sql',
  'reference/agent_runtime.m7.sql', 'reference/conversation_context.m7.sql'
];

// These reviewed DDL files use simple statements and a single-statement trigger.
// Split outside quoted values/comments; never split a seed's semicolon in text.
export function splitSql(text) {
  if (/^\s*DELIMITER\b/im.test(text)) throw new Error('MIGRATION_DELIMITER_UNSUPPORTED');
  const result = []; let statement = ''; let quote = ''; let comment = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]; const next = text[i + 1];
    if (comment === 'line') { if (char === '\n') { comment = ''; statement += '\n'; } continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      statement += char;
      if (char === '\\' && quote !== '`') { statement += next || ''; i++; }
      else if (char === quote && next === quote) { statement += next; i++; }
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '-' && next === '-' && /\s/.test(text[i + 2] || '')) { comment = 'line'; i++; continue; }
    if (char === '#') { comment = 'line'; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (["'", '"', '`'].includes(char)) { quote = char; statement += char; continue; }
    if (char === ';') { if (statement.trim()) result.push(statement.trim()); statement = ''; }
    else statement += char;
  }
  if (quote || comment === 'block') throw new Error('MIGRATION_SQL_UNTERMINATED');
  if (statement.trim()) result.push(statement.trim());
  return result;
}

const normalizeSql = (text) => String(text).replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
async function column(db, table, name) {
  const [rows] = await db.execute(`SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, name]);
  return rows[0];
}
async function assertColumns(db, definitions) {
  for (const [table, names] of Object.entries(definitions)) {
    for (const name of names) if (!await column(db, table, name)) throw new Error(`MIGRATION_BASELINE_MISSING:${table}.${name}`);
  }
}
async function applyFile(db, relativePath) {
  const statements = splitSql(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
  for (const statement of statements) await db.query(statement);
}

export async function migrateDatabase(db, { mode = 'incremental', confirmDatabase } = {}) {
  if (!['bootstrap', 'incremental', 'verify'].includes(mode)) throw new Error('MIGRATION_MODE_INVALID');
  const [[identity]] = await db.execute('SELECT DATABASE() AS databaseName');
  const databaseName = identity.databaseName;
  if (!databaseName || confirmDatabase !== databaseName || !/^[a-zA-Z0-9_]{1,64}$/.test(databaseName)) {
    throw new Error('MIGRATION_EXACT_DATABASE_CONFIRMATION_REQUIRED');
  }
  if (databaseName === 'zhichong_v01_local') throw new Error('MIGRATION_LOCAL_ACCEPTANCE_DATABASE_PROTECTED');
  const [[lock]] = await db.execute('SELECT GET_LOCK(?, 5) AS acquired', [`nova:migrate:${databaseName}`]);
  if (Number(lock.acquired) !== 1) throw new Error('MIGRATION_LOCK_BUSY');
  const applied = [];
  try {
    if (mode === 'bootstrap') {
      const [[tables]] = await db.execute('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
      if (Number(tables.n) !== 0) throw new Error('BOOTSTRAP_REQUIRES_EMPTY_DATABASE');
      for (const file of bootstrapFiles) { await applyFile(db, file); applied.push(file); }
    }
    // Incremental mode deliberately requires the established M1-M7 baseline.
    // It never blindly retries destructive bootstrap or suppresses duplicate-column errors.
    await assertColumns(db, {
      users: ['openid', 'avatar_file_id'], plant_pets: ['openid', 'cover_file_id'],
      todos: ['plant_pet_id', 'source'], media_objects: ['file_id', 'provider', 'content_blob', 'mime_type'],
      ai_conversations: ['session_key'], ai_messages: ['response_json'],
      ai_action_proposals: ['payload_json'], ai_message_media_links: ['file_id'],
      care_task_creation_keys: ['idempotency_key'], knowledge_articles: ['reviewed_by'],
      plant_library: ['content_status'], weather_cache: ['location_id']
    });
    if (mode !== 'verify') {
      await applyFile(db, 'reference/conversation_context.m7.sql');
      for (const [name, ddl] of [['revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'], ['summary_text', 'TEXT NULL']]) {
        if (!await column(db, 'ai_context_memory', name)) {
          await db.query(`ALTER TABLE ai_context_memory ADD COLUMN ${name} ${ddl}`);
          applied.push(`ai_context_memory.${name}`);
        }
      }
      const statements = splitSql(fs.readFileSync(path.join(projectRoot, 'deployment/cloud-initial/database/cloud-media.sql'), 'utf8'));
      for (const statement of statements) {
        if (/^CREATE TRIGGER nova_cloud_media_delete\b/i.test(statement)) {
          const [triggers] = await db.execute(`SELECT EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT
            FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'nova_cloud_media_delete'`);
          if (triggers.length) {
            const trigger = triggers[0];
            const body = statement.split(/FOR EACH ROW\s+/i)[1];
            if (trigger.EVENT_MANIPULATION !== 'DELETE' || trigger.EVENT_OBJECT_TABLE !== 'media_objects' ||
                trigger.ACTION_TIMING !== 'AFTER' || normalizeSql(trigger.ACTION_STATEMENT) !== normalizeSql(body)) {
              throw new Error('MIGRATION_CLOUD_TRIGGER_CONFLICT');
            }
            continue;
          }
        }
        await db.query(statement);
      }
      if (!await column(db, 'cloud_media_objects', 'attempts')) {
        await db.query('ALTER TABLE cloud_media_objects ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0');
        applied.push('cloud_media_objects.attempts');
      }
      applied.push('deployment/cloud-initial/database/cloud-media.sql');
    }
    await assertColumns(db, {
      ai_session_context: ['summary', 'through_message_id', 'revision'],
      ai_context_memory: ['enabled', 'policy_version', 'revision', 'facts_json', 'summary_text'],
      cloud_media_objects: ['file_id', 'openid', 'object_key', 'bucket', 'region', 'sha256', 'state', 'cleanup_after', 'attempts']
    });
    const mime = await column(db, 'media_objects', 'mime_type');
    if (mime.COLUMN_TYPE !== 'varchar(128)') throw new Error('MIGRATION_MEDIA_MIME_WIDTH_INVALID');
    const [triggers] = await db.execute(`SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'nova_cloud_media_delete'
      AND EVENT_MANIPULATION = 'DELETE' AND EVENT_OBJECT_TABLE = 'media_objects' AND ACTION_TIMING = 'AFTER'`);
    const expectedTrigger = splitSql(fs.readFileSync(path.join(projectRoot, 'deployment/cloud-initial/database/cloud-media.sql'), 'utf8'))
      .find(statement => /^CREATE TRIGGER /i.test(statement)).split(/FOR EACH ROW\s+/i)[1];
    if (triggers.length !== 1 || normalizeSql(triggers[0].ACTION_STATEMENT) !== normalizeSql(expectedTrigger)) {
      throw new Error('MIGRATION_CLOUD_TRIGGER_MISSING_OR_CHANGED');
    }
    return { success: true, databaseName, mode, applied, destructiveOperations: false,
      note: 'DDL is not transactional in MySQL. Failure stops immediately; inspect before retrying.' };
  } finally { await db.execute('SELECT RELEASE_LOCK(?)', [`nova:migrate:${databaseName}`]); }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const index = arg.indexOf('='); return index === -1 ? [arg, true] : [arg.slice(0, index), arg.slice(index + 1)]; }));
  const database = process.env.DB_NAME;
  if (args['--confirm-database'] !== database) throw new Error('MIGRATION_EXACT_DATABASE_CONFIRMATION_REQUIRED');
  const local = args['--local-test'] === true;
  if (local && (!/^nova_cloud_test_\d+$/.test(database || '') || process.env.DB_HOST !== '127.0.0.1')) {
    throw new Error('LOCAL_TEST_REQUIRES_ISOLATED_DATABASE');
  }
  if (!local && /^(localhost|127\.0\.0\.1|::1)$/.test(process.env.DB_HOST || '')) throw new Error('CLOUD_DATABASE_REQUIRED');
  const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(projectRoot, 'deployment/cloud-initial/build/api-scf'), projectRoot] }));
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database, charset: 'utf8mb4',
    ...(!local ? { ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } } : {}) });
  try { console.log(JSON.stringify(await migrateDatabase(db, { mode: args['--mode'] || 'verify', confirmDatabase: database }), null, 2)); }
  finally { await db.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ success: false, code: error.code || error.message })); process.exitCode = 1; });
}
