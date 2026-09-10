const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNetworkError,
  shouldRetryNetworkFailure
} = require('./ScfApiAdapter');
const ScfApiAdapter = require('./ScfApiAdapter');

test('普通 POST 默认不自动重试，幂等 proposal 确认可显式开启', () => {
  assert.equal(shouldRetryNetworkFailure('GET'), true);
  assert.equal(shouldRetryNetworkFailure('HEAD'), true);
  assert.equal(shouldRetryNetworkFailure('POST'), false);
  assert.equal(shouldRetryNetworkFailure('POST', { retryNetworkErrors: true }), true);
  assert.equal(shouldRetryNetworkFailure('GET', { retryNetworkErrors: false }), false);
});

test('只对真实网络失败启用网络重试判断', () => {
  assert.equal(isNetworkError({ errMsg: 'request:fail timeout' }), true);
  assert.equal(isNetworkError({ message: 'HTTP 500' }), false);
  assert.equal(isNetworkError(new Error('validation failed')), false);
});

test('memory proposal adapter 使用三条受控 POST，并仅把 GET 入口收窄为 proposalKey', async () => {
  const adapter = new ScfApiAdapter();
  const calls = [];
  adapter.request = async (...args) => {
    calls.push(args);
    return { success: true };
  };

  await adapter.getMemoryProposal(' memory-owner-a-001 ');
  await adapter.confirmMemoryProposal({ proposalKey: 'memory-owner-a-001' });
  await adapter.dismissMemoryProposal({ proposalKey: 'memory-owner-a-001' });

  assert.deepEqual(calls, [
    ['/ai/memory-proposal', 'POST', { proposalKey: ' memory-owner-a-001 ' }, { retryNetworkErrors: true }],
    ['/ai/memory-proposal-confirm', 'POST', { proposalKey: 'memory-owner-a-001' }, { retryNetworkErrors: true }],
    ['/ai/memory-proposal-dismiss', 'POST', { proposalKey: 'memory-owner-a-001' }, { retryNetworkErrors: true }]
  ]);
});
