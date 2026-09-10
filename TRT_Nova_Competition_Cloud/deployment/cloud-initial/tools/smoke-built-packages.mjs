#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { cloudRoot } from './common.mjs';

const buildRoot = path.join(cloudRoot, 'build');
const previous = { ...process.env };

function loadEntry(functionName) {
  const entryPath = path.join(buildRoot, functionName, 'index.js');
  if (!fs.existsSync(entryPath)) throw new Error(`请先构建候选，缺少 ${entryPath}`);
  const requireFromPackage = createRequire(path.join(buildRoot, functionName, 'smoke-runner.cjs'));
  return requireFromPackage('./index.js');
}

function setCommonEnvironment(functionName) {
  Object.assign(process.env, {
    NOVA_FUNCTION_NAME: functionName,
    NOVA_CLOUD_DEPLOYMENT: 'true',
    DB_HOST: 'mysql.legacy.invalid',
    DB_PORT: '28245',
    DB_TLS_MODE: 'legacy-direct',
    MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-media-smoke',
    CLOUDBASE_STORAGE_REGION: 'ap-shanghai', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/smoke/media/',
    DB_NAME: 'nova_staging',
    DB_USER: 'secret-injected-user',
    DB_PASSWORD: 'secret-injected-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    ALLOW_LEGACY_OPENID_FALLBACK: 'false',
    LOCAL_MEDIA_ENABLED: 'false',
    DEBUG_OPENID: '',
    AGENT_SHADOW_ENABLED: 'false',
    AGENT_ROLLOUT_ENABLED: 'true'
  });
}

async function main() {
  const results = [];

  setCommonEnvironment('auth-scf');
  Object.assign(process.env, {
    WECHAT_APPID: 'wx-staging-appid',
    WECHAT_SECRET: 'secret-injected-wechat-secret'
  });
  const auth = await loadEntry('auth-scf').main_handler({ httpMethod: 'GET', path: '/not-a-route' });
  assert.equal(auth.statusCode, 404);
  results.push({ function: 'auth-scf', check: 'original index handler -> 404', statusCode: auth.statusCode });

  setCommonEnvironment('api-scf');
  const api = await loadEntry('api-scf').main_handler({ httpMethod: 'POST', path: '/media/upload' });
  assert.equal(api.statusCode, 401);
  results.push({ function: 'api-scf', check: 'media reaches real authenticated source handler, missing JWT rejected', statusCode: api.statusCode });

  setCommonEnvironment('agent-scf');
  process.env.LLM_API_ENABLED = 'false';
  const agent = await loadEntry('agent-scf').main_handler({ httpMethod: 'GET', path: '/health' });
  assert.equal(agent.statusCode, 200);
  results.push({ function: 'agent-scf', check: 'built package health handler', statusCode: agent.statusCode });

  setCommonEnvironment('ingest-scf');
  Object.assign(process.env, {
    NOVA_INGEST_ENABLED: 'true',
    ONE_NET_TOKEN: 'secret-injected-token'
  });
  const ingest = await loadEntry('ingest-scf').main_handler({ httpMethod: 'POST', path: '/not-ingest' });
  assert.equal(ingest.statusCode, 404);
  results.push({ function: 'ingest-scf', check: 'unexpected webhook path rejected', statusCode: ingest.statusCode });

  setCommonEnvironment('history-cleanup-scf');
  process.env.NOVA_HISTORY_CLEANUP_ENABLED = 'true';
  const cleanup = await loadEntry('history-cleanup-scf').main_handler({ httpMethod: 'POST', path: '/cleanup' });
  assert.equal(cleanup.statusCode, 403);
  results.push({ function: 'history-cleanup-scf', check: 'public invocation rejected', statusCode: cleanup.statusCode });

  console.log(JSON.stringify({
    ok: true,
    claim: 'LOCAL_BUILT_PACKAGE_SMOKE_ONLY_NO_CLOUD_RESOURCES',
    testDoubles: ['Synthetic SCF environment values; no DB or external service request is made'],
    results
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) delete process.env[key];
  }
  Object.assign(process.env, previous);
}
