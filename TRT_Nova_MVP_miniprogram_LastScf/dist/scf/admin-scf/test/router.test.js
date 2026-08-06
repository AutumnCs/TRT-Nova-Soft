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

test('admin router exposes read-only operational summaries', async () => {
  const router = createAdminRouter({
    auth: { authenticate: async () => ({ ok: true }) },
    knowledge: {},
    devices: { getSummary: async () => ({ total: 1, online: 1, abnormal: 0 }) },
    users: { listUsers: async () => ({ success: true, users: [{ id: 1 }] }) },
    logs: { listLogs: async () => ({ success: true, logs: [{ id: 1 }] }) }
  });

  const devices = await router.handle({ httpMethod: 'GET', path: '/admin/devices' });
  const users = await router.handle({ httpMethod: 'GET', path: '/admin/users' });
  const logs = await router.handle({ httpMethod: 'GET', path: '/admin/logs' });
  assert.equal(devices.statusCode, 200);
  assert.equal(JSON.parse(devices.body).online, 1);
  assert.equal(JSON.parse(users.body).users.length, 1);
  assert.equal(JSON.parse(logs.body).logs.length, 1);
});
