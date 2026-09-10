const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');
const VALID_STATUSES = new Set(['draft', 'reviewed', 'published']);

function resolveArg(name, fallback = '') {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : fallback;
}

function loadLocalEnv() {
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) return;

  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    if (separator <= 0) return;
    const key = value.slice(0, separator).trim();
    if (process.env[key] !== undefined) return;
    process.env[key] = value.slice(separator + 1).trim();
  });
}

function readJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`Seed file must be a JSON array: ${filePath}`);
  return parsed;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function text(value) {
  return String(value || '').trim();
}

function normalizeStatus(value) {
  const status = text(value) || 'draft';
  if (!VALID_STATUSES.has(status)) throw new Error(`Unsupported content status: ${status}`);
  return status;
}

function normalizeSource(item = {}) {
  return {
    sourceType: text(item.sourceType || item.source_type) || 'external-reference',
    sourceRef: text(item.sourceRef || item.source_ref) || null,
    sourceTitle: text(item.sourceTitle || item.source_title),
    sourcePublisher: text(item.sourcePublisher || item.source_publisher),
    sourceUpdatedAt: text(item.sourceUpdatedAt || item.source_updated_at),
    sourceUrl: text(item.sourceUrl || item.source_url),
    sourceId: text(item.sourceId || item.source_id),
    contentUpdatedAt: text(item.contentUpdatedAt || item.content_updated_at),
    reviewedAt: text(item.reviewedAt || item.reviewed_at) || null,
    reviewedBy: text(item.reviewedBy || item.reviewed_by) || null,
    imageLicense: text(item.imageLicense || item.image_license),
    imageSourceUrl: text(item.imageSourceUrl || item.image_source_url) || null
  };
}

function assertTraceable(item, label) {
  const required = ['sourceTitle', 'sourcePublisher', 'sourceUrl', 'sourceId', 'contentUpdatedAt', 'imageLicense'];
  const missing = required.filter((key) => !item[key]);
  if (missing.length) throw new Error(`${label} missing traceability fields: ${missing.join(', ')}`);
  if (item.status === 'published' && (!item.reviewedAt || !item.reviewedBy)) {
    throw new Error(`${label} cannot be published without reviewedAt/reviewedBy`);
  }
}

function normalizeArticle(article = {}) {
  const normalized = {
    id: Number(article.id) || null,
    slug: text(article.slug),
    title: text(article.title),
    summary: text(article.summary),
    content: text(article.content),
    category: text(article.category) || 'plant-care',
    tags: normalizeArray(article.tags),
    aliases: normalizeArray(article.aliases),
    plantTypes: normalizeArray(article.plantTypes || article.plant_types),
    problemTypes: normalizeArray(article.problemTypes || article.problem_types),
    status: normalizeStatus(article.status),
    sortOrder: Number(article.sortOrder || article.sort_order) || 0,
    ...normalizeSource(article)
  };
  if (!normalized.slug || !normalized.title || !normalized.summary || !normalized.content) {
    throw new Error(`Invalid article seed: ${normalized.slug || normalized.title || 'unknown'}`);
  }
  assertTraceable(normalized, `article:${normalized.slug}`);
  return normalized;
}

function normalizePlant(plant = {}) {
  const care = plant.care && typeof plant.care === 'object' ? plant.care : {};
  const normalized = {
    name: text(plant.name),
    aliases: normalizeArray(plant.aliases),
    family: text(plant.family),
    scientificName: text(plant.scientificName || plant.scientific_name),
    feature: text(plant.feature),
    featureText: text(plant.featureText || plant.feature_text),
    category: text(plant.category) || 'houseplant',
    difficulty: text(plant.difficulty) || 'medium',
    imageUrl: text(plant.imageUrl || plant.image_url || plant.image),
    tags: normalizeArray(plant.tags),
    description: text(plant.description),
    care: {
      light: text(care.light),
      water: text(care.water),
      temperature: text(care.temperature),
      humidity: text(care.humidity),
      soil: text(care.soil),
      fertilizer: text(care.fertilizer),
      ventilation: text(care.ventilation)
    },
    seasonalTips: normalizeArray(plant.seasonalTips || plant.seasonal_tips),
    commonIssues: Array.isArray(plant.commonIssues) ? plant.commonIssues : [],
    faq: Array.isArray(plant.faq) ? plant.faq : [],
    recommendQuestions: normalizeArray(plant.recommendQuestions),
    agentNotes: text(plant.agentNotes),
    status: normalizeStatus(plant.status || plant.contentStatus),
    sortOrder: Number(plant.sortOrder || plant.sort_order) || 0,
    ...normalizeSource(plant)
  };
  if (!normalized.name || !normalized.scientificName || !normalized.description) {
    throw new Error(`Invalid plant seed: ${normalized.name || normalized.scientificName || 'unknown'}`);
  }
  assertTraceable(normalized, `plant:${normalized.name}`);
  return normalized;
}

