#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudRoot, loadPolicy, hasPlaceholder, isTrue, readJson, writeJson, measureEnvironmentUtf8Bytes } from './common.mjs';

// Like LastScf, the operator fills SCF environment variables in the console.
// This file emits public configuration and required variable NAMES, never secrets.
const MEDIA_FUNCTIONS = new Set(['api-scf', 'agent-scf', 'history-cleanup-scf']);
const SECRET_NAME = /^(?:DB_USER|DB_PASSWORD|DB_SSL_CA|JWT_SECRET|WECHAT_SECRET|LLM_API_KEY|QWEATHER_PRIVATE_KEY|ONE_NET_TOKEN|ONE_NET_AES_KEY|EMQX_WEBHOOK_TOKEN|TENCENTCLOUD_SECRETID|TENCENTCLOUD_SECRETKEY|TENCENTCLOUD_SESSIONTOKEN)$/;
const UNKNOWN_SECRET_NAME = /(?:^|_)(?:SECRET(?:ID|KEY)?|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY|TOKEN)$/;

function functionUrl(value, label, allowPlaceholders) {
  if (allowPlaceholders && hasPlaceholder(value)) return value || '';
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('Missing HTTPS Function URL: ' + label); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      /^(?:localhost\.?|(?:\d+\.){3}\d+|\[.*\])$/i.test(url.hostname)) throw new Error('Expected HTTPS Function URL: ' + label);
  return String(value).replace(/\/+$/, '');
}

