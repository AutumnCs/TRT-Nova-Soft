const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function resolveArg(name, fallback = '') {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((item) => item.startsWith(prefix));
  if (match) {
    return match.slice(prefix.length).trim();
  }
  return fallback;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Seed file must be a JSON array: ${filePath}`);
  }
  return parsed;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeArticle(article = {}) {
  const id = Number(article.id) || null;
  const slug = String(article.slug || '').trim();
  const title = String(article.title || '').trim();
  const summary = String(article.summary || '').trim();
  const content = String(article.content || '').trim();
  if (!slug || !title || !summary || !content) {
    throw new Error(`Invalid article seed: ${slug || title || 'unknown'}`);
  }

  return {
    id,
    slug,
    title,
    summary,
    content,
    category: String(article.category || 'general').trim() || 'general',
    tags: normalizeArray(article.tags),
    aliases: normalizeArray(article.aliases),
    plantTypes: normalizeArray(article.plantTypes),
    problemTypes: normalizeArray(article.problemTypes),
    sourceType: String(article.sourceType || 'seed').trim() || 'seed',
    sourceRef: String(article.sourceRef || '').trim() || null,
    status: String(article.status || 'published').trim() || 'published',
    sortOrder: Number(article.sortOrder) || 0
  };
}

async function main() {
  const seedPath = resolveArg('seed', path.join(__dirname, '..', 'data', 'knowledge', 'articles.json'));
  const dryRun = resolveArg('dry-run', 'false') === 'true';

  const dbHost = process.env.DB_HOST;
  const dbPort = Number(process.env.DB_PORT || 3306);
  const dbName = process.env.DB_NAME;
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;

  if (!dbHost || !dbName || !dbUser || !dbPassword) {
    throw new Error('Missing DB_HOST/DB_NAME/DB_USER/DB_PASSWORD');
  }

  const pool = await mysql.createPool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: dbUser,
    password: dbPassword,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });

  const articles = readJson(seedPath).map(normalizeArticle);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const article of articles) {
      await conn.execute(
        `INSERT INTO knowledge_articles
          (id, slug, title, summary, content, category, tags_json, aliases_json, plant_types_json, problem_types_json, source_type, source_ref, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           summary = VALUES(summary),
           content = VALUES(content),
           category = VALUES(category),
           tags_json = VALUES(tags_json),
           aliases_json = VALUES(aliases_json),
           plant_types_json = VALUES(plant_types_json),
           problem_types_json = VALUES(problem_types_json),
           source_type = VALUES(source_type),
           source_ref = VALUES(source_ref),
           status = VALUES(status),
           sort_order = VALUES(sort_order),
           updated_at = NOW()`,
        [
          article.id,
          article.slug,
          article.title,
          article.summary,
          article.content,
          article.category,
          JSON.stringify(article.tags),
          JSON.stringify(article.aliases),
          JSON.stringify(article.plantTypes),
          JSON.stringify(article.problemTypes),
          article.sourceType,
          article.sourceRef,
          article.status,
          article.sortOrder
        ]
      );
    }

    if (dryRun) {
      await conn.rollback();
      console.log(`[dry-run] would import ${articles.length} knowledge articles from ${seedPath}`);
    } else {
      await conn.commit();
      console.log(`Imported ${articles.length} knowledge articles from ${seedPath}`);
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[import-knowledge-articles] failed:', err.message);
  process.exitCode = 1;
});
