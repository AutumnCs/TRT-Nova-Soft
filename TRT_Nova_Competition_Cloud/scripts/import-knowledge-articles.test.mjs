import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const articles = require('../data/knowledge/articles.json');
const plants = require('../data/knowledge/plants.json');
const { normalizeArticle, normalizePlant, importContent } = require('./import-knowledge-articles.js');

test('M4 canonical content is traceable and carries the approved MVP publication record', () => {
  const normalizedArticles = articles.map(normalizeArticle);
  const normalizedPlants = plants.map(normalizePlant);
  assert.equal(normalizedArticles.length, 10);
  assert.equal(normalizedPlants.length, 17);
  assert.ok(normalizedArticles.every((item) => item.status === 'published'));
  assert.ok(normalizedPlants.every((item) => item.status === 'published'));
  assert.ok(normalizedArticles.every((item) => item.sourceUrl.startsWith('https://')));
  assert.ok(normalizedPlants.every((item) => item.sourceUrl.startsWith('https://')));
  assert.ok(normalizedArticles.every((item) => item.reviewedAt === '2026-08-27 18:23:54' && item.reviewedBy === 'dola'));
  assert.ok(normalizedPlants.every((item) => item.reviewedAt === '2026-08-27 18:23:54' && item.reviewedBy === 'dola'));
});

test('importer blocks published content without reviewer evidence', () => {
  assert.throws(
    () => normalizeArticle({
      ...articles[0],
      status: 'published',
      reviewedAt: '',
      reviewedBy: ''
    }),
    /cannot be published without reviewedAt\/reviewedBy/
  );
});

test('import SQL placeholders match normalized values', async () => {
  const normalizedArticles = articles.map(normalizeArticle);
  const normalizedPlants = plants.map(normalizePlant);
  const calls = [];
  const conn = {
    execute: async (sql, values = []) => {
      const placeholderCount = (sql.match(/\?/g) || []).length;
      assert.equal(placeholderCount, values.length, sql.split(/\r?\n/)[0]);
      calls.push(sql);
      if (/SELECT id FROM plant_library/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  await importContent(conn, { articles: normalizedArticles, plants: normalizedPlants });
  assert.equal(calls.filter((sql) => /INSERT INTO knowledge_articles/.test(sql)).length, 10);
  assert.equal(calls.filter((sql) => /INSERT INTO plant_library/.test(sql)).length, 17);
});