async function upsertArticle(conn, article) {
  await conn.execute(
    `INSERT INTO knowledge_articles
      (slug, title, summary, content, category, tags_json, aliases_json, plant_types_json,
       problem_types_json, source_type, source_ref, source_title, source_publisher,
       source_updated_at, source_url, source_id, content_updated_at, reviewed_at, reviewed_by,
       image_license, image_source_url, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), summary = VALUES(summary), content = VALUES(content),
       category = VALUES(category), tags_json = VALUES(tags_json), aliases_json = VALUES(aliases_json),
       plant_types_json = VALUES(plant_types_json), problem_types_json = VALUES(problem_types_json),
       source_type = VALUES(source_type), source_ref = VALUES(source_ref), source_title = VALUES(source_title),
       source_publisher = VALUES(source_publisher), source_updated_at = VALUES(source_updated_at),
       source_url = VALUES(source_url), source_id = VALUES(source_id),
       content_updated_at = VALUES(content_updated_at), reviewed_at = VALUES(reviewed_at),
       reviewed_by = VALUES(reviewed_by), image_license = VALUES(image_license),
       image_source_url = VALUES(image_source_url), status = VALUES(status),
       sort_order = VALUES(sort_order), updated_at = NOW()`,
    [
      article.slug, article.title, article.summary, article.content, article.category,
      JSON.stringify(article.tags), JSON.stringify(article.aliases), JSON.stringify(article.plantTypes),
      JSON.stringify(article.problemTypes), article.sourceType, article.sourceRef, article.sourceTitle,
      article.sourcePublisher, article.sourceUpdatedAt || null, article.sourceUrl, article.sourceId,
      article.contentUpdatedAt, article.reviewedAt, article.reviewedBy, article.imageLicense,
      article.imageSourceUrl, article.status, article.sortOrder
    ]
  );
}

async function upsertPlant(conn, plant) {
  const [rows] = await conn.execute(
    'SELECT id FROM plant_library WHERE source_id = ? OR name = ? ORDER BY id ASC LIMIT 1',
    [plant.sourceId, plant.name]
  );
  const values = [
    plant.name, JSON.stringify(plant.aliases), plant.family, plant.scientificName, plant.feature,
    plant.featureText, plant.category, plant.difficulty, plant.imageUrl || null, JSON.stringify(plant.tags),
    plant.description, plant.care.light, plant.care.water, plant.care.temperature, plant.care.humidity,
    plant.care.soil, plant.care.fertilizer, plant.care.ventilation, JSON.stringify(plant.seasonalTips),
    JSON.stringify(plant.commonIssues), JSON.stringify(plant.faq), JSON.stringify(plant.recommendQuestions),
    JSON.stringify({}), plant.agentNotes, plant.sortOrder, plant.status, plant.sourceTitle,
    plant.sourcePublisher, plant.sourceUpdatedAt || null, plant.sourceUrl, plant.sourceId,
    plant.contentUpdatedAt, plant.reviewedAt, plant.reviewedBy, plant.imageLicense, plant.imageSourceUrl
  ];

  if (rows.length) {
    await conn.execute(
      `UPDATE plant_library SET
        name=?, aliases_json=?, family=?, scientific_name=?, feature=?, feature_text=?, category=?,
        difficulty=?, image_url=?, tags_json=?, description=?, care_light=?, care_water=?,
        care_temperature=?, care_humidity=?, care_soil=?, care_fertilizer=?, care_ventilation=?,
        seasonal_tips_json=?, common_issues_json=?, faq_json=?, recommend_questions_json=?,
        device_interpretation_json=?, agent_notes=?, sort_order=?, content_status=?, source_title=?,
        source_publisher=?, source_updated_at=?, source_url=?, source_id=?, content_updated_at=?,
        reviewed_at=?, reviewed_by=?, image_license=?, image_source_url=?, is_active=1,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      values.concat(rows[0].id)
    );
    return;
  }

  await conn.execute(
    `INSERT INTO plant_library
      (name, aliases_json, family, scientific_name, feature, feature_text, category, difficulty,
       image_url, tags_json, description, care_light, care_water, care_temperature, care_humidity,
       care_soil, care_fertilizer, care_ventilation, seasonal_tips_json, common_issues_json, faq_json,
       recommend_questions_json, device_interpretation_json, agent_notes, sort_order, content_status,
       source_title, source_publisher, source_updated_at, source_url, source_id, content_updated_at,
       reviewed_at, reviewed_by, image_license, image_source_url, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    values
  );
}

async function importContent(conn, { articles, plants }) {
  const articleSlugs = articles.map((item) => item.slug);
  if (articleSlugs.length) {
    const placeholders = articleSlugs.map(() => '?').join(', ');
    await conn.execute(
      `UPDATE knowledge_articles SET status='draft', reviewed_at=NULL, reviewed_by=NULL
       WHERE source_type='seed' AND slug NOT IN (${placeholders})`,
      articleSlugs
    );
  }
  for (const article of articles) await upsertArticle(conn, article);
  for (const plant of plants) await upsertPlant(conn, plant);
}

async function main() {
  loadLocalEnv();
  const articlePath = resolveArg('articles', path.join(ROOT, 'data', 'knowledge', 'articles.json'));
  const plantPath = resolveArg('plants', path.join(ROOT, 'data', 'knowledge', 'plants.json'));
  const dryRun = resolveArg('dry-run', 'false') === 'true';
  const articles = readJson(articlePath).map(normalizeArticle);
  const plants = readJson(plantPath).map(normalizePlant);

  const requiredEnv = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing ${missing.join('/')}`);

  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await importContent(conn, { articles, plants });
    if (dryRun) await conn.rollback();
    else await conn.commit();
    console.log(`${dryRun ? '[dry-run] validated' : 'Imported'} ${plants.length} plants and ${articles.length} articles`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[import-knowledge-articles] failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  VALID_STATUSES,
  normalizeArticle,
  normalizePlant,
  importContent
};
