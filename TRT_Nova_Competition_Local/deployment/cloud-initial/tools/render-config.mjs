#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudRoot, loadPolicy, hasPlaceholder, isTrue, readJson, writeJson, measureEnvironmentUtf8Bytes } from './common.mjs';

// This renderer handles names and logical references ONLY; never fetches/decrypts secrets.
const MEDIA_FUNCTIONS = new Set(['api-scf', 'agent-scf', 'history-cleanup-scf']);
const SECRET_NAME = /^(?:DB_USER|DB_PASSWORD|DB_SSL_CA|JWT_SECRET|WECHAT_SECRET|LLM_API_KEY|QWEATHER_PRIVATE_KEY|ONE_NET_TOKEN|ONE_NET_AES_KEY|EMQX_WEBHOOK_TOKEN|TENCENTCLOUD_SECRETID|TENCENTCLOUD_SECRETKEY|TENCENTCLOUD_SESSIONTOKEN)$/;
const UNKNOWN_SECRET_NAME = /(?:^|_)(?:SECRET(?:ID|KEY)?|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY|TOKEN)$/;
export function renderConfiguration(config, { allowPlaceholders = false } = {}) {
  if (config.environment !== 'staging' || config.secretResolution?.strategy !== 'runtime-ssm-sdk') throw new Error('Only staging runtime-ssm-sdk is supported');
  if (config.database?.tlsMode !== 'required' || config.media?.mode !== 'cos-proxy') throw new Error('Cloud requires TLS and cos-proxy');
  for (const environment of Object.values(config.plainEnvironment || {})) {
    for (const key of Object.keys(environment || {})) {
      if (SECRET_NAME.test(key) || UNKNOWN_SECRET_NAME.test(key) || /(?:_KEY_FILE|PRIVATE_KEY_FILE)$/.test(key)) throw new Error(`Secret material is forbidden in plainEnvironment: ${key}`);
      if (key === 'LOCAL_DEV_OPENID' || key === 'LOCAL_DEV_AUTH_ENABLED') throw new Error('Local development identity is forbidden');
    }
  }
  const functions = {};
  for (const unit of loadPolicy().functions) {
    const refs = { DB_USER: config.database.userSecretRef, DB_PASSWORD: config.database.passwordSecretRef };
    if (config.database.tlsCaSecretRef) refs.DB_SSL_CA = config.database.tlsCaSecretRef;
    if (['api-scf', 'auth-scf', 'agent-scf'].includes(unit.name)) refs.JWT_SECRET = config.secrets.jwtSecretRef;
    if (unit.name === 'auth-scf') refs.WECHAT_SECRET = config.secrets.wechatSecretRef;
    if (unit.name === 'agent-scf') refs.LLM_API_KEY = config.secrets.llmApiKeySecretRef;
    if (unit.name === 'api-scf' && isTrue(config.plainEnvironment['api-scf'].QWEATHER_ENABLED)) {
      for (const key of ['QWEATHER_API_HOST', 'QWEATHER_PROJECT_ID', 'QWEATHER_CREDENTIAL_ID']) {
        if (!allowPlaceholders && hasPlaceholder(config.plainEnvironment['api-scf'][key])) {
          throw new Error(`Weather enabled but missing ${key}`);
        }
      }
      refs.QWEATHER_PRIVATE_KEY = config.secrets.qweatherPrivateKeySecretRef;
    }
    if (unit.name === 'ingest-scf') {
      for (const [key, value] of Object.entries({ ONE_NET_TOKEN: config.secrets.oneNetTokenSecretRef,
        ONE_NET_AES_KEY: config.secrets.oneNetAesKeySecretRef, EMQX_WEBHOOK_TOKEN: config.secrets.emqxWebhookTokenSecretRef })) {
        if (value && !hasPlaceholder(value)) refs[key] = value;
      }
    }
    for (const reference of Object.values(refs)) {
      if (allowPlaceholders && hasPlaceholder(reference)) continue;
      if (!/^secret:\/\/[a-z0-9._/-]+(?:#[a-z0-9._-]+)?$/i.test(reference || '') || String(reference).includes('..')) throw new Error('Expected a secret:// reference, never a secret value');
    }
    const environment = { ...config.plainEnvironment.common, ...config.plainEnvironment[unit.name],
      NOVA_FUNCTION_NAME: unit.name, NOVA_REGION: config.region, DB_HOST: config.database.host,
      DB_PORT: String(config.database.port || 3306), DB_NAME: config.database.name,
      DB_TLS_MODE: 'required', NOVA_SECRET_STRATEGY: 'runtime-ssm-sdk', NOVA_SECRET_REFS: JSON.stringify(refs) };
    if (MEDIA_FUNCTIONS.has(unit.name)) Object.assign(environment, { MEDIA_STORAGE_PROVIDER: 'cos',
      COS_BUCKET: config.media.cosBucket, COS_REGION: config.media.cosRegion, COS_PREFIX: config.media.cosPrefix,
      LOCAL_MEDIA_ENABLED: 'false' });
    if (!allowPlaceholders && Object.values(environment).some(value => value !== '' && hasPlaceholder(value))) throw new Error(`Unconfigured environment: ${unit.name}`);
    if (/^(?:localhost\.?|0\.0\.0\.0|127\..*|\[?::1\]?|\[?::ffff:127\..*)$/i.test(environment.DB_HOST)) throw new Error('Loopback database is forbidden');
    const bytes = measureEnvironmentUtf8Bytes(environment);
    if (bytes > 4096) throw new Error(`Environment exceeds 4096 UTF-8 bytes: ${unit.name}`);
    functions[unit.name] = { functionType: 'Event', runtime: loadPolicy().runtime, handler: 'cloud-entry.main_handler',
      timeoutSeconds: unit.timeoutSeconds, environment, environmentUtf8Bytes: bytes };
  }
  const base = config.ingress?.httpsCustomDomain || '';
  if (!(allowPlaceholders && hasPlaceholder(base))) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /^(?:localhost\.?|(?:\d+\.){3}\d+|\[.*\])$/i.test(url.hostname)) throw new Error('Expected an HTTPS custom domain origin');
  }
  // The login service owns AppID. Accept the old frontend field only if consistent.
  const appid = config.plainEnvironment['auth-scf'].WECHAT_APPID;
  const frontendAppid = config.frontend?.appid;
  if (frontendAppid && !hasPlaceholder(frontendAppid) && !hasPlaceholder(appid) && frontendAppid !== appid) {
    throw new Error('Frontend AppID must match auth-scf.WECHAT_APPID');
  }
  if (!allowPlaceholders && hasPlaceholder(appid)) throw new Error('Unconfigured frontend appid');
  return { schemaVersion: 'nova.cloud-rendered/v1', claim: 'CONFIGURATION_ONLY_NO_CLOUD_ACCESS',
    containsSecretValues: false, region: config.region, namespace: config.namespace, functions,
    frontend: { appid,
      runtimeProfile: 'experience', useCloudBase: false, enableDevPhoneLogin: false,
      scfRequestTimeoutMs: Math.min(60000, Math.max(15000, Number(config.frontend?.requestTimeoutMs) || 60000)),
      scfApiBaseUrl: base, authScfBaseUrl: base, agentScfBaseUrl: base } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = (name) => args[args.indexOf(name) + 1];
    if (!args.includes('--config')) throw new Error('Usage: node tools/render-config.mjs --config <candidate.json> [--out <rendered.local.json>] [--allow-placeholders]');
    const result = renderConfiguration(readJson(path.resolve(value('--config'))), { allowPlaceholders: args.includes('--allow-placeholders') });
    const output = path.resolve(args.includes('--out') ? value('--out') : path.join(cloudRoot, 'candidate.rendered.local.json'));
    writeJson(output, result);
    console.log(JSON.stringify({ ok: true, output, claim: result.claim, functions: Object.fromEntries(Object.entries(result.functions).map(([name, value]) => [name, value.environmentUtf8Bytes])) }, null, 2));
  } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
