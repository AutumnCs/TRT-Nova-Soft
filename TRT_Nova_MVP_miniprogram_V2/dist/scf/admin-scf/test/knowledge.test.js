import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeService } from '../lib/knowledgeService.js';

test('knowledge service lists seed articles when the database is empty', async () => {
  const service = createKnowledgeService({
    repository: {
      listArticles: async () => []
    },
    seedArticles: [
      { id: 1, slug: 'watering-basics', title: 'watering-basics' }
    ]
  });

  const result = await service.listArticles();
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].slug, 'watering-basics');
});
