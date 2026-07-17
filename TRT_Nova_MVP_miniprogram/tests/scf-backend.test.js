const test = require('node:test');
const assert = require('node:assert/strict');

const apiScf = require('../dist/scf/api-scf/index.js');
const ingestScf = require('../dist/scf/ingest-scf/index.js');
const historyCleanupScf = require('../dist/scf/history-cleanup-scf/index.js');
const apiRuntimeCache = require('../dist/scf/api-scf/lib/runtimeCache.js');
const ingestRuntimeCache = require('../dist/scf/ingest-scf/lib/runtimeCache.js');
const runtimeConfig = require('../services/config/runtime.js');
const runtimeProfiles = require('../services/config/runtimeProfiles.js');

test('deriveDeviceOnlineState marks recent latest row online', () => {
  const recent = Date.now() - 30 * 1000;
  const state = apiScf.__test__.deriveDeviceOnlineState(recent, true);

  assert.equal(state.online, true);
  assert.equal(state.offline, false);
  assert.equal(state.status, 'online');
  assert.equal(state.lastSeenAt, recent);
  assert.equal(state.offlineSinceMs, null);
});

test('deriveDeviceOnlineState marks stale latest row offline', () => {
  const stale = Date.now() - 11 * 60 * 1000;
  const state = apiScf.__test__.deriveDeviceOnlineState(stale, true);

  assert.equal(state.online, false);
  assert.equal(state.offline, true);
  assert.equal(state.status, 'offline');
  assert.ok(state.offlineSinceMs >= stale);
});

test('buildLatestAggregates exposes frontend-ready sensor and control snapshots', () => {
  const aggregated = apiScf.__test__.buildLatestAggregates({
    params: {
      dht_temp: { value: 24.6, time: 1710000000000 },
      dht_humi: { value: 61, time: 1710000001000 },
      soil_percent: { value: 48, time: 1710000002000 },
      test: { value: true, time: 1710000003000 },
      ir_status: { value: false, time: 1710000004000 },
      plant_type: { value: '绿萝', time: 1710000005000 }
    },
    latestCommand: {
      commandId: 'cmd-1',
      status: 'sent'
    },
    plantType: '默认植物',
    updatedAt: 1710000006000,
    lastSeenAt: 1710000006000,
    onlineStatus: 'online'
  });

  assert.equal(aggregated.sensorSnapshot.temp.value, 24.6);
  assert.equal(aggregated.sensorSnapshot.humidity.value, 61);
  assert.equal(aggregated.sensorSnapshot.soil.value, 48);
  assert.equal(aggregated.controlSnapshot.fan.reportedState, true);
  assert.equal(aggregated.controlSnapshot.fan.pending, true);
  assert.equal(aggregated.plantSnapshot.irStatus, false);
  assert.equal(aggregated.plantSnapshot.soulState, '出窝');
  assert.equal(aggregated.plantSnapshot.reportedPlantType, '绿萝');
  assert.equal(aggregated.displaySnapshot.onlineStatusText, '在线');
});

test('mergeLatestRowWithCache prefers fresher runtime cache state without breaking offline rules', () => {
  const merged = apiScf.__test__.mergeLatestRowWithCache(
    {
      logicalKey: 'p1::d1',
      provider: 'onenet',
      productId: 'p1',
      deviceName: 'd1',
      params: { soil_percent: { value: 20, time: 1710000000000 } },
      updatedAt: Date.now() - 60 * 1000,
      hasLatest: true,
      online: true,
      offline: false,
      onlineStatus: 'online',
      lastSeenAt: Date.now() - 60 * 1000,
      offlineSinceMs: null,
      latestCommand: { commandId: 'cmd-old', status: 'done' }
    },
    {
      latest: {
        provider: 'emqx',
        updatedAt: Date.now() - 5 * 1000,
        params: { soil_percent: { value: 35, time: 1710000005000 } }
      },
      online: {
        online: true,
        offline: false,
        onlineStatus: 'online',
        lastSeenAt: Date.now() - 5 * 1000
      },
      command: {
        commandId: 'cmd-new',
        status: 'sent'
      }
    }
  );

  assert.equal(merged.provider, 'emqx');
  assert.equal(merged.params.soil_percent.value, 35);
  assert.equal(merged.latestCommand.commandId, 'cmd-new');
  assert.equal(merged.latestCommand.status, 'sent');
  assert.equal(merged.online, true);
  assert.equal(merged.onlineStatus, 'online');
});

