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
