function json(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function mapArticle(row = {}) {
  const parse = (value) => {
    if (Array.isArray(value)) return value;
    try {
      return value ? JSON.parse(value) : [];
    } catch {
      return [];
    }
  };

  return {
    id: row.id || 0,
    slug: row.slug || '',
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    category: row.category || 'general',
    tags: parse(row.tags_json),
    aliases: parse(row.aliases_json),
    plantTypes: parse(row.plant_types_json),
    problemTypes: parse(row.problem_types_json),
    sourceType: row.source_type || 'admin',
    sourceRef: row.source_ref || '',
    sourceTitle: row.source_title || '',
    sourcePublisher: row.source_publisher || '',
    sourceUpdatedAt: row.source_updated_at || '',
    sourceUrl: row.source_url || '',
    sourceId: row.source_id || '',
    contentUpdatedAt: row.content_updated_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || '',
    imageLicense: row.image_license || '',
    imageSourceUrl: row.image_source_url || '',
    status: row.status || 'draft',
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export function createKnowledgeRepository({ db }) {
  if (!db || typeof db.execute !== 'function') {
    throw new Error('knowledge repository requires a db.execute function');
  }

  return {
    async listArticles({ includeDrafts = true } = {}) {
      const where = includeDrafts ? '' : "WHERE status = 'published'";
      const [rows] = await db.execute(
        `SELECT id, slug, title, summary, content, category, tags_json, aliases_json,
                plant_types_json, problem_types_json, source_type, source_ref, source_title,
                source_publisher, source_updated_at, source_url, source_id, content_updated_at,
                reviewed_at, reviewed_by, image_license, image_source_url, status,
                sort_order, created_at, updated_at
         FROM knowledge_articles ${where}
         ORDER BY sort_order ASC, id ASC`
      );
      return rows.map(mapArticle);
    },

    async getArticle(idOrSlug) {
      const [rows] = await db.execute(
        `SELECT id, slug, title, summary, content, category, tags_json, aliases_json,
                plant_types_json, problem_types_json, source_type, source_ref, source_title,
                source_publisher, source_updated_at, source_url, source_id, content_updated_at,
                reviewed_at, reviewed_by, image_license, image_source_url, status,
                sort_order, created_at, updated_at
         FROM knowledge_articles WHERE id = ? OR slug = ? LIMIT 1`,
        [idOrSlug, String(idOrSlug)]
      );
      return rows.length ? mapArticle(rows[0]) : null;
    },

    async saveArticle(article) {
      const [result] = await db.execute(
        `INSERT INTO knowledge_articles
          (slug, title, summary, content, category, tags_json, aliases_json,
           plant_types_json, problem_types_json, source_type, source_ref, source_title,
           source_publisher, source_updated_at, source_url, source_id, content_updated_at,
           reviewed_at, reviewed_by, image_license, image_source_url, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title), summary = VALUES(summary), content = VALUES(content),
           category = VALUES(category), tags_json = VALUES(tags_json),
           aliases_json = VALUES(aliases_json), plant_types_json = VALUES(plant_types_json),
           problem_types_json = VALUES(problem_types_json), source_type = VALUES(source_type),
           source_ref = VALUES(source_ref), source_title = VALUES(source_title),
           source_publisher = VALUES(source_publisher), source_updated_at = VALUES(source_updated_at),
           source_url = VALUES(source_url), source_id = VALUES(source_id),
           content_updated_at = VALUES(content_updated_at), reviewed_at = VALUES(reviewed_at),
           reviewed_by = VALUES(reviewed_by), image_license = VALUES(image_license),
           image_source_url = VALUES(image_source_url), status = VALUES(status),
           sort_order = VALUES(sort_order), updated_at = CURRENT_TIMESTAMP`,
        [article.slug, article.title, article.summary, article.content, article.category,
          json(article.tags), json(article.aliases), json(article.plantTypes),
          json(article.problemTypes), article.sourceType, article.sourceRef,
          article.sourceTitle, article.sourcePublisher, article.sourceUpdatedAt,
          article.sourceUrl, article.sourceId, article.contentUpdatedAt,
          article.reviewedAt, article.reviewedBy, article.imageLicense,
          article.imageSourceUrl, article.status, article.sortOrder]
      );
      return this.getArticle(result.insertId || article.slug);
    },

    async deleteArticle(idOrSlug) {
      const [result] = await db.execute(
        'DELETE FROM knowledge_articles WHERE id = ? OR slug = ?',
        [idOrSlug, String(idOrSlug)]
      );
      return result.affectedRows > 0;
    }
  };
}
