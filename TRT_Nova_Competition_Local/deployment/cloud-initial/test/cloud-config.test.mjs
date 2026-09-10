import assert from 'node:assert/strict';

test('天气关闭时不解析天气私钥，启用时要求完整参数', () => {
  const config = configuredFixture();
  const api = config.plainEnvironment['api-scf'];
  api.QWEATHER_ENABLED = 'false';
  config.secrets.qweatherPrivateKeySecretRef = '';
  const refs = JSON.parse(renderConfiguration(config).functions['api-scf'].environment.NOVA_SECRET_REFS);
  assert.equal(refs.QWEATHER_PRIVATE_KEY, undefined);
  api.QWEATHER_ENABLED = 'true';
  assert.throws(() => renderConfiguration(config), /secret:\/\//);
  config.secrets.qweatherPrivateKeySecretRef = 'secret://nova-staging/weather#key';
  api.QWEATHER_PROJECT_ID = '';
  assert.throws(() => renderConfiguration(config), /QWEATHER_PROJECT_ID/);
});

test('前端只使用登录服务的 AppID，旧双字段不一致时拒绝生成', () => {
  const config = configuredFixture();
  delete config.frontend.appid;
  assert.equal(renderConfiguration(config).frontend.appid, config.plainEnvironment['auth-scf'].WECHAT_APPID);
  config.frontend.appid = 'wx-another-app';
  assert.throws(() => renderConfiguration(config), /AppID must match/);
});

test('填齐已启用的天气参数后确实成为 ready', () => {
  const config = configuredFixture();
  const rendered = renderConfiguration(config);
  const require = createRequire(import.meta.url);
  const { readQWeatherConfig } = require(path.join(repoRoot, 'dist/scf/api-scf/lib/qweather-client.js'));
  const weather = readQWeatherConfig({ ...rendered.functions['api-scf'].environment, QWEATHER_PRIVATE_KEY: 'synthetic-private-key' });
  assert.equal(weather.enabled, true);
  assert.equal(weather.ready, true);
});

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cloudRoot, repoRoot, readJson, sha256File } from '../tools/common.mjs';
import { renderConfiguration } from '../tools/render-config.mjs';
import { snapshotClient } from '../tools/snapshot-client.mjs';

function configuredFixture() {
  const config = readJson(path.join(cloudRoot, 'candidate.config.example.json'));
  config.region = 'ap-guangzhou'; config.namespace = 'nova-staging';
  config.ingress.httpsCustomDomain = 'https://nova.example.invalid';
  Object.assign(config.database, { host: 'mysql.private.invalid', name: 'nova_staging',
    userSecretRef: 'secret://nova-staging/mysql#user', passwordSecretRef: 'secret://nova-staging/mysql#password',
    tlsCaSecretRef: 'secret://nova-staging/mysql#ca' });
  Object.assign(config.secrets, { jwtSecretRef: 'secret://nova-staging/auth#jwt', wechatSecretRef: 'secret://nova-staging/auth#wechat',
    llmApiKeySecretRef: 'secret://nova-staging/llm#key', qweatherPrivateKeySecretRef: 'secret://nova-staging/weather#key' });
  Object.assign(config.media, { cosBucket: 'nova-test-123456', cosRegion: 'ap-guangzhou' });
  config.plainEnvironment['auth-scf'].WECHAT_APPID = 'wx-fixture';
  Object.assign(config.plainEnvironment['api-scf'], { QWEATHER_ENABLED: 'true', QWEATHER_API_HOST: 'weather.example.invalid', QWEATHER_PROJECT_ID: 'fixture-project', QWEATHER_CREDENTIAL_ID: 'fixture-credential' });
  Object.assign(config.plainEnvironment['agent-scf'], { LLM_API_BASE_URL: 'https://llm.example.invalid', LLM_MODEL: 'fixture-text', VISION_MODEL: 'fixture-vision' });
  config.frontend.appid = 'wx-fixture';
  return config;
}

