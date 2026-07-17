const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  method: 'GET',
  concurrency: 5,
  requests: 50,
  timeoutMs: 5000,
  warmupRequests: 0,
  pretty: false
});

function printUsage() {
  const message = [
    'Usage: node scripts/runtime-load-smoke.js --url <url> [options]',
    '',
    'Options:',
    '  --url <url>                 target URL, required',
    '  --method <method>           HTTP method, default GET',
    '  --body-file <path>          JSON request body file',
    '  --concurrency <number>      concurrent workers, default 5',
    '  --requests <number>         measured request count, default 50',
    '  --warmup-requests <number>  warmup request count, default 0',
    '  --timeout-ms <number>       per-request timeout, default 5000',
    '  --header <name:value>       repeatable custom header',
    '  --pretty                    pretty-print JSON result',
    '  --help                      show this help text'
  ].join('\n');

  process.stdout.write(`${message}\n`);
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeHeader(value) {
  const raw = String(value || '');
  const delimiterIndex = raw.indexOf(':');
  if (delimiterIndex <= 0) return null;
  const name = raw.slice(0, delimiterIndex).trim();
  const headerValue = raw.slice(delimiterIndex + 1).trim();
  if (!name) return null;
  return [name, headerValue];
}

function parseArgs(argv) {
  const args = {
    url: '',
    method: DEFAULTS.method,
    bodyFile: '',
    concurrency: DEFAULTS.concurrency,
    requests: DEFAULTS.requests,
    timeoutMs: DEFAULTS.timeoutMs,
    warmupRequests: DEFAULTS.warmupRequests,
    headers: {},
    pretty: DEFAULTS.pretty,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--url') {
      args.url = argv[index + 1] || '';
      index += 1;
    } else if (current === '--method') {
      args.method = String(argv[index + 1] || DEFAULTS.method).toUpperCase();
      index += 1;
    } else if (current === '--body-file') {
      args.bodyFile = argv[index + 1] || '';
      index += 1;
    } else if (current === '--concurrency') {
      args.concurrency = parseInteger(argv[index + 1], DEFAULTS.concurrency);
      index += 1;
    } else if (current === '--requests') {
      args.requests = parseInteger(argv[index + 1], DEFAULTS.requests);
      index += 1;
    } else if (current === '--timeout-ms') {
      args.timeoutMs = parseInteger(argv[index + 1], DEFAULTS.timeoutMs);
      index += 1;
    } else if (current === '--warmup-requests') {
      args.warmupRequests = parseInteger(argv[index + 1], DEFAULTS.warmupRequests);
      index += 1;
    } else if (current === '--header') {
      const header = normalizeHeader(argv[index + 1] || '');
      if (header) {
        args.headers[header[0]] = header[1];
      }
      index += 1;
    } else if (current === '--pretty') {
      args.pretty = true;
    } else if (current === '--help') {
      args.help = true;
    }
  }

  return args;
}

function loadBody(bodyFile) {
  if (!bodyFile) return undefined;
  const absolutePath = path.resolve(bodyFile);
  const content = fs.readFileSync(absolutePath, 'utf8');
  JSON.parse(content);
  return content;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarizeResults(config, phase, records, totalDurationMs) {
  const latencies = records.map((item) => item.durationMs);
  const success = records.filter((item) => item.ok).length;
  const failures = records.length - success;
  const timeouts = records.filter((item) => item.timedOut).length;
  const non2xx = records.filter((item) => item.statusCode && (item.statusCode < 200 || item.statusCode >= 300)).length;
  const statusCodes = {};

  for (const record of records) {
    const codeKey = String(record.statusCode || 'error');
    statusCodes[codeKey] = (statusCodes[codeKey] || 0) + 1;
  }

  return {
    phase,
    url: config.url,
    method: config.method,
    concurrency: config.concurrency,
    requests: records.length,
    totalDurationMs,
    throughputRps: totalDurationMs > 0 ? Number((records.length * 1000 / totalDurationMs).toFixed(2)) : 0,
    success,
    failures,
    timeouts,
    non2xx,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      avg: latencies.length ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)) : 0,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length ? Math.max(...latencies) : 0
    },
    statusCodes
  };
}

async function runSingleRequest(config, body) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body,
      signal: controller.signal
    });

    await response.text();

    return {
      ok: response.ok,
      statusCode: response.status,
      timedOut: false,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      timedOut: error && error.name === 'AbortError',
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error || 'request_failed')
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runPhase(config, body, requestCount) {
  if (requestCount <= 0) {
    return { records: [], totalDurationMs: 0 };
  }

  let cursor = 0;
  const records = [];
  const startedAt = Date.now();

  async function worker() {
    while (true) {
      const requestIndex = cursor;
      cursor += 1;
      if (requestIndex >= requestCount) return;
      const record = await runSingleRequest(config, body);
      records.push(record);
    }
  }

  const workers = Array.from({ length: Math.min(config.concurrency, requestCount) }, () => worker());
  await Promise.all(workers);

  return {
    records,
    totalDurationMs: Date.now() - startedAt
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printUsage();
    if (!args.help) process.exitCode = 1;
    return;
  }

  const body = loadBody(args.bodyFile);
  const headers = { ...args.headers };

  if (body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    ...args,
    headers,
    body
  };

  const warmup = await runPhase(config, body, config.warmupRequests);
  const measured = await runPhase(config, body, config.requests);

  const output = {
    warmup: summarizeResults(config, 'warmup', warmup.records, warmup.totalDurationMs),
    measured: summarizeResults(config, 'measured', measured.records, measured.totalDurationMs)
  };

  process.stdout.write(`${JSON.stringify(output, null, config.pretty ? 2 : 0)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULTS,
  parseArgs,
  normalizeHeader,
  loadBody,
  percentile,
  summarizeResults
};
