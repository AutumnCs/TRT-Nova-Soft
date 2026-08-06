import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShellPayload, createAdminRouter } from '../lib/router.js';

test('admin router exposes a handle function', () => {
  const router = createAdminRouter({ auth: {}, knowledge: {}, devices: {}, users: {}, logs: {} });
  assert.equal(typeof router.handle, 'function');
});

test('admin shell payload exposes expected Chinese metric labels', () => {
  const payload = buildShellPayload();
  assert.deepEqual(payload.metrics.map((item) => item.label), ['知识文章', '在线设备', '活跃用户', '今日日志']);
});

test('admin router delegates knowledge article listing to the service', async () => {
  const router = createAdminRouter({
    auth: { authenticate: async () => ({ ok: true }) },
    knowledge: { listArticles: async () => ({ success: true, articles: [{ slug: 'watering-basics' }] }) },
    devices: {},
    users: {},
    logs: {}
  });

  const response = await router.handle({ httpMethod: 'GET', path: '/admin/knowledge/articles' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).articles, [{ slug: 'watering-basics' }]);
});
