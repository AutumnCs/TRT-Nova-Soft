function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
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
    createdAt: article.createdAt || article.created_at || null,
    updatedAt: article.updatedAt || article.updated_at || null
  };
}

export function createKnowledgeService({ repository, seedArticles = [] } = {}) {
  const fallback = () => seedArticles.map(normalizeArticle);

  return {
    normalizeArticle,

    async listArticles(options = {}) {
      try {
        const articles = await repository?.listArticles(options);
        if (Array.isArray(articles) && articles.length) {
          return { success: true, articles: articles.map(normalizeArticle), source: 'database' };
        }
      } catch {
        // Read paths may use the seed while the database is unavailable.
      }
      return { success: true, articles: fallback(), source: 'seed' };
    },

    async getArticle(idOrSlug) {
      try {
        const article = await repository?.getArticle(idOrSlug);
        if (article) return { success: true, article: normalizeArticle(article), source: 'database' };
      } catch {
        // Fall through to seed lookup.
      }
      const article = fallback().find((item) => String(item.id) === String(idOrSlug) || item.slug === String(idOrSlug)) || null;
      return { success: Boolean(article), article, source: 'seed' };
    },

    async saveArticle(article) {
      if (!repository?.saveArticle) throw new Error('knowledge repository does not support save');
      return { success: true, article: normalizeArticle(await repository.saveArticle(normalizeArticle(article))), source: 'database' };
    },

    async deleteArticle(idOrSlug) {
      if (!repository?.deleteArticle) throw new Error('knowledge repository does not support delete');
      return { success: await repository.deleteArticle(idOrSlug), source: 'database' };
    }
  };
}
