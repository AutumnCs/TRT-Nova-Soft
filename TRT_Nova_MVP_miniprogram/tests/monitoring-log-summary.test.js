const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLogLines,
  summarizeLogs,
  classifySeverity
} = require('../scripts/monitoring-log-summary.js');

test('parseLogLines keeps only valid JSON monitoring records', () => {
  const records = parseLogLines(`
{"level":"info","service":"api-scf","event":"device_command_sent","ts":1}
not-json
{"level":"error","service":"api-scf","event":"request_failed","ts":2,"path":"/device/latest","message":"db down"}
`);

  assert.equal(records.length, 2);
  assert.equal(records[0].event, 'device_command_sent');
  assert.equal(records[1].event, 'request_failed');
});

test('summarizeLogs aggregates key monitoring issues and samples', () => {
  const records = parseLogLines(`
{"level":"error","service":"api-scf","event":"request_failed","ts":11,"path":"/device/latest","message":"db down"}
{"level":"error","service":"ingest-scf","event":"push_processing_failed","ts":12,"message":"insert failed"}
{"level":"info","service":"api-scf","event":"device_command_failed","ts":13,"commandId":"cmd-1","logicalKey":"p1::d1","message":"timeout"}
{"level":"info","service":"history-cleanup-scf","event":"cleanup_alerts_detected","ts":14,"alerts":{"offlineDevices":{"count":2,"sample":[{"logicalKey":"p1::d1"}]},"laggingCommands":{"count":1,"sample":[{"commandId":"cmd-2"}]}}}
`);

  const summary = summarizeLogs(records);

  assert.equal(summary.issues.requestFailed, 1);
  assert.equal(summary.issues.ingestFailed, 1);
  assert.equal(summary.issues.commandFailed, 1);
  assert.equal(summary.issues.offlineDevices, 2);
  assert.equal(summary.issues.laggingCommands, 1);
  assert.equal(summary.status.requestFailed, 'warn');
  assert.equal(summary.status.offlineDevices, 'warn');
  assert.equal(summary.overall, 'warn');
  assert.equal(summary.samples.requestFailed[0].path, '/device/latest');
  assert.equal(summary.samples.laggingCommands[0].commandId, 'cmd-2');
});

test('classifySeverity distinguishes ok warn critical', () => {
  assert.equal(classifySeverity(0, 1, 5), 'ok');
  assert.equal(classifySeverity(1, 1, 5), 'warn');
  assert.equal(classifySeverity(5, 1, 5), 'critical');
});