test('mergeCommandRowWithCache prefers fresher runtime command state', () => {
  const merged = apiScf.__test__.mergeCommandRowWithCache(
    {
      commandId: 'cmd-1',
      logicalKey: 'p1::d1',
      provider: 'onenet',
      status: 'pending',
      errorMessage: '',
      sentParams: { test: true },
      latestSnapshot: { test: false },
      requestedAt: 1710000000000,
      sentAt: null,
      ackedAt: null,
      doneAt: null,
      failedAt: null
    },
    {
      commandId: 'cmd-1',
      logicalKey: 'p1::d1',
      provider: 'emqx',
      status: 'sent',
      sentAt: 1710000001000,
      sentParams: { test: false },
      errorMessage: ''
    }
  );

  assert.equal(merged.provider, 'emqx');
  assert.equal(merged.status, 'sent');
  assert.equal(merged.sentAt, 1710000001000);
  assert.equal(merged.sentParams.test, false);
});

test('cache usage summaries count hits and misses correctly', () => {
  const latestSummary = apiScf.__test__.summarizeLatestCacheUsage(
    ['a', 'b'],
    {
      a: { latest: { ok: true }, online: { ok: true } },
      b: { command: { ok: true } }
    }
  );
  const commandSummary = apiScf.__test__.summarizeCommandCacheUsage(
    ['c1', 'c2', 'c3'],
    {
      c1: { status: 'sent' },
      c3: { status: 'done' }
    }
  );

  assert.equal(latestSummary.requested, 2);
  assert.equal(latestSummary.latestHits, 1);
  assert.equal(latestSummary.onlineHits, 1);
  assert.equal(latestSummary.commandHits, 1);
  assert.equal(latestSummary.latestMisses, 1);
  assert.equal(commandSummary.requested, 3);
  assert.equal(commandSummary.hits, 2);
  assert.equal(commandSummary.misses, 1);
});

test('normalizeIncomingMessage builds unified internal shape', () => {
  const normalized = ingestScf.__test__.normalizeIncomingMessage(
    {
      productId: 'p1',
      deviceName: 'd1',
      notifyType: 'property',
      messageType: 'report',
      dataId: 'msg-1',
      dataTimestamp: 1710000000000,
      data: {
        params: {
          soil_percent: { value: 55, time: 1710000000000 }
        }
      }
    },
    1710000000000
  );

  assert.equal(normalized.deviceId, 'p1::d1');
  assert.equal(normalized.logicalKey, 'p1::d1');
  assert.equal(normalized.messageId, 'msg-1');
  assert.equal(normalized.timestamp, 1710000000000);
  assert.equal(normalized.type, 'property');
  assert.deepEqual(normalized.payload, {
    params: {
      soil_percent: { value: 55, time: 1710000000000 }
    }
  });
});

test('ingest runtime service proxy config stays disabled by default and builds runtime message', () => {
  const originalEnabled = process.env.INGEST_SCF_RUNTIME_PROXY_ENABLED;
  const originalBaseUrl = process.env.RUNTIME_SERVICE_BASE_URL;
  const originalTimeout = process.env.INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS;
  const originalFallback = process.env.INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL;

  delete process.env.INGEST_SCF_RUNTIME_PROXY_ENABLED;
  delete process.env.RUNTIME_SERVICE_BASE_URL;
  delete process.env.INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS;
  delete process.env.INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL;

  const disabledConfig = ingestScf.__test__.getRuntimeServiceProxyConfig();
  assert.equal(disabledConfig.enabled, false);
  assert.equal(ingestScf.__test__.shouldProxyToRuntimeService(), false);

  process.env.INGEST_SCF_RUNTIME_PROXY_ENABLED = 'true';
  process.env.RUNTIME_SERVICE_BASE_URL = 'http://127.0.0.1:18080/';
  process.env.INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS = '9000';
  process.env.INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL = 'false';

  const enabledConfig = ingestScf.__test__.getRuntimeServiceProxyConfig();
  assert.equal(enabledConfig.enabled, true);
  assert.equal(enabledConfig.baseUrl, 'http://127.0.0.1:18080');
  assert.equal(enabledConfig.timeoutMs, 9000);
  assert.equal(enabledConfig.fallbackToLocal, false);
  assert.equal(ingestScf.__test__.shouldProxyToRuntimeService(), true);
  assert.equal(
    ingestScf.__test__.buildRuntimeServiceUrl('/runtime/ingest/message'),
    'http://127.0.0.1:18080/runtime/ingest/message'
  );

  const runtimeMessage = ingestScf.__test__.buildUnifiedRuntimeMessage(
    {
      deviceId: 'p1::d1',
      logicalKey: 'p1::d1',
      productId: 'p1',
      deviceName: 'd1',
      messageId: 'msg-1',
      timestamp: 1710000000000,
      type: 'property',
      messageType: 'report',
      params: {
        soil_percent: { value: 48, time: 1710000000000 }
      },
      payload: {
        foo: 'bar'
      }
    },
    {
      provider: 'onenet',
      pushId: 'push-1',
      rawEvent: 'webhook'
    }
  );
  assert.equal(runtimeMessage.provider, 'onenet');
  assert.equal(runtimeMessage.logicalKey, 'p1::d1');
  assert.equal(runtimeMessage.payload.params.soil_percent.value, 48);
  assert.equal(runtimeMessage.sourceMeta.pushId, 'push-1');

  if (originalEnabled === undefined) delete process.env.INGEST_SCF_RUNTIME_PROXY_ENABLED;
  else process.env.INGEST_SCF_RUNTIME_PROXY_ENABLED = originalEnabled;
  if (originalBaseUrl === undefined) delete process.env.RUNTIME_SERVICE_BASE_URL;
  else process.env.RUNTIME_SERVICE_BASE_URL = originalBaseUrl;
  if (originalTimeout === undefined) delete process.env.INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS;
  else process.env.INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS = originalTimeout;
  if (originalFallback === undefined) delete process.env.INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL;
  else process.env.INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL = originalFallback;
});

