import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeRepository } from '../lib/knowledgeRepository.js';
import { createKnowledgeService } from '../lib/knowledgeService.js';

test('knowledge service preserves an empty database result instead of publishing seed drafts', async () => {
  const service = createKnowledgeService({
    repository: {
      listArticles: async () => []
    },
    seedArticles: [
      { id: 1, slug: 'watering-basics', title: 'watering-basics' }
    ]
  });

  const result = await service.listArticles();
  assert.equal(result.articles.length, 0);
  assert.equal(result.source, 'database');
});

test('knowledge service defaults new content to draft and blocks unreviewed publication', async () => {
  const service = createKnowledgeService({
    repository: {
      saveArticle: async (article) => article
    }
  });

  const draft = await service.saveArticle({ slug: 'watering-basics', title: '浇水基础' });
  assert.equal(draft.article.status, 'draft');
  await assert.rejects(
    service.saveArticle({ slug: 'unsafe-publish', status: 'published' }),
    /requires reviewedAt and reviewedBy/
  );
});

test('knowledge repository persists provenance and review fields with matching SQL parameters', async () => {
  const calls = [];
  const repository = createKnowledgeRepository({
    db: {
      execute: async (sql, values = []) => {
        assert.equal((sql.match(/\?/g) || []).length, values.length);
        calls.push({ sql, values });
        if (/^\s*SELECT/.test(sql)) return [[{
          id: 1,
          slug: 'reviewed-article',
          title: '审核文章',
          status: 'published',
          source_publisher: 'Extension',
          source_url: 'https://example.com/source',
          reviewed_by: 'C'
        }]];
        return [{ insertId: 1, affectedRows: 1 }];
      }
    }
  });

  const article = await repository.saveArticle({
    slug: 'reviewed-article',
    title: '审核文章',
    summary: '摘要',
    content: '正文',
    category: 'plant-care',
    tags: [],
    aliases: [],
    plantTypes: [],
    problemTypes: [],
    sourceType: 'external-reference',
    sourceRef: 'SRC',
    sourceTitle: 'Source',
    sourcePublisher: 'Extension',
    sourceUpdatedAt: '2026',
    sourceUrl: 'https://example.com/source',
    sourceId: 'SRC-1',
    contentUpdatedAt: '2026-08-27',
    reviewedAt: '2026-08-27 12:00:00',
    reviewedBy: 'C',
    imageLicense: '仓库占位图',
    imageSourceUrl: '',
    status: 'published',
    sortOrder: 1
  });
  assert.equal(article.sourcePublisher, 'Extension');
  assert.equal(article.reviewedBy, 'C');
  assert.equal(calls.length, 2);
});
