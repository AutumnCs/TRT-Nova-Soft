const test = require('node:test');
const assert = require('node:assert/strict');

const loadSmoke = require('../scripts/runtime-load-smoke.js');

test('parseArgs accepts core load smoke options', () => {
  const parsed = loadSmoke.parseArgs([
    '--url', 'http://127.0.0.1:18080/runtime/device/latest',
    '--method', 'post',
    '--body-file', './reference/runtime-device-latest.sample.json',
    '--concurrency', '12',
    '--requests', '120',
    '--warmup-requests', '20',
    '--timeout-ms', '2500',
    '--header', 'X-Request-Id: demo',
    '--pretty'
  ]);

  assert.equal(parsed.url, 'http://127.0.0.1:18080/runtime/device/latest');
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.bodyFile, './reference/runtime-device-latest.sample.json');
  assert.equal(parsed.concurrency, 12);
  assert.equal(parsed.requests, 120);
  assert.equal(parsed.warmupRequests, 20);
  assert.equal(parsed.timeoutMs, 2500);
  assert.equal(parsed.headers['X-Request-Id'], 'demo');
  assert.equal(parsed.pretty, true);
});

test('summarizeResults computes latency and status aggregates', () => {
  const summary = loadSmoke.summarizeResults(
    {
      url: 'http://127.0.0.1:18080/runtime/device/latest',
      method: 'POST',
      concurrency: 5
    },
    'measured',
    [
      { ok: true, statusCode: 200, timedOut: false, durationMs: 40 },
      { ok: true, statusCode: 200, timedOut: false, durationMs: 60 },
      { ok: false, statusCode: 504, timedOut: true, durationMs: 3000 },
      { ok: false, statusCode: 500, timedOut: false, durationMs: 120 }
    ],
    4000
  );

  assert.equal(summary.phase, 'measured');
  assert.equal(summary.success, 2);
  assert.equal(summary.failures, 2);
  assert.equal(summary.timeouts, 1);
  assert.equal(summary.non2xx, 2);
  assert.equal(summary.statusCodes['200'], 2);
  assert.equal(summary.statusCodes['500'], 1);
  assert.equal(summary.statusCodes['504'], 1);
  assert.equal(summary.latencyMs.min, 40);
  assert.equal(summary.latencyMs.max, 3000);
  assert.equal(summary.latencyMs.p50, 60);
  assert.equal(summary.latencyMs.p95, 3000);
});