test('normalizeEmqxMessage builds unified internal shape', () => {
  const normalized = ingestScf.__test__.normalizeEmqxMessage(
    {
      event: 'message.publish',
      topic: '/sys/p2/d2/up/property',
      payload: JSON.stringify({
        soil_percent: 33,
        timestamp: 1710000001000
      })
    },
    1710000001000
  );

  assert.equal(normalized.logicalKey, 'p2::d2');
  assert.equal(normalized.deviceId, 'p2::d2');
  assert.match(normalized.messageId, /^p2::d2:/);
  assert.equal(normalized.timestamp, 1710000001000);
  assert.equal(normalized.type, 'message.publish');
});

test('buildMessageIngestRecord keeps provider/device/message identity for dedup', () => {
  const latestRecord = {
    logicalKey: 'p3::d3',
    updatedAt: 1710000002000
  };
  const normalized = {
    deviceId: 'p3::d3',
    messageId: 'msg-3',
    messageType: 'report',
    notifyType: 'property',
    timestamp: 1710000002000,
    payload: { run_state: true }
  };

  const record = ingestScf.__test__.buildMessageIngestRecord(normalized, latestRecord, {
    provider: 'onenet'
  });

  assert.equal(record.provider, 'onenet');
  assert.equal(record.logicalKey, 'p3::d3');
  assert.equal(record.deviceId, 'p3::d3');
  assert.equal(record.messageId, 'msg-3');
  assert.equal(record.messageTimestampMs, 1710000002000);
});

test('detectCommandAck detects ack-like events', () => {
  assert.equal(
    ingestScf.__test__.detectCommandAck('property_ack', 'report', {}),
    true
  );
  assert.equal(
    ingestScf.__test__.detectCommandAck('property', 'report', { rawEvent: 'message.reply' }),
    true
  );
  assert.equal(
    ingestScf.__test__.detectCommandAck('property', 'report', { rawEvent: 'message.publish' }),
    false
  );
});

test('reconcilePendingCommands marks sent command acked when ack-like message arrives without matching params', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return [[
          {
            id: 11,
            command_id: 'cmd-ack',
            status: 'sent',
            sent_params_json: JSON.stringify({ fan_switch: true })
          }
        ]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  const transitions = await ingestScf.__test__.reconcilePendingCommands(db, {
    logicalKey: 'p1::d1',
    notifyType: 'property_ack',
    messageType: 'report',
    updatedAt: 1710000000000,
    params: {
      soil_percent: { value: 52, time: 1710000000000 }
    },
    pushMeta: {}
  });

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].commandId, 'cmd-ack');
  assert.equal(transitions[0].fromStatus, 'sent');
  assert.equal(transitions[0].toStatus, 'acked');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], 'acked');
});

