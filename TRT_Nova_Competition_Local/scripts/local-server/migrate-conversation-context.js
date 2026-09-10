// Additive only: never call init-local-db.ps1 here (that script rebuilds the database).
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
}
async function main() {
  const { getDb } = require('../../dist/scf/agent-scf/lib/db');
  const db = await getDb();
  try {
    const sql = fs.readFileSync(path.join(root, 'reference/conversation_context.m7.sql'), 'utf8').replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.execute(statement);
    const [columns] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_context_memory' AND COLUMN_NAME = 'revision'");
    if (!columns.length) await db.execute('ALTER TABLE ai_context_memory ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 0');
    const [summaryColumns] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_context_memory' AND COLUMN_NAME = 'summary_text'");
    if (!summaryColumns.length) await db.execute('ALTER TABLE ai_context_memory ADD COLUMN summary_text TEXT NULL');
    console.log('PASS: additive context migration; existing data untouched');
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
