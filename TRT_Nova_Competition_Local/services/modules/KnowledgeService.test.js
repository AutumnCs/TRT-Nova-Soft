const test = require('node:test');
const assert = require('node:assert/strict');

const { KnowledgeService, normalizeArticle } = require('./KnowledgeService');

test('mini program knowledge service defaults missing status to draft', () => {
  assert.equal(normalizeArticle({ title: '草稿' }).status, 'draft');
});

test('mini program knowledge service preserves successful empty API results', async () => {
  const service = new KnowledgeService({
    getKnowledgeArticles: async () => ({ success: true, articles: [] }),
    getKnowledgePlants: async () => ({ success: true, plants: [] })
  });
  assert.deepEqual((await service.getArticles()).articles, []);
  assert.deepEqual((await service.getPlantProfiles()).plants, []);
});

test('mini program knowledge search returns unknown for an unmatched query', async () => {
  const service = new KnowledgeService({
    getKnowledgeArticles: async () => ({
      success: true,
      articles: [{ id: 1, title: '月季浇水', content: '观察盆土', status: 'published' }]
    })
  });
  const result = await service.search('火星土壤传送门');
  assert.equal(result.unknown, true);
  assert.deepEqual(result.articles, []);
});

test('mini program natural question matches a general article for a specific plant', async () => {
  const service = new KnowledgeService({
    getKnowledgeArticles: async () => ({
      success: true,
      articles: [{
        id: 1,
        title: '浇水先看盆土',
        content: '根据盆土判断',
        tags: ['浇水'],
        plantTypes: [],
        status: 'published'
      }]
    })
  });
  const result = await service.search('我的月季现在要不要浇水？', { plantType: '月季' });
  assert.equal(result.unknown, false);
  assert.equal(result.articles.length, 1);
});