test('reconcilePendingCommands marks command done when latest params match sent params', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return [[
          {
            id: 12,
            command_id: 'cmd-done',
            status: 'sent',
            sent_params_json: JSON.stringify({ fan_switch: true })
          }
        ]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  const transitions = await ingestScf.__test__.reconcilePendingCommands(db, {
    logicalKey: 'p1::d1',
    notifyType: 'property',
    messageType: 'report',
    updatedAt: 1710000005000,
    params: {
      fan_switch: { value: true, time: 1710000005000 },
      soil_percent: { value: 45, time: 1710000005000 }
    },
    pushMeta: { rawEvent: 'message.publish' }
  });

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].commandId, 'cmd-done');
  assert.equal(transitions[0].toStatus, 'done');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], 'done');
});

test('reconcilePendingCommands keeps commands unchanged when neither ack nor matching params are present', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[
        {
          id: 13,
          command_id: 'cmd-still-sent',
          status: 'sent',
          sent_params_json: JSON.stringify({ fan_switch: true })
        }
      ]];
    }
  };

  const transitions = await ingestScf.__test__.reconcilePendingCommands(db, {
    logicalKey: 'p1::d1',
    notifyType: 'property',
    messageType: 'report',
    updatedAt: 1710000010000,
    params: {
      soil_percent: { value: 46, time: 1710000010000 }
    },
    pushMeta: { rawEvent: 'message.publish' }
  });

  assert.deepEqual(transitions, []);
  assert.equal(calls.length, 1);
});

test('history cleanup exposes sane timeout defaults', () => {
  const retention = historyCleanupScf.__test__.getRetentionDays();
  const timeoutMinutes = historyCleanupScf.__test__.getCommandTimeoutMinutes();
  const inspection = historyCleanupScf.__test__.getInspectionConfig();

  assert.ok(retention.ingest >= 1);
  assert.ok(retention.raw >= 1);
  assert.ok(timeoutMinutes >= 1);
  assert.ok(inspection.offlineMinutes >= 1);
  assert.ok(inspection.commandLagMinutes >= 1);
});

test('failTimedOutCommands marks pending/sent/acked commands failed after timeout window', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 3 }];
    }
  };

  const affected = await historyCleanupScf.__test__.failTimedOutCommands(db, 15);

  assert.equal(affected, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 15);
  assert.match(calls[0].sql, /status IN \('pending', 'sent', 'acked'\)/);
  assert.match(calls[0].sql, /Command timed out without ACK/);
});

test('inspectOfflineDevices returns count and normalized sample rows', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[
        {
          logical_key: 'p1::d1',
          product_id: 'p1',
          device_name: 'd1',
          updated_at_ms: 1710000000000,
          alias: '客厅花盆'
        },
        {
          logical_key: 'p2::d2',
          product_id: 'p2',
          device_name: 'd2',
          updated_at_ms: 1710000005000,
          alias: ''
        }
      ]];
    }
  };

  const result = await historyCleanupScf.__test__.inspectOfflineDevices(db, 30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 30);
  assert.equal(result.count, 2);
  assert.deepEqual(result.sample[0], {
    logicalKey: 'p1::d1',
    alias: '客厅花盆',
    productId: 'p1',
    deviceName: 'd1',
    lastSeenAt: 1710000000000
  });
  assert.deepEqual(result.sample[1], {
    logicalKey: 'p2::d2',
    alias: 'd2',
    productId: 'p2',
    deviceName: 'd2',
    lastSeenAt: 1710000005000
  });
});

test('inspectLaggingCommands returns lagging command sample for alerting', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[
        {
          command_id: 'cmd-1',
          logical_key: 'p1::d1',
          provider: 'onenet',
          status: 'acked',
          requested_at_ms: 1710000010000
        }
      ]];
    }
  };

  const result = await historyCleanupScf.__test__.inspectLaggingCommands(db, 20);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 20);
  assert.equal(result.count, 1);
  assert.deepEqual(result.sample[0], {
    commandId: 'cmd-1',
    logicalKey: 'p1::d1',
    provider: 'onenet',
    status: 'acked',
    requestedAt: 1710000010000
  });
});

test('runtime cache config stays safely disabled by default', () => {
  const apiConfig = apiRuntimeCache.getRuntimeCacheConfig();
  const ingestConfig = ingestRuntimeCache.getRuntimeCacheConfig();

  assert.equal(apiConfig.enabled, false);
  assert.equal(ingestConfig.enabled, false);
  assert.ok(apiConfig.latestTtlSec >= 30);
  assert.ok(ingestConfig.dedupTtlSec >= 30);
});

