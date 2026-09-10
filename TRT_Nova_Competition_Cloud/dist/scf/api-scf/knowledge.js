const fs = require('fs');
const path = require('path');

function loadSeedFile(fileName) {
  const candidates = [
    path.join(__dirname, 'data', 'knowledge', fileName),
    path.join(__dirname, '..', '..', '..', 'data', 'knowledge', fileName)
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`[knowledge] failed to load ${fileName}:`, err.message);
    }
  }
  return [];
}

const seedArticles = loadSeedFile('articles.json');
const seedPlants = loadSeedFile('plants.json');

function parseJsonField(input, fallback) {
  if (input === undefined || input === null || input === '') return fallback;
  if (Array.isArray(input) || typeof input === 'object') return input;
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch (err) { return fallback; }
  }
  return fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeSource(item = {}) {
  return {
    sourceType: String(item.sourceType || item.source_type || 'external-reference').trim(),
    sourceRef: String(item.sourceRef || item.source_ref || '').trim(),
    sourceTitle: String(item.sourceTitle || item.source_title || '').trim(),
    sourcePublisher: String(item.sourcePublisher || item.source_publisher || '').trim(),
    sourceUpdatedAt: String(item.sourceUpdatedAt || item.source_updated_at || '').trim(),
    sourceUrl: String(item.sourceUrl || item.source_url || '').trim(),
    sourceId: String(item.sourceId || item.source_id || '').trim(),
    contentUpdatedAt: String(item.contentUpdatedAt || item.content_updated_at || '').slice(0, 10),
    reviewedAt: item.reviewedAt || item.reviewed_at || null,
    reviewedBy: String(item.reviewedBy || item.reviewed_by || '').trim(),
    imageLicense: String(item.imageLicense || item.image_license || '').trim(),
    imageSourceUrl: String(item.imageSourceUrl || item.image_source_url || '').trim()
  };
}

function normalizeSeedArticle(article = {}) {
  return {
    id: Number(article.id) || 0,
    slug: String(article.slug || '').trim(),
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim(),
    content: String(article.content || '').trim(),
    category: String(article.category || 'plant-care').trim(),
    tags: normalizeArray(article.tags),
    aliases: normalizeArray(article.aliases),
    plantTypes: normalizeArray(article.plantTypes),
    problemTypes: normalizeArray(article.problemTypes),
    status: String(article.status || 'draft').trim() || 'draft',
    sortOrder: Number(article.sortOrder) || 0,
    ...normalizeSource(article)
  };
}

function mapKnowledgeArticleRow(row = {}) {
  return normalizeSeedArticle({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: row.content,
    category: row.category,
    tags: normalizeArray(parseJsonField(row.tags_json, [])),
    aliases: normalizeArray(parseJsonField(row.aliases_json, [])),
    plantTypes: normalizeArray(parseJsonField(row.plant_types_json, [])),
    problemTypes: normalizeArray(parseJsonField(row.problem_types_json, [])),
    status: row.status,
    sortOrder: row.sort_order,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceTitle: row.source_title,
    sourcePublisher: row.source_publisher,
    sourceUpdatedAt: row.source_updated_at,
    sourceUrl: row.source_url,
    sourceId: row.source_id,
    contentUpdatedAt: row.content_updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    imageLicense: row.image_license,
    imageSourceUrl: row.image_source_url
  });
}

function normalizeSeedPlant(plant = {}) {
  const care = plant.care && typeof plant.care === 'object' ? plant.care : {};
  return {
    id: Number(plant.id) || 0,
    name: String(plant.name || '').trim(),
    aliases: normalizeArray(plant.aliases),
    family: String(plant.family || '').trim(),
    scientificName: String(plant.scientificName || '').trim(),
    feature: String(plant.feature || '').trim(),
    featureText: String(plant.featureText || '').trim(),
    category: String(plant.category || '').trim(),
    difficulty: String(plant.difficulty || '').trim(),
    image: String(plant.image || plant.imageUrl || '').trim(),
    tags: normalizeArray(plant.tags),
    description: String(plant.description || '').trim(),
    care: {
      light: String(care.light || '').trim(),
      water: String(care.water || '').trim(),
      temperature: String(care.temperature || '').trim(),
      humidity: String(care.humidity || '').trim(),
      soil: String(care.soil || '').trim(),
      fertilizer: String(care.fertilizer || '').trim(),
      ventilation: String(care.ventilation || '').trim()
    },
    commonIssues: Array.isArray(plant.commonIssues) ? plant.commonIssues : [],
    faq: Array.isArray(plant.faq) ? plant.faq : [],
    recommendQuestions: normalizeArray(plant.recommendQuestions),
    status: String(plant.status || plant.contentStatus || 'draft').trim() || 'draft',
    sortOrder: Number(plant.sortOrder) || 0,
    ...normalizeSource(plant)
  };
}

