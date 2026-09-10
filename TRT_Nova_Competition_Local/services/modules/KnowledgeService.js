const ScfApiAdapter = require('../core/ScfApiAdapter');

let seedArticles = [];
let seedPlants = [];
try { seedArticles = require('../../data/knowledge/articles.json'); } catch (err) { seedArticles = []; }
try { seedPlants = require('../../data/knowledge/plants.json'); } catch (err) { seedPlants = []; }

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
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

function normalizeArticle(article = {}) {
  return {
    id: Number(article.id) || 0,
    slug: String(article.slug || '').trim(),
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim(),
    content: String(article.content || '').trim(),
    category: String(article.category || 'plant-care').trim(),
    tags: toArray(article.tags),
    aliases: toArray(article.aliases),
    plantTypes: toArray(article.plantTypes || article.plant_types),
    problemTypes: toArray(article.problemTypes || article.problem_types),
    status: String(article.status || 'draft').trim() || 'draft',
    sortOrder: Number(article.sortOrder || article.sort_order) || 0,
    score: Number(article.score) || 0,
    excerpt: String(article.excerpt || '').trim(),
    ...normalizeSource(article)
  };
}

function normalizePlant(plant = {}) {
  const care = plant.care && typeof plant.care === 'object' ? plant.care : {};
  return {
    id: Number(plant.id) || 0,
    name: String(plant.name || '').trim(),
    aliases: toArray(plant.aliases),
    family: String(plant.family || '').trim(),
    scientificName: String(plant.scientificName || '').trim(),
    feature: String(plant.feature || '').trim(),
    featureText: String(plant.featureText || '').trim(),
    category: String(plant.category || '').trim(),
    difficulty: String(plant.difficulty || '').trim(),
    image: String(plant.image || plant.imageUrl || '').trim(),
    tags: toArray(plant.tags),
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
    recommendQuestions: toArray(plant.recommendQuestions),
    status: String(plant.status || plant.contentStatus || 'draft').trim() || 'draft',
    sortOrder: Number(plant.sortOrder || plant.sort_order) || 0,
    score: Number(plant.score) || 0,
    ...normalizeSource(plant)
  };
}

function onlyPublished(items, normalizer) {
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
  return fields.some((item) => containsEither(item, text))
    ? 100 + Math.max(0, 500 - Number(plant.sortOrder || 0))
    : 0;
}

class KnowledgeService {
  constructor(adapter = new ScfApiAdapter()) {
    this.scfApiAdapter = adapter;
    this._cachedArticles = [];
    this._cachedPlants = [];
  }

  getFallbackArticles() {
    return onlyPublished(seedArticles, normalizeArticle);
  }

  getFallbackPlants() {
    return onlyPublished(seedPlants, normalizePlant);
  }

  sort(items = []) {
    return items.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.id || 0) - Number(b.id || 0));
  }

  async getArticles(options = {}) {
    if (options.useCache && this._cachedArticles.length) return { success: true, articles: this._cachedArticles.slice() };
    try {
      const res = await this.scfApiAdapter.getKnowledgeArticles(options);
      const articles = this.sort(onlyPublished(res?.articles, normalizeArticle));
      this._cachedArticles = articles.slice();
      return { success: true, articles };
    } catch (err) {
      const articles = this.sort(this.getFallbackArticles());
      this._cachedArticles = articles.slice();
      return { success: true, articles, fallback: true };
    }
  }

  async getPlantProfiles(options = {}) {
    if (options.useCache && this._cachedPlants.length) return { success: true, plants: this._cachedPlants.slice() };
    try {
      const res = await this.scfApiAdapter.getKnowledgePlants(options);
      const plants = this.sort(onlyPublished(res?.plants, normalizePlant));
      this._cachedPlants = plants.slice();
      return { success: true, plants };
    } catch (err) {
      const plants = this.sort(this.getFallbackPlants());
      this._cachedPlants = plants.slice();
      return { success: true, plants, fallback: true };
    }
  }

  async getArticle(articleIdOrSlug) {
    const target = String(articleIdOrSlug || '').trim();
    if (!target) return { success: false, msg: 'articleId is required' };
    try {
      const res = await this.scfApiAdapter.getKnowledgeArticle(target);
      const article = res?.article ? normalizeArticle(res.article) : null;
      if (article?.status === 'published') return { success: true, article };
      return { success: false, article: null };
    } catch (err) {
      const article = this.getFallbackArticles().find((item) => String(item.id) === target || item.slug === target) || null;
      return { success: Boolean(article), article };
    }
  }

  async search(query, options = {}) {
    const text = String(query || options.query || '').trim();
    const result = await this.getArticles({ useCache: false });
    const articles = this.sort((result.articles || []).map((item) => {
      const score = scoreArticle(item, text, options);
      return score > 0 ? { ...item, score } : null;
    }).filter(Boolean)).slice(0, Math.max(1, Number(options.limit) || 20));
    return { success: true, articles, unknown: Boolean(text) && articles.length === 0 };
  }

  async searchPlants(query, options = {}) {
    const text = String(query || options.query || '').trim();
    const result = await this.getPlantProfiles({ useCache: false, query: text, limit: options.limit || 50 });
    const plants = this.sort((result.plants || []).map((item) => {
      const score = scorePlant(item, text);
      return score > 0 ? { ...item, score } : null;
    }).filter(Boolean)).slice(0, Math.max(1, Number(options.limit) || 50));
    return { success: true, plants, unknown: Boolean(text) && plants.length === 0 };
  }

  async getKnowledgeContext(payload = {}) {
    const result = await this.search(payload.query || '', payload);
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
}

const service = new KnowledgeService();
module.exports = service;
module.exports.KnowledgeService = KnowledgeService;
module.exports.normalizeArticle = normalizeArticle;
module.exports.normalizePlant = normalizePlant;
module.exports.scoreArticle = scoreArticle;
module.exports.scorePlant = scorePlant;
module.exports.onlyPublished = onlyPublished;
