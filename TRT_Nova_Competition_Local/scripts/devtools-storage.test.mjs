import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import storage from './local-server/devtools-storage.js';

function environment(initial) {
  const values = new Map(Object.entries(initial));
  const context = vm.createContext({ wx: {
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    getStorageSync: (key) => structuredClone(values.get(key)),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    clearStorageSync: () => values.clear()
  }});
  return { values, context, evaluate: (fn, argument) => {
    context.argument = argument;
    return vm.runInContext(`(${fn.toString()})(argument)`, context);
  }};
}

test('测试缓存恢复保留登录态、草稿和假值，只移除测试新增键', () => {
  const before = { login: 'fixture-token', draft: { text: '未发送', images: ['fixture-image'] }, zero: 0, flag: false, empty: '', nil: null };
  const env = environment(before);
  const snapshot = env.evaluate(storage.captureStorage);
  env.values.clear();
  env.values.set('temporary_test_key', 'temporary');
  assert.equal(env.evaluate(storage.restoreStorage, snapshot), Object.keys(before).length);
  assert.deepEqual(Object.fromEntries(env.values), before);
});

test('缺失或损坏的快照不得清空现有缓存', () => {
  const env = environment({ draft: 'preserve' });
  for (const bad of [null, {}, [{ key: 'draft' }]]) {
    assert.throws(() => env.evaluate(storage.restoreStorage, bad), /无有效缓存快照/);
    assert.equal(env.values.get('draft'), 'preserve');
  }
});

test('原来为空的缓存也会清理测试遗留键', () => {
  const env = environment({});
  const snapshot = env.evaluate(storage.captureStorage);
  env.values.set('test', 'test');
  assert.equal(env.evaluate(storage.restoreStorage, snapshot), 0);
  assert.equal(env.values.size, 0);
});

test('GUI 脚本先留快照再清缓存，在 finally 恢复且不把快照写盘', () => {
  const code = readFileSync(new URL('./local-server/m7-devtools-e2e.js', import.meta.url), 'utf8');
  const clearIndex = code.indexOf('evaluate(() => wx.clearStorageSync())');
  assert.ok(clearIndex > code.indexOf('evaluate(captureStorage)') && code.indexOf('evaluate(captureStorage)') >= 0);
  const cleanup = code.slice(code.lastIndexOf('} finally {'));
  assert.match(cleanup, /evaluate\(restoreStorage, originalStorage\)/);
  assert.doesNotMatch(cleanup, /callWxMethod\('clearStorageSync'\)/);
  assert.doesNotMatch(code, /JSON\.stringify\(originalStorage|console\.[a-z]+\([^\n]*originalStorage/);
});