function mapKnowledgePlantRow(row = {}) {
  return normalizeSeedPlant({
    id: row.id,
    name: row.name,
    aliases: normalizeArray(parseJsonField(row.aliases_json, [])),
    family: row.family,
    scientificName: row.scientific_name,
    feature: row.feature,
    featureText: row.feature_text,
    category: row.category,
    difficulty: row.difficulty,
    image: row.image_url,
    tags: normalizeArray(parseJsonField(row.tags_json, [])),
    description: row.description,
    care: {
      light: row.care_light,
      water: row.care_water,
      temperature: row.care_temperature,
      humidity: row.care_humidity,
      soil: row.care_soil,
      fertilizer: row.care_fertilizer,
      ventilation: row.care_ventilation
    },
    commonIssues: parseJsonField(row.common_issues_json, []),
    faq: parseJsonField(row.faq_json, []),
    recommendQuestions: parseJsonField(row.recommend_questions_json, []),
    contentStatus: row.content_status,
    sortOrder: row.sort_order,
    sourceTitle: row.source_title,
    sourcePublisher: row.source_publisher,
    sourceUpdatedAt: row.source_updated_at,
    sourceUrl: row.source_url,
    sourceId: row.source_id,
    contentUpdatedAt: row.content_updated_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    imageLicense: row.image_license,
    imageSourceUrl: row.image_source_url
  });
}

function published(items, normalizer) {
  return (Array.isArray(items) ? items : []).map(normalizer).filter((item) => item.status === 'published');
}