export function renderConfiguration(config, { allowPlaceholders = false } = {}) {
  if (config.environment !== 'staging' || config.environmentSource !== 'scf-environment') {
    throw new Error('Only staging SCF environment configuration is supported');
  }
  if (config.secretResolution || config.secrets || config.database?.userSecretRef || config.database?.passwordSecretRef) {
    throw new Error('Secret-manager references are not part of the LastScf deployment');
  }
  if (!['legacy-direct', 'private-network', 'required'].includes(config.database?.tlsMode) || config.media?.mode !== 'cloudbase') {
    throw new Error('Use LastScf MySQL configuration and CloudBase media');
  }
  if (config.functionRuntime?.handler !== 'index.main_handler' || config.functionRuntime?.functionType !== 'Event') {
    throw new Error('Use the original index.main_handler Event Function entry');
  }
  if (config.ingress?.mode !== 'scf-function-url') throw new Error('Use separate SCF Function URLs, as in LastScf');
  const media = config.media;
  if (!allowPlaceholders && (!/^[a-z0-9][a-z0-9-]{3,63}$/.test(media.envId || '') ||
      !/^[a-z]+-[a-z0-9-]+$/.test(media.region || '') ||
      !/^nova-staging\/[a-z0-9_-]{1,32}\/(?:images|media)\/$/.test(media.prefix || ''))) {
    throw new Error('CloudBase requires an explicit environment, region and media prefix');
  }
  for (const environment of Object.values(config.plainEnvironment || {})) {
    for (const key of Object.keys(environment || {})) {
      if (SECRET_NAME.test(key) || UNKNOWN_SECRET_NAME.test(key) || /(?:_KEY_FILE|PRIVATE_KEY_FILE)$/.test(key)) {
        throw new Error('Secret material is forbidden in this public config; set it in SCF: ' + key);
      }
      if (key === 'LOCAL_DEV_OPENID' || key === 'LOCAL_DEV_AUTH_ENABLED' || /^(?:COS_|NOVA_SECRET_)/.test(key)) {
        throw new Error('Local identity or retired deployment configuration is forbidden: ' + key);
      }
    }
  }
  const appid = config.plainEnvironment?.['auth-scf']?.WECHAT_APPID;
  if (config.frontend?.appid && !hasPlaceholder(config.frontend.appid) && !hasPlaceholder(appid) && config.frontend.appid !== appid) {
    throw new Error('Frontend AppID must match auth-scf.WECHAT_APPID');
  }
  if (!allowPlaceholders && hasPlaceholder(appid)) throw new Error('Unconfigured frontend appid');
  const urls = {};
  for (const name of ['auth-scf', 'api-scf', 'agent-scf']) {
    urls[name] = functionUrl(config.ingress.functionUrls?.[name], name, allowPlaceholders);
  }
  if (!allowPlaceholders && new Set(Object.values(urls)).size !== 3) throw new Error('Configure three separate auth/api/agent Function URLs');
  const functions = {};
  for (const unit of loadPolicy().functions) {
    const environment = { ...config.plainEnvironment.common, ...config.plainEnvironment[unit.name],
      NOVA_CLOUD_DEPLOYMENT: 'true', NOVA_FUNCTION_NAME: unit.name,
      DB_HOST: config.database.host, DB_PORT: String(config.database.port || 3306),
      DB_NAME: config.database.name, DB_CONN_LIMIT: String(config.database.connectionLimit || 5),
      DB_TLS_MODE: config.database.tlsMode };
    const requiredSecretEnvironment = ['DB_USER', 'DB_PASSWORD'];
    const optionalSecretEnvironment = config.database.tlsMode === 'required' ? ['DB_SSL_CA'] : [];
    if (['api-scf', 'auth-scf', 'agent-scf'].includes(unit.name)) requiredSecretEnvironment.push('JWT_SECRET');
    if (unit.name === 'auth-scf' || MEDIA_FUNCTIONS.has(unit.name)) {
      environment.WECHAT_APPID = appid;
      requiredSecretEnvironment.push('WECHAT_SECRET');
    }
    if (MEDIA_FUNCTIONS.has(unit.name)) Object.assign(environment, {
      MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: media.envId,
      CLOUDBASE_STORAGE_REGION: media.region, CLOUDBASE_STORAGE_PREFIX: media.prefix,
      LOCAL_MEDIA_ENABLED: 'false'
    });
    if (unit.name === 'agent-scf' && isTrue(environment.LLM_API_ENABLED)) requiredSecretEnvironment.push('LLM_API_KEY');
    if (unit.name === 'api-scf' && isTrue(environment.QWEATHER_ENABLED)) {
      for (const key of ['QWEATHER_API_HOST', 'QWEATHER_PROJECT_ID', 'QWEATHER_CREDENTIAL_ID']) {
        if (!allowPlaceholders && hasPlaceholder(environment[key])) throw new Error('Weather enabled but missing ' + key);
      }
      requiredSecretEnvironment.push('QWEATHER_PRIVATE_KEY');
    }
    const oneOfSecretEnvironment = unit.name === 'ingest-scf' && isTrue(environment.NOVA_INGEST_ENABLED)
      ? [['ONE_NET_TOKEN', 'EMQX_WEBHOOK_TOKEN']] : [];
    if (unit.name === 'ingest-scf') {
      optionalSecretEnvironment.push('ONE_NET_AES_KEY');
      if (isTrue(environment.NOVA_INGEST_ENABLED)) {
        urls[unit.name] = functionUrl(config.ingress.functionUrls?.[unit.name], unit.name, allowPlaceholders);
      }
    }
    if (!allowPlaceholders && Object.values(environment).some(value => value !== '' && hasPlaceholder(value))) {
      throw new Error('Unconfigured environment: ' + unit.name);
    }
    if (/^(?:localhost\.?|0\.0\.0\.0|127\..*|\[?::1\]?|\[?::ffff:127\..*)$/i.test(environment.DB_HOST)) {
      throw new Error('Loopback database is forbidden');
    }
    const bytes = measureEnvironmentUtf8Bytes(environment);
    if (bytes > 4096) throw new Error('Public environment exceeds 4096 UTF-8 bytes: ' + unit.name);
    functions[unit.name] = { functionType: 'Event', runtime: loadPolicy().runtime, handler: 'index.main_handler',
      timeoutSeconds: unit.timeoutSeconds, environment, requiredSecretEnvironment, optionalSecretEnvironment,
      oneOfSecretEnvironment, publicEnvironmentUtf8Bytes: bytes,
      finalEnvironmentMeasurement: 'SET_AND_MEASURE_IN_SCF_CONSOLE_INCLUDING_SECRET_VALUES' };
  }
  return { schemaVersion: 'nova.cloud-rendered/v1', claim: 'CONFIGURATION_ONLY_NO_CLOUD_ACCESS',
    containsSecretValues: false, region: config.region, namespace: config.namespace, functions,
    frontend: { appid, runtimeProfile: 'experience', useCloudBase: false, enableDevPhoneLogin: false,
      mediaStorageProvider: 'cloudbase', cloudbaseStorageEnvId: media.envId,
      scfRequestTimeoutMs: Math.min(60000, Math.max(15000, Number(config.frontend?.requestTimeoutMs) || 60000)),
      scfApiBaseUrl: urls['api-scf'], authScfBaseUrl: urls['auth-scf'], agentScfBaseUrl: urls['agent-scf'] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = name => args[args.indexOf(name) + 1];
    if (!args.includes('--config')) throw new Error('Usage: node tools/render-config.mjs --config <candidate.json> [--out <rendered.local.json>] [--allow-placeholders]');
    const result = renderConfiguration(readJson(path.resolve(value('--config'))), { allowPlaceholders: args.includes('--allow-placeholders') });
    const output = path.resolve(args.includes('--out') ? value('--out') : path.join(cloudRoot, 'candidate.rendered.local.json'));
    writeJson(output, result);
    console.log(JSON.stringify({ ok: true, output, claim: result.claim,
      functions: Object.fromEntries(Object.entries(result.functions).map(([name, unit]) => [name, {
        publicEnvironmentUtf8Bytes: unit.publicEnvironmentUtf8Bytes, requiredSecretEnvironment: unit.requiredSecretEnvironment
      }])) }, null, 2));
  } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