test('runtime service proxy config stays disabled by default and parses route list', () => {
  const originalEnabled = process.env.API_SCF_RUNTIME_PROXY_ENABLED;
  const originalBaseUrl = process.env.RUNTIME_SERVICE_BASE_URL;
  const originalRoutes = process.env.API_SCF_RUNTIME_PROXY_ROUTES;

  delete process.env.API_SCF_RUNTIME_PROXY_ENABLED;
  delete process.env.RUNTIME_SERVICE_BASE_URL;
  delete process.env.API_SCF_RUNTIME_PROXY_ROUTES;

  const disabledConfig = apiScf.__test__.getRuntimeServiceProxyConfig();
  assert.equal(disabledConfig.enabled, false);
  assert.equal(disabledConfig.baseUrl, '');
  assert.equal(apiScf.__test__.shouldProxyRuntimeRoute('/device/latest'), false);

  process.env.API_SCF_RUNTIME_PROXY_ENABLED = 'true';
  process.env.RUNTIME_SERVICE_BASE_URL = 'http://127.0.0.1:18080/';
  process.env.API_SCF_RUNTIME_PROXY_ROUTES = '/device/latest, /device/cmd, /device/command/detail';

  const enabledConfig = apiScf.__test__.getRuntimeServiceProxyConfig();
  assert.equal(enabledConfig.enabled, true);
  assert.equal(enabledConfig.baseUrl, 'http://127.0.0.1:18080');
  assert.deepEqual(enabledConfig.routes, ['/device/latest', '/device/cmd', '/device/command/detail']);
  assert.equal(apiScf.__test__.shouldProxyRuntimeRoute('/device/latest'), true);
  assert.equal(apiScf.__test__.shouldProxyRuntimeRoute('/device/commands'), false);
  assert.equal(apiScf.__test__.shouldProxyRuntimeRoute('/device/command/detail'), true);
  assert.equal(
    apiScf.__test__.buildRuntimeServiceUrl('/runtime/device/latest'),
    'http://127.0.0.1:18080/runtime/device/latest'
  );

  if (originalEnabled === undefined) delete process.env.API_SCF_RUNTIME_PROXY_ENABLED;
  else process.env.API_SCF_RUNTIME_PROXY_ENABLED = originalEnabled;
  if (originalBaseUrl === undefined) delete process.env.RUNTIME_SERVICE_BASE_URL;
  else process.env.RUNTIME_SERVICE_BASE_URL = originalBaseUrl;
  if (originalRoutes === undefined) delete process.env.API_SCF_RUNTIME_PROXY_ROUTES;
  else process.env.API_SCF_RUNTIME_PROXY_ROUTES = originalRoutes;
});

test('runtime service proxy headers keep openid and request id', () => {
  const headers = apiScf.__test__.buildRuntimeServiceHeaders(
    {
      'x-request-id': 'req-123'
    },
    'openid-123'
  );

  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-wx-openid'], 'openid-123');
  assert.equal(headers['x-request-id'], 'req-123');
});

test('deprecated services DB adapter is explicitly blocked', () => {
  const deprecatedDb = require('../services/DB.js');

  assert.equal(deprecatedDb.__deprecated__, true);
  assert.throws(() => deprecatedDb.query, /deprecated/i);
});

test('runtime profile resolution keeps prod as safe default and allows overrides', () => {
  const prodConfig = runtimeProfiles.resolveRuntimeProfile('prod');
  const fallbackConfig = runtimeProfiles.resolveRuntimeProfile('unknown');
  const overriddenConfig = runtimeProfiles.resolveRuntimeProfile('test', {
    scfApiBaseUrl: 'https://example.test/api'
  });

  assert.equal(prodConfig.profileName, 'prod');
  assert.match(prodConfig.scfApiBaseUrl, /^https:\/\//);
  assert.equal(fallbackConfig.profileName, 'prod');
  assert.equal(overriddenConfig.profileName, 'test');
  assert.equal(overriddenConfig.scfApiBaseUrl, 'https://example.test/api');
});

test('buildAppRuntimeConfig and validation expose missing endpoint warnings', () => {
  const config = runtimeConfig.buildAppRuntimeConfig({
    profileName: 'dev',
    overrides: {
      scfApiBaseUrl: 'https://example.dev/api'
    }
  });
  const warnings = runtimeConfig.validateRuntimeConfig(config);

  assert.equal(config.profileName, 'dev');
  assert.equal(config.scfApiBaseUrl, 'https://example.dev/api');
  assert.ok(warnings.includes('authScfBaseUrl is empty'));
  assert.ok(warnings.includes('agentScfBaseUrl is empty'));
});
