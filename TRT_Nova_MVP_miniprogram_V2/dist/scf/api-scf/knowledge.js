const fs = require('fs');
const path = require('path');

function loadSeedArticles() {
  const candidates = [
    path.join(__dirname, 'data', 'knowledge', 'articles.json'),
    path.join(__dirname, '..', '..', '..', 'data', 'knowledge', 'articles.json')
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.warn('[knowledge] failed to load seed articles:', err.message);
    }
  }

  return [];
}

const seedArticles = loadSeedArticles();

function parseJsonField(input, fallback) {
  if (!input) return fallback;
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (err) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
}

function mapKnowledgeArticleRow(row = {}) {
  return {
    id: row.id || 0,
    slug: row.slug || '',
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    category: row.category || 'general',
    tags: normalizeArray(parseJsonField(row.tags_json, [])),
    aliases: normalizeArray(parseJsonField(row.aliases_json, [])),
    plantTypes: normalizeArray(parseJsonField(row.plant_types_json, [])),
    problemTypes: normalizeArray(parseJsonField(row.problem_types_json, [])),
    sourceType: row.source_type || 'seed',
    sourceRef: row.source_ref || '',
    status: row.status || 'published',
    sortOrder: Number(row.sort_order) || 0,
    score: Number(row.score) || 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeSeedArticle(article = {}) {
  return {
    id: Number(article.id) || 0,
    slug: String(article.slug || '').trim(),
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim(),
    content: String(article.content || '').trim(),
    category: String(article.category || 'general').trim() || 'general',
    tags: normalizeArray(article.tags),
    aliases: normalizeArray(article.aliases),
    plantTypes: normalizeArray(article.plantTypes),
    problemTypes: normalizeArray(article.problemTypes),
    sourceType: String(article.sourceType || 'seed').trim() || 'seed',
    sourceRef: String(article.sourceRef || '').trim(),
    status: String(article.status || 'published').trim() || 'published',
    sortOrder: Number(article.sortOrder) || 0,
    score: Number(article.score) || 0
  };
}

function uniq(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function scoreArticle(article, query = '', filters = {}) {
  const text = String(query || '').trim().toLowerCase();
  const title = String(article.title || '').toLowerCase();
  const summary = String(article.summary || '').toLowerCase();
  const content = String(article.content || '').toLowerCase();
  const category = String(filters.category || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const plantType = String(filters.plantType || '').trim().toLowerCase();

  if (category && String(article.category || '').toLowerCase() !== category) return 0;
  if (tag && !(article.tags || []).some((item) => item.toLowerCase() === tag || item.toLowerCase().includes(tag))) return 0;
  if (plantType && !(article.plantTypes || []).some((item) => item.toLowerCase() === plantType || item.toLowerCase().includes(plantType))) return 0;

  let score = Number(article.score) || 0;
  if (text) {
    if (title.includes(text)) score += 100;
    if (summary.includes(text)) score += 60;
    if ((article.aliases || []).some((item) => item.toLowerCase().includes(text))) score += 45;
    if ((article.tags || []).some((item) => item.toLowerCase().includes(text))) score += 40;
    if ((article.plantTypes || []).some((item) => item.toLowerCase().includes(text))) score += 25;
    if ((article.problemTypes || []).some((item) => item.toLowerCase().includes(text))) score += 20;
    if (content.includes(text)) score += 10;
  } else {
    score += 1;
  }

  return score + Math.max(0, 500 - Number(article.sortOrder || 0));
}

async function loadArticles(db) {
  try {
    const [rows] = await db.execute(
      `SELECT id, slug, title, summary, content, category, tags_json, aliases_json, plant_types_json,
              problem_types_json, source_type, source_ref, status, sort_order, created_at, updated_at
       FROM knowledge_articles
       WHERE status = 'published'
       ORDER BY sort_order ASC, id ASC`
    );
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map(mapKnowledgeArticleRow);
    }
  } catch (err) {
    console.warn('[knowledge] loadArticles fallback to seed:', err.message);
  }

  return (Array.isArray(seedArticles) ? seedArticles : []).map(normalizeSeedArticle);
}

async function listKnowledgeCategories(db) {
  const articles = await loadArticles(db);
  const categories = uniq(articles.map((item) => item.category));
  return {
    success: true,
    categories
  };
}

async function listKnowledgeArticles(db, input = {}) {
  const articles = await loadArticles(db);
  const category = String(input.category || '').trim();
  const tag = String(input.tag || '').trim();
  const plantType = String(input.plantType || '').trim();
  const filtered = articles.filter((item) => {
    if (category && String(item.category || '') !== category) return false;
    if (tag && !(item.tags || []).some((part) => part === tag || part.toLowerCase().includes(tag.toLowerCase()))) return false;
    if (plantType && !(item.plantTypes || []).some((part) => part === plantType || part.toLowerCase().includes(plantType.toLowerCase()))) return false;
    return true;
  });

  return {
    success: true,
    articles: filtered
  };
}

async function getKnowledgeArticle(db, input = {}) {
  const articleIdOrSlug = String(input.articleIdOrSlug || input.id || input.slug || '').trim();
  if (!articleIdOrSlug) {
    return { success: false, msg: 'articleIdOrSlug is required' };
  }

  const articles = await loadArticles(db);
  const article = articles.find((item) =>
    String(item.id) === articleIdOrSlug || item.slug === articleIdOrSlug
  );

  if (!article) {
    return { success: false, msg: 'Article not found' };
  }

  return {
    success: true,
    article
  };
}

async function searchKnowledgeArticles(db, input = {}) {
  const query = String(input.query || '').trim();
  const category = String(input.category || '').trim();
  const tag = String(input.tag || '').trim();
  const plantType = String(input.plantType || '').trim();
  const limit = Math.max(1, Number(input.limit) || 20);
  const articles = await loadArticles(db);
  const hits = articles
    .map((item) => ({ ...item, score: scoreArticle(item, query, { category, tag, plantType }) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.id - b.id;
    })
    .slice(0, limit);

  return {
    success: true,
    articles: hits
  };
}

async function recommendKnowledgeArticles(db, input = {}) {
  const plantType = String(input.plantType || '').trim();
  const limit = Math.max(1, Number(input.limit) || 8);
  return searchKnowledgeArticles(db, {
    ...input,
    query: plantType,
    plantType,
    limit
  });
}

async function buildKnowledgeContext(db, input = {}) {
  const searchResult = await searchKnowledgeArticles(db, {
    query: input.query || '',
    category: input.category || '',
    tag: input.tag || '',
    plantType: input.plantType || '',
    limit: input.limit || 4
  });
  const articles = Array.isArray(searchResult.articles) ? searchResult.articles : [];
  const contextText = articles.length
    ? [
        '以下是当前可用的知识库引用，请优先基于这些内容回答，避免超出依据自由发挥。',
        ...articles.map((item, index) => `${index + 1}. [${item.title}] ${item.summary}\n${item.content}`)
      ].join('\n')
    : '';

  return {
    success: true,
    articles,
    contextText
  };
}

module.exports = {
  listKnowledgeCategories,
  listKnowledgeArticles,
  getKnowledgeArticle,
  searchKnowledgeArticles,
  recommendKnowledgeArticles,
  buildKnowledgeContext
};
