const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = Object.freeze({
  thresholds: {
    requestFailedWarn: 1,
    requestFailedCritical: 5,
    ingestFailedWarn: 1,
    ingestFailedCritical: 3,
    commandFailedWarn: 1,
    commandFailedCritical: 5,
    cleanupFailedWarn: 1,
    cleanupFailedCritical: 1,
    offlineDevicesWarn: 1,
    offlineDevicesCritical: 5,
    laggingCommandsWarn: 1,
    laggingCommandsCritical: 5
  }
});

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch (err) {
    return null;
  }
}

function normalizeLogRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    level: typeof record.level === 'string' ? record.level : '',
    service: typeof record.service === 'string' ? record.service : '',
    event: typeof record.event === 'string' ? record.event : '',
    ts: Number(record.ts) || null,
    payload: record
  };
}

function parseLogLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(safeJsonParse)
    .map(normalizeLogRecord)
    .filter(Boolean);
}

function incrementCounter(target, key, delta = 1) {
  target[key] = (target[key] || 0) + delta;
}

function classifySeverity(value, warnAt, criticalAt) {
  if (value >= criticalAt) return 'critical';
  if (value >= warnAt) return 'warn';
  return 'ok';
}

function summarizeLogs(records, config = DEFAULT_CONFIG) {
  const summary = {
    totalRecords: records.length,
    services: {},
    events: {},
    issues: {
      requestFailed: 0,
      ingestFailed: 0,
      commandFailed: 0,
      cleanupFailed: 0,
      offlineDevices: 0,
      laggingCommands: 0
    },
    samples: {
      requestFailed: [],
      ingestFailed: [],
      commandFailed: [],
      cleanupFailed: [],
      offlineDevices: [],
      laggingCommands: []
    }
  };

  for (const record of records) {
    incrementCounter(summary.services, record.service || 'unknown');
    incrementCounter(summary.events, record.event || 'unknown');

    if (record.event === 'request_failed') {
      summary.issues.requestFailed += 1;
      if (summary.samples.requestFailed.length < 5) {
        summary.samples.requestFailed.push({
          service: record.service,
          ts: record.ts,
          path: record.payload.path || '',
          message: record.payload.message || ''
        });
      }
    }

    if (record.event === 'push_processing_failed' || record.event === 'decrypt_failed') {
      summary.issues.ingestFailed += 1;
      if (summary.samples.ingestFailed.length < 5) {
        summary.samples.ingestFailed.push({
          service: record.service,
          ts: record.ts,
          event: record.event,
          message: record.payload.message || ''
        });
      }
    }

    if (record.event === 'device_command_failed') {
      summary.issues.commandFailed += 1;
      if (summary.samples.commandFailed.length < 5) {
        summary.samples.commandFailed.push({
          service: record.service,
          ts: record.ts,
          commandId: record.payload.commandId || '',
          logicalKey: record.payload.logicalKey || '',
          message: record.payload.message || record.payload.errorMessage || ''
        });
      }
    }

    if (record.event === 'cleanup_failed') {
      summary.issues.cleanupFailed += 1;
      if (summary.samples.cleanupFailed.length < 5) {
        summary.samples.cleanupFailed.push({
          service: record.service,
          ts: record.ts,
          message: record.payload.message || ''
        });
      }
    }

    if (record.event === 'cleanup_alerts_detected') {
      const offlineCount = Number(record.payload?.alerts?.offlineDevices?.count) || 0;
      const laggingCount = Number(record.payload?.alerts?.laggingCommands?.count) || 0;
      summary.issues.offlineDevices += offlineCount;
      summary.issues.laggingCommands += laggingCount;

      const offlineSample = record.payload?.alerts?.offlineDevices?.sample || [];
      const laggingSample = record.payload?.alerts?.laggingCommands?.sample || [];

      for (const item of offlineSample) {
        if (summary.samples.offlineDevices.length >= 5) break;
        summary.samples.offlineDevices.push(item);
      }

      for (const item of laggingSample) {
        if (summary.samples.laggingCommands.length >= 5) break;
        summary.samples.laggingCommands.push(item);
      }
    }
  }

  const thresholds = config.thresholds || DEFAULT_CONFIG.thresholds;
  summary.status = {
    requestFailed: classifySeverity(
      summary.issues.requestFailed,
      thresholds.requestFailedWarn,
      thresholds.requestFailedCritical
    ),
    ingestFailed: classifySeverity(
      summary.issues.ingestFailed,
      thresholds.ingestFailedWarn,
      thresholds.ingestFailedCritical
    ),
    commandFailed: classifySeverity(
      summary.issues.commandFailed,
      thresholds.commandFailedWarn,
      thresholds.commandFailedCritical
    ),
    cleanupFailed: classifySeverity(
      summary.issues.cleanupFailed,
      thresholds.cleanupFailedWarn,
      thresholds.cleanupFailedCritical
    ),
    offlineDevices: classifySeverity(
      summary.issues.offlineDevices,
      thresholds.offlineDevicesWarn,
      thresholds.offlineDevicesCritical
    ),
    laggingCommands: classifySeverity(
      summary.issues.laggingCommands,
      thresholds.laggingCommandsWarn,
      thresholds.laggingCommandsCritical
    )
  };

  summary.overall = Object.values(summary.status).includes('critical')
    ? 'critical'
    : (Object.values(summary.status).includes('warn') ? 'warn' : 'ok');

  return summary;
}

function loadConfig(configPath) {
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  const absolutePath = path.resolve(configPath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...(parsed.thresholds || {})
    }
  };
}

function parseArgs(argv) {
  const args = {
    file: '',
    config: '',
    pretty: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--file') {
      args.file = argv[index + 1] || '';
      index += 1;
    } else if (current === '--config') {
      args.config = argv[index + 1] || '';
      index += 1;
    } else if (current === '--pretty') {
      args.pretty = true;
    }
  }

  return args;
}

function readInput(filePath) {
  if (filePath) {
    return fs.readFileSync(path.resolve(filePath), 'utf8');
  }

  return fs.readFileSync(0, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const content = readInput(args.file);
  const records = parseLogLines(content);
  const summary = summarizeLogs(records, config);
  const spacing = args.pretty ? 2 : 0;
  process.stdout.write(`${JSON.stringify(summary, null, spacing)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_CONFIG,
  parseLogLines,
  summarizeLogs,
  loadConfig,
  classifySeverity
};
