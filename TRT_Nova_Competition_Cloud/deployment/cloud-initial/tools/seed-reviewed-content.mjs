import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './migrate-database.mjs';

const require = createRequire(import.meta.url);
const { normalizeArticle, normalizePlant, importContent } = require(path.join(projectRoot, 'scripts/import-knowledge-articles.js'));

// Explicit, one-time seed of a new staging database. Never loads .env.local or
// turns draft/unreviewed content into published content.
export async function seedReviewedContent(db, { confirmDatabase, acknowledgeReviewed = false, dryRun = false } = {}) {
  if (acknowledgeReviewed !== true) throw new Error('REVIEWED_CONTENT_ACK_REQUIRED');
  const [[identity]] = await db.execute('SELECT DATABASE() AS name');
  const name = identity.name;
  if (!name || name !== confirmDatabase || name === 'zhichong_v01_local' || !/^[a-zA-Z0-9_]{1,64}$/.test(name)) {
    throw new Error('SEED_EXACT_ISOLATED_DATABASE_CONFIRMATION_REQUIRED');
  }
  const sources = ['articles.json', 'plants.json'].map(file => {
    const filePath = path.join(projectRoot, 'deployment/cloud-initial/build/api-scf/data/knowledge', file);
    const bytes = fs.readFileSync(filePath);
    return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), values: JSON.parse(bytes) };
  });
  const articles = sources[0].values.map(normalizeArticle);
  const plants = sources[1].values.map(normalizePlant);
  for (const item of [...articles, ...plants]) {
    if (item.status !== 'published' || !item.reviewedAt || !item.reviewedBy) throw new Error('SEED_REQUIRES_ALREADY_REVIEWED_PUBLISHED_CONTENT');
  }
  const [[lock]] = await db.execute('SELECT GET_LOCK(?, 5) AS acquired', ['nova:seed:' + name]);
  if (Number(lock.acquired) !== 1) throw new Error('SEED_LOCK_BUSY');
  try {
    await db.beginTransaction();
    // Refuse overwrite: only the empty baseline and its unreviewed bootstrap
    // plant placeholders are eligible. Updating an established content library
    // needs a separately reviewed import, not this initializer.
    const [[content]] = await db.execute('SELECT COUNT(*) AS n FROM knowledge_articles');
    const [[existing]] = await db.execute("SELECT COUNT(*) AS n FROM plant_library WHERE content_status <> 'draft' OR reviewed_at IS NOT NULL OR reviewed_by IS NOT NULL");
    if (Number(content.n) || Number(existing.n)) throw new Error('SEED_REQUIRES_EMPTY_REVIEWED_LIBRARY');
    await importContent(db, { articles, plants });
    if (dryRun) await db.rollback(); else await db.commit();
    return { ok: true, databaseName: name, dryRun, articles: articles.length, plants: plants.length,
      sourceFiles: sources.map(({ file, sha256 }) => ({ file, sha256 })),
      claim: 'EXISTING_REVIEWED_MVP_CONTENT_ONLY_NOT_NEW_CONTENT_APPROVAL' };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { await db.execute('SELECT RELEASE_LOCK(?)', ['nova:seed:' + name]); }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const index = arg.indexOf('='); return index < 0 ? [arg, true] : [arg.slice(0, index), arg.slice(index + 1)];
  }));
  if (args['--acknowledge-reviewed'] !== true) throw new Error('REVIEWED_CONTENT_ACK_REQUIRED');
  const database = process.env.DB_NAME;
  if (args['--confirm-database'] !== database) throw new Error('SEED_EXACT_DATABASE_CONFIRMATION_REQUIRED');
  const local = args['--local-test'] === true;
  if (local && (!/^nova_cloud_test_\d+$/.test(database || '') || process.env.DB_HOST !== '127.0.0.1')) throw new Error('LOCAL_TEST_REQUIRES_ISOLATED_DATABASE');
  if (!local && /^(localhost|127\.0\.0\.1|::1)$/.test(process.env.DB_HOST || '')) throw new Error('CLOUD_DATABASE_REQUIRED');
  if (!local && !['legacy-direct', 'private-network', 'required'].includes(process.env.DB_TLS_MODE)) throw new Error('DB_TLS_MODE_REQUIRED_OR_INVALID');
  const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(projectRoot, 'deployment/cloud-initial/build/api-scf')] }));
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database, charset: 'utf8mb4',
    ...(!local && process.env.DB_TLS_MODE === 'required' ? { ssl: { rejectUnauthorized: true, verifyIdentity: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } } : {}) });
  try { console.log(JSON.stringify(await seedReviewedContent(db, { confirmDatabase: database,
    acknowledgeReviewed: true, dryRun: args['--dry-run'] === true }), null, 2)); }
  finally { await db.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || error.message })); process.exitCode = 1; });
}
