const test = require('node:test');
const assert = require('node:assert/strict');

const { searchKnowledgeArticles, searchKnowledgeBundle } = require('../rag/knowledgeSearch');

test('agent RAG preserves an empty database result', async () => {
  const db = {
    execute: async () => [[]],
    query: async () => [[]]
  };
  const result = await searchKnowledgeBundle(db, { query: '月季怎么浇水' });
  assert.deepEqual(result.hits, []);
  assert.equal(result.contextText, '');
  assert.equal(result.unknown, true);
});

test('agent RAG excludes drafts and reports unmatched queries as unknown', async () => {
  const db = {
    execute: async () => [[{
      id: 1,
      slug: 'draft-only',
      title: '草稿文章',
      status: 'draft',
      sort_order: 1
    }]]
  };
  const result = await searchKnowledgeArticles(db, { query: '草稿' });
  assert.deepEqual(result, []);
});

test('agent RAG returns readable provenance for a published match', async () => {
  const db = {
    execute: async () => [[{
      id: 2,
      slug: 'rose-watering',
      title: '月季浇水',
      summary: '观察盆土',
      content: '浇透后排掉积水。',
      category: 'plant-care',
      tags_json: '["月季","浇水"]',
      source_title: 'Rosa',
      source_publisher: 'NC State Extension',
      source_url: 'https://plants.ces.ncsu.edu/plants/rosa/common-name/rose/',
      source_id: 'NCSU-ROSA',
      content_updated_at: '2026-08-27',
      reviewed_at: '2026-08-27 12:00:00',
      reviewed_by: 'C',
      status: 'published',
      sort_order: 1
    }]]
  };
  const result = await searchKnowledgeArticles(db, { query: '我的月季应该怎么浇水？', plantType: '月季' });
  assert.equal(result.length, 1);
  assert.equal(result[0].sourcePublisher, 'NC State Extension');
  assert.match(result[0].source, /^https:\/\//);
});
