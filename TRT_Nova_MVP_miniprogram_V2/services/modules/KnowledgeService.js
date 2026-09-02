const ScfApiAdapter = require('../core/ScfApiAdapter');

let seedArticles = [];
try {
  // Keep a local copy so the knowledge page still has content when SCF is down.
  seedArticles = require('../../data/knowledge/articles.json');
} catch (err) {
  seedArticles = [];
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeArticle(article = {}) {
  return {
    id: Number(article.id) || 0,
    slug: String(article.slug || '').trim(),
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim(),
    content: String(article.content || '').trim(),
    category: String(article.category || 'general').trim() || 'general',
    tags: toArray(article.tags),
    aliases: toArray(article.aliases),
    plantTypes: toArray(article.plantTypes || article.plant_types),
    problemTypes: toArray(article.problemTypes || article.problem_types),
    sourceType: String(article.sourceType || article.source_type || 'seed').trim() || 'seed',
    sourceRef: String(article.sourceRef || article.source_ref || '').trim(),
    status: String(article.status || 'published').trim() || 'published',
    sortOrder: Number(article.sortOrder || article.sort_order) || 0,
    score: Number(article.score) || 0,
    excerpt: String(article.excerpt || '').trim()
  };
}

function getSearchText(article = {}) {
  return [
    article.title,
    article.summary,
    article.content,
    article.category,
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(article.aliases) ? article.aliases : []),
    ...(Array.isArray(article.plantTypes) ? article.plantTypes : []),
    ...(Array.isArray(article.problemTypes) ? article.problemTypes : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreArticle(article, query = '', filters = {}) {
  const text = String(query || '').trim().toLowerCase();
  let score = 0;
  const haystack = getSearchText(article);

  if (text) {
    if ((article.title || '').toLowerCase().includes(text)) score += 100;
    if ((article.summary || '').toLowerCase().includes(text)) score += 60;
    if ((article.aliases || []).some((item) => item.toLowerCase().includes(text))) score += 45;
    if ((article.tags || []).some((item) => item.toLowerCase().includes(text))) score += 40;
    if ((article.plantTypes || []).some((item) => item.toLowerCase().includes(text))) score += 25;
    if ((article.problemTypes || []).some((item) => item.toLowerCase().includes(text))) score += 20;
    if ((article.content || '').toLowerCase().includes(text)) score += 10;
    if (!score && haystack.includes(text)) score += 5;
  } else {
    score += 1;
  }

  const category = String(filters.category || '').trim();
  const tag = String(filters.tag || '').trim().toLowerCase();
  const plantType = String(filters.plantType || '').trim().toLowerCase();

  if (category && String(article.category || '').toLowerCase() !== category.toLowerCase()) {
    return 0;
  }

  if (tag && !(article.tags || []).some((item) => item.toLowerCase() === tag || item.toLowerCase().includes(tag))) {
    return 0;
  }

  if (plantType && !(article.plantTypes || []).some((item) => item.toLowerCase() === plantType || item.toLowerCase().includes(plantType))) {
    return 0;
  }

  return score + Math.max(0, 500 - Number(article.sortOrder || 0));
}

class KnowledgeService {
  constructor() {
    this.scfApiAdapter = new ScfApiAdapter();
    this._cachedArticles = [];
  }

  getFallbackArticles() {
    return (Array.isArray(seedArticles) ? seedArticles : []).map((item) => normalizeArticle(item));
  }

  sortArticles(articles = []) {
    return (Array.isArray(articles) ? articles : [])
      .slice()
      .sort((a, b) => {
        if (Number(b.score || 0) !== Number(a.score || 0)) {
          return Number(b.score || 0) - Number(a.score || 0);
        }
        if (Number(a.sortOrder || 0) !== Number(b.sortOrder || 0)) {
          return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        }
        return Number(a.id || 0) - Number(b.id || 0);
      });
  }

  normalizeResponseArticle(article = {}) {
    return normalizeArticle(article);
  }

  async getArticles(options = {}) {
    const useCache = Boolean(options.useCache);
    if (useCache && this._cachedArticles.length > 0) {
      return {
        success: true,
        articles: this._cachedArticles.slice()
      };
    }

    try {
      const res = await this.scfApiAdapter.getKnowledgeArticles(options);
      const articles = Array.isArray(res?.articles) && res.articles.length
        ? res.articles.map((item) => normalizeArticle(item))
        : this.getFallbackArticles();
      const sorted = this.sortArticles(articles);
      this._cachedArticles = sorted.slice();
      return { success: true, articles: sorted };
    } catch (err) {
      const articles = this.sortArticles(this.getFallbackArticles());
      this._cachedArticles = articles.slice();
      return { success: true, articles };
    }
  }

  async getCategories() {
    const res = await this.getArticles({ useCache: false });
    const categories = Array.from(new Set((res.articles || []).map((item) => item.category).filter(Boolean)));
    return {
      success: true,
      categories
    };
  }

  async getArticle(articleIdOrSlug) {
    const target = String(articleIdOrSlug || '').trim();
    if (!target) {
      return { success: false, msg: 'articleId is required' };
    }

    try {
      const res = await this.scfApiAdapter.getKnowledgeArticle(target);
      const article = res?.article ? normalizeArticle(res.article) : null;
      if (article) {
        return { success: true, article };
      }
    } catch (err) {
      // fall back below
    }

    const articles = await this.getArticles({ useCache: false });
    const article = (articles.articles || []).find((item) =>
      String(item.id) === target || String(item.slug) === target
    ) || null;

    return {
      success: Boolean(article),
      article: article ? normalizeArticle(article) : null
    };
  }

  async search(query, options = {}) {
    const text = String(query || options.query || '').trim();
    const filters = {
      category: String(options.category || '').trim(),
      tag: String(options.tag || '').trim(),
      plantType: String(options.plantType || '').trim()
    };
    const limit = Math.max(1, Number(options.limit) || 20);

    const res = await this.getArticles({ useCache: false });
    const matches = (res.articles || [])
      .map((item) => {
        const score = scoreArticle(item, text, filters);
        return score > 0 ? { ...item, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.id - b.id;
      })
      .slice(0, limit);

    return {
      success: true,
      articles: matches
    };
  }

  async recommend(plantType, options = {}) {
    const text = String(plantType || options.plantType || '').trim();
    if (!text) {
      return this.search('', { ...options, limit: options.limit || 8 });
    }
    return this.search(text, { ...options, plantType: text, limit: options.limit || 8 });
  }

  async getKnowledgeContext(payload = {}) {
    const query = String(payload.query || '').trim();
    const limit = Math.max(1, Number(payload.limit) || 4);
    const searchResult = await this.search(query, {
      category: payload.category || '',
      tag: payload.tag || '',
      plantType: payload.plantType || '',
      limit
    });
    const articles = searchResult.articles || [];
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
}

module.exports = new KnowledgeService();