function containsEither(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function scoreArticle(article, query = '', filters = {}) {
  const text = String(query || '').trim().toLowerCase();
  const category = String(filters.category || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const plantType = String(filters.plantType || '').trim().toLowerCase();
  if (category && String(article.category || '').toLowerCase() !== category) return 0;
  if (tag && !(article.tags || []).some((item) => item.toLowerCase().includes(tag))) return 0;
  if (plantType && (article.plantTypes || []).length && !(article.plantTypes || []).some((item) => containsEither(item, plantType))) return 0;

  let match = 0;
  if (text) {
    if (containsEither(article.title, text)) match += 100;
    if (containsEither(article.summary, text)) match += 60;
    if ((article.aliases || []).some((item) => containsEither(item, text))) match += 45;
    if ((article.tags || []).some((item) => containsEither(item, text))) match += 40;
    if ((article.plantTypes || []).some((item) => containsEither(item, text))) match += 25;
    if ((article.problemTypes || []).some((item) => containsEither(item, text))) match += 20;
    if (containsEither(article.content, text)) match += 10;
    if (!match) return 0;
  } else {
    match = 1;
  }
  return match + Math.max(0, 500 - Number(article.sortOrder || 0));
}

function scorePlant(plant, query = '') {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return 1 + Math.max(0, 500 - Number(plant.sortOrder || 0));
  const fields = [plant.name, plant.scientificName, plant.family, plant.description, ...(plant.aliases || []), ...(plant.tags || [])];
  const matched = fields.some((item) => containsEither(item, text));
  return matched ? 100 + Math.max(0, 500 - Number(plant.sortOrder || 0)) : 0;
}

const ARTICLE_SELECT = `SELECT id, slug, title, summary, content, category, tags_json, aliases_json,
  plant_types_json, problem_types_json, source_type, source_ref, source_title, source_publisher,
  source_updated_at, source_url, source_id, DATE_FORMAT(content_updated_at, '%Y-%m-%d') AS content_updated_at,
  DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewed_at, reviewed_by, image_license,
  image_source_url, status, sort_order FROM knowledge_articles`;

const PLANT_SELECT = `SELECT id, name, aliases_json, family, scientific_name, feature, feature_text,
  category, difficulty, image_url, tags_json, description, care_light, care_water, care_temperature,
  care_humidity, care_soil, care_fertilizer, care_ventilation, common_issues_json, faq_json,
  recommend_questions_json, content_status, source_title, source_publisher, source_updated_at,
  source_url, source_id, DATE_FORMAT(content_updated_at, '%Y-%m-%d') AS content_updated_at,
  DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewed_at, reviewed_by, image_license,
  image_source_url, sort_order FROM plant_library`;

async function loadArticles(db) {
  try {
    const [rows] = await db.execute(`${ARTICLE_SELECT} WHERE status='published' ORDER BY sort_order ASC, id ASC`);
    return (Array.isArray(rows) ? rows : []).map(mapKnowledgeArticleRow).filter((item) => item.status === 'published');
  } catch (err) {
    console.warn('[knowledge] loadArticles fallback to published seed:', err.message);
    return published(seedArticles, normalizeSeedArticle);
  }
}

async function loadPlants(db) {
  try {
    const [rows] = await db.execute(`${PLANT_SELECT} WHERE is_active=1 AND content_status='published' ORDER BY sort_order ASC, id ASC`);
    return (Array.isArray(rows) ? rows : []).map(mapKnowledgePlantRow).filter((item) => item.status === 'published');
  } catch (err) {
    console.warn('[knowledge] loadPlants fallback to published seed:', err.message);
    return published(seedPlants, normalizeSeedPlant);
  }
}

async function listKnowledgeCategories(db) {
  const articles = await loadArticles(db);
  return { success: true, categories: Array.from(new Set(articles.map((item) => item.category).filter(Boolean))) };
}

async function listKnowledgeArticles(db, input = {}) {
  const articles = await loadArticles(db);
  const category = String(input.category || '').trim();
  return { success: true, articles: category ? articles.filter((item) => item.category === category) : articles };
}

async function getKnowledgeArticle(db, input = {}) {
  const target = String(input.articleIdOrSlug || input.id || input.slug || '').trim();
  if (!target) return { success: false, msg: 'articleIdOrSlug is required' };
  const article = (await loadArticles(db)).find((item) => String(item.id) === target || item.slug === target) || null;
  return article ? { success: true, article } : { success: false, msg: 'Article not found' };
}

async function searchKnowledgeArticles(db, input = {}) {
  const query = String(input.query || '').trim();
  const limit = Math.max(1, Number(input.limit) || 20);
  const articles = (await loadArticles(db)).map((item) => ({
    ...item,
    score: scoreArticle(item, query, input)
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder || a.id - b.id).slice(0, limit);
  return { success: true, articles, unknown: Boolean(query) && articles.length === 0 };
}

async function recommendKnowledgeArticles(db, input = {}) {
  const plantType = String(input.plantType || '').trim();
  return searchKnowledgeArticles(db, { ...input, query: plantType, plantType, limit: input.limit || 8 });
}

async function listKnowledgePlants(db, input = {}) {
  const query = String(input.query || '').trim();
  const limit = Math.max(1, Number(input.limit) || 50);
  const plants = (await loadPlants(db)).map((item) => ({ ...item, score: scorePlant(item, query) }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder || a.id - b.id).slice(0, limit);
  return { success: true, plants, unknown: Boolean(query) && plants.length === 0 };
}

async function getKnowledgePlant(db, input = {}) {
  const target = String(input.plantIdOrName || input.id || input.name || '').trim();
  if (!target) return { success: false, msg: 'plantIdOrName is required' };
  const plant = (await loadPlants(db)).find((item) => String(item.id) === target || item.name === target || item.scientificName === target) || null;
  return plant ? { success: true, plant } : { success: false, msg: 'Plant not found' };
}

async function buildKnowledgeContext(db, input = {}) {
  const result = await searchKnowledgeArticles(db, { ...input, limit: input.limit || 4 });
  const articles = result.articles || [];
  return {
    success: true,
    articles,
    unknown: articles.length === 0,
    message: articles.length ? '' : '当前已发布知识库中没有足够依据。',
    contextText: articles.length ? [
      '以下仅包含人工复核且已发布的知识依据。没有覆盖到的事实请明确说不知道或不确定，不得补造来源。',
      ...articles.map((item, index) => `${index + 1}. [${item.title}] ${item.summary}\n${item.content}\n来源：${item.sourcePublisher}｜${item.sourceTitle}｜${item.sourceUrl}`)
    ].join('\n') : ''
  };
}

module.exports = {
  normalizeSeedArticle,
  normalizeSeedPlant,
  scoreArticle,
  scorePlant,
  loadArticles,
  loadPlants,
  listKnowledgeCategories,
  listKnowledgeArticles,
  getKnowledgeArticle,
  searchKnowledgeArticles,
  recommendKnowledgeArticles,
  listKnowledgePlants,
  getKnowledgePlant,
  buildKnowledgeContext
};