test('渲染器产生可用的非秘密环境，每函数只取必要的 SSM 引用', () => {
  const result = renderConfiguration(configuredFixture());
  assert.equal(result.containsSecretValues, false);
  assert.equal(Object.keys(result.functions).length, 5);
  for (const [name, unit] of Object.entries(result.functions)) {
    assert.equal(unit.environment.DB_TLS_MODE, 'required');
    assert.equal(unit.environment.NOVA_SECRET_STRATEGY, 'runtime-ssm-sdk');
    const refs = JSON.parse(unit.environment.NOVA_SECRET_REFS);
    assert.equal(Boolean(refs.WECHAT_SECRET), name === 'auth-scf');
    assert.equal(Boolean(refs.LLM_API_KEY), name === 'agent-scf');
    assert.equal(Boolean(refs.QWEATHER_PRIVATE_KEY), name === 'api-scf');
    assert.ok(unit.environmentUtf8Bytes < 4096);
    assert.equal(unit.environment.DB_PASSWORD, undefined);
  }
  assert.equal(result.functions['agent-scf'].environment.AGENT_ROLLOUT_ENABLED, 'true');
  assert.equal(result.functions['agent-scf'].environment.AGENT_ROLLOUT_SAMPLE_RATE, '1');
  assert.equal(result.functions['agent-scf'].environment.AGENT_SHADOW_ENABLED, 'false');
  assert.equal(result.frontend.scfRequestTimeoutMs, 60000);
});

test('渲染器拒绝明文秘密、本地连接、未填写引用和越过平台的等待时间', () => {
  const config = configuredFixture();
  config.plainEnvironment.common.DB_PASSWORD = 'must-not-write';
  assert.throws(() => renderConfiguration(config), /Secret material/);
  delete config.plainEnvironment.common.DB_PASSWORD;
  for (const key of ['NEW_PROVIDER_API_KEY', 'OTHER_SECRET', 'CUSTOM_PASSWORD', 'SERVICE_TOKEN', 'LOCAL_DEV_OPENID']) {
    config.plainEnvironment.common[key] = 'must-not-write';
    assert.throws(() => renderConfiguration(config), /forbidden/);
    delete config.plainEnvironment.common[key];
  }
  config.database.host = '127.0.0.1';
  assert.throws(() => renderConfiguration(config), /Loopback/);
  config.database.host = 'mysql.private.invalid';
  config.secrets.jwtSecretRef = 'actual-secret-not-reference';
  assert.throws(() => renderConfiguration(config), /secret:\/\//);
  assert.throws(() => renderConfiguration(readJson(path.join(cloudRoot, 'candidate.config.example.json'))));
  const oversized = configuredFixture(); oversized.frontend.requestTimeoutMs = 95000;
  assert.equal(renderConfiguration(oversized).frontend.scfRequestTimeoutMs, 60000);
});

test('最新客户端候选保留已修光标/摘要和所有页面，替换云配置但不改本地入口', () => {
  const stateRoot = path.join(cloudRoot, 'state'); fs.mkdirSync(stateRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(stateRoot, 'client-test-'));
  const sourcePath = path.join(repoRoot, 'services/config/runtime-profile.js');
  const before = sha256File(sourcePath);
  try {
    const target = path.join(temp, 'miniprogram');
    snapshotClient(configuredFixture(), target);
    assert.equal(sha256File(sourcePath), before);
    const requireCandidate = createRequire(path.join(target, 'app.js'));
    const config = requireCandidate('./services/config/runtime-profile').resolveAppRuntimeConfig();
    assert.equal(config.useCloudBase, false);
    assert.equal(config.enableDevPhoneLogin, false);
    assert.equal(config.scfApiBaseUrl, 'https://nova.example.invalid');
    assert.equal(readJson(path.join(target, 'project.config.json')).setting.urlCheck, true);
    for (const file of ['components/conversation-composer/document.js', 'components/conversation-composer/index.js',
      'pages/aiMemory/aiMemory.js', 'pages/assistant/assistant.js']) {
      assert.equal(sha256File(path.join(target, file)), sha256File(path.join(repoRoot, file)));
    }
    for (const page of readJson(path.join(target, 'app.json')).pages) {
      for (const ext of ['.js', '.json', '.wxml', '.wxss']) assert.ok(fs.existsSync(path.join(target, page + ext)), page + ext);
    }
    assert.equal(fs.existsSync(path.join(target, '.env.local')), false);
    assert.equal(fs.existsSync(path.join(target, 'dist')), false);
    assert.throws(() => snapshotClient(configuredFixture(), target), /already exists/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
