const test = require('node:test');
const assert = require('node:assert/strict');

const knowledge = require('../knowledge');

test('knowledge defaults missing status to draft', () => {
  const article = knowledge.normalizeSeedArticle({ title: '未审核内容' });
  const plant = knowledge.normalizeSeedPlant({ name: '未审核植物' });
  assert.equal(article.status, 'draft');
  assert.equal(plant.status, 'draft');
});

test('a successful empty database result never falls back to seed content', async () => {
  const db = { execute: async () => [[]] };
  assert.deepEqual(await knowledge.loadArticles(db), []);
  assert.deepEqual(await knowledge.loadPlants(db), []);
});

test('database rows are defensively filtered to published content', async () => {
  const db = {
    execute: async () => [[
      { id: 1, slug: 'draft', title: '草稿', status: 'draft' },
      {
        id: 2,
        slug: 'published',
        title: '已发布',
        status: 'published',
        source_title: 'Source title',
        source_publisher: 'Publisher',
        source_url: 'https://example.com/source',
        source_id: 'SOURCE-2',
        content_updated_at: '2026-08-27'
      }
    ]]
  };
  const articles = await knowledge.loadArticles(db);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].slug, 'published');
  assert.equal(articles[0].sourcePublisher, 'Publisher');
  assert.equal(articles[0].sourceUrl, 'https://example.com/source');
});

test('an unmatched query is reported as unknown instead of returning sorted content', async () => {
  const db = {
    execute: async () => [[{
      id: 1,
      slug: 'watering',
      title: '观察盆土后浇水',
      summary: '先观察',
      content: '根据盆土判断',
      status: 'published',
      sort_order: 1
    }]]
  };
  const result = await knowledge.searchKnowledgeArticles(db, { query: '火星土壤传送门' });
  assert.equal(result.unknown, true);
  assert.deepEqual(result.articles, []);
});

test('a natural question matches a relevant term and keeps cross-plant articles eligible', async () => {
  const db = {
    execute: async () => [[{
      id: 1,
      slug: 'watering',
      title: '浇水先看盆土',
      summary: '先观察',
      content: '根据盆土判断',
      tags_json: '["浇水"]',
      plant_types_json: '[]',
      status: 'published',
      sort_order: 1
    }]]
  };
  const result = await knowledge.searchKnowledgeArticles(db, {
    query: '我的月季现在要不要浇水？',
    plantType: '月季'
  });
  assert.equal(result.unknown, false);
  assert.equal(result.articles[0].slug, 'watering');
});
