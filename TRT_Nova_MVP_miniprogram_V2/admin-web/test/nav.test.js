import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminNav } from '../lib/nav.js';

test('admin nav exposes the first-release modules', () => {
  const nav = buildAdminNav();
  assert.deepEqual(nav.map((item) => item.id), ['overview', 'knowledge', 'devices', 'users', 'logs']);
  assert.deepEqual(nav.map((item) => item.label), ['总览', '知识库', '设备', '用户', '日志']);
});
