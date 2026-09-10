import assert from 'node:assert/strict';

test('天气关闭时不解析天气私钥，启用时要求完整参数', () => {
  const config = configuredFixture();
  const api = config.plainEnvironment['api-scf'];
  api.QWEATHER_ENABLED = 'false';
  assert.equal(renderConfiguration(config).functions['api-scf'].requiredSecretEnvironment.includes('QWEATHER_PRIVATE_KEY'), false);
  api.QWEATHER_ENABLED = 'true';
  assert.equal(renderConfiguration(config).functions['api-scf'].requiredSecretEnvironment.includes('QWEATHER_PRIVATE_KEY'), true);
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
import { cloudRoot, repoRoot, readJson, sha256File, validateCandidateConfig } from '../tools/common.mjs';
import { renderConfiguration } from '../tools/render-config.mjs';
import { snapshotClient } from '../tools/snapshot-client.mjs';

function configuredFixture() {
  const config = readJson(path.join(cloudRoot, 'candidate.config.example.json'));
  config.region = 'ap-shanghai'; config.namespace = 'nova-staging';
  config.ingress.functionUrls = Object.fromEntries(['auth-scf', 'api-scf', 'agent-scf'].map(name => [name, 'https://' + name + '.example.invalid']));
  Object.assign(config.database, { host: 'mysql.legacy.invalid', name: 'nova_staging' });
  Object.assign(config.media, { envId: 'nova-media-test', region: 'ap-shanghai' });
  config.plainEnvironment['auth-scf'].WECHAT_APPID = 'wx-fixture';
  Object.assign(config.plainEnvironment['api-scf'], { QWEATHER_ENABLED: 'true', QWEATHER_API_HOST: 'weather.example.invalid', QWEATHER_PROJECT_ID: 'fixture-project', QWEATHER_CREDENTIAL_ID: 'fixture-credential' });
  Object.assign(config.plainEnvironment['agent-scf'], { LLM_API_BASE_URL: 'https://llm.example.invalid', LLM_MODEL: 'fixture-text', VISION_MODEL: 'fixture-vision' });
  return config;
}

test('渲染器产生可用的非秘密环境，每函数只列出必要的 SCF 秘密变量名', () => {
  const result = renderConfiguration(configuredFixture());
  assert.equal(result.containsSecretValues, false);
  assert.equal(Object.keys(result.functions).length, 5);
  for (const [name, unit] of Object.entries(result.functions)) {
    assert.equal(unit.handler, 'index.main_handler');
    assert.equal(unit.environment.DB_TLS_MODE, 'legacy-direct');
    assert.equal(unit.environment.DB_PORT, '28245');
    assert.equal(unit.optionalSecretEnvironment.includes('DB_SSL_CA'), false);
    assert.equal(unit.environment.NOVA_SECRET_STRATEGY, undefined);
    const refs = unit.requiredSecretEnvironment;
    assert.equal(refs.includes('WECHAT_SECRET'), name !== 'ingest-scf');
    assert.equal(refs.includes('LLM_API_KEY'), name === 'agent-scf');
    assert.equal(refs.includes('QWEATHER_PRIVATE_KEY'), name === 'api-scf');
    assert.ok(unit.publicEnvironmentUtf8Bytes < 4096);
    assert.equal(unit.environment.DB_PASSWORD, undefined);
  }
  assert.equal(result.functions['agent-scf'].environment.AGENT_ROLLOUT_ENABLED, 'true');
  assert.equal(result.functions['agent-scf'].environment.AGENT_ROLLOUT_SAMPLE_RATE, '1');
  assert.equal(result.functions['agent-scf'].environment.AGENT_SHADOW_ENABLED, 'false');
  assert.equal(result.frontend.scfRequestTimeoutMs, 60000);
  assert.equal(result.frontend.useCloudBase, false);
  assert.equal(result.frontend.mediaStorageProvider, 'cloudbase');
  assert.equal(result.frontend.cloudbaseStorageEnvId, 'nova-media-test');
  for (const name of ['api-scf', 'agent-scf', 'history-cleanup-scf']) {
    assert.equal(result.functions[name].environment.MEDIA_STORAGE_PROVIDER, 'cloudbase');
    assert.equal(result.functions[name].environment.CLOUDBASE_STORAGE_ENV_ID, 'nova-media-test');
  }
  assert.equal(result.functions['auth-scf'].environment.MEDIA_STORAGE_PROVIDER, undefined);
});

test('云开发附件配置缺失或错误时阻止生成，不静默回退旧环境', () => {
  const config = configuredFixture();
  for (const key of ['envId', 'region', 'prefix']) {
    const invalid = structuredClone(config); invalid.media[key] = '';
    assert.throws(() => renderConfiguration(invalid), /CloudBase/);
  }
  const legacy = structuredClone(config); legacy.media.mode = 'cos-proxy';
  assert.throws(() => renderConfiguration(legacy), /CloudBase media/);
});

test('独立函数地址不可合并；私网与校验型 TLS 保留为可选模式', () => {
  const config = configuredFixture();
  config.ingress.functionUrls['auth-scf'] = config.ingress.functionUrls['api-scf'];
  assert.throws(() => renderConfiguration(config), /three separate/);
  config.ingress.functionUrls['auth-scf'] = 'https://auth-scf.example.invalid';
  config.database.tlsMode = 'private-network';
  for (const unit of Object.values(renderConfiguration(config).functions)) {
    assert.equal(unit.environment.DB_TLS_MODE, 'private-network');
    assert.equal(unit.optionalSecretEnvironment.includes('DB_SSL_CA'), false);
  }
  config.database.tlsMode = 'required';
  for (const unit of Object.values(renderConfiguration(config).functions)) {
    assert.equal(unit.environment.DB_TLS_MODE, 'required');
    assert.deepEqual(unit.optionalSecretEnvironment.filter(name => name === 'DB_SSL_CA'), ['DB_SSL_CA']);
  }
});

test('旧直连有明确非 TLS 提示；模式缺失或拼写错误不得静默降级', () => {
  const config = configuredFixture();
  assert.ok(validateCandidateConfig(config).warnings.some(message => /legacy-direct.*不启用 TLS/.test(message)));
  for (const mode of ['', undefined, 'require', 'disabled']) {
    config.database.tlsMode = mode;
    assert.throws(() => renderConfiguration(config), /MySQL configuration/);
    assert.ok(validateCandidateConfig(config).errors.some(message => /database.tlsMode/.test(message)));
  }
});

test('合成的完整验收记录可满足合同，无 SSM、COS、自定义域名或新 NAT 前提', () => {
  const config = configuredFixture();
  for (const name of Object.keys(config.acknowledgements)) config.acknowledgements[name] = true;
  config.artifactAndInterfaceBudgets.layerInventory.verifiedAgainstTargetFunctionVersions = true;
  config.artifactAndInterfaceBudgets.finalRenderedEnvironmentVerified = true;
  config.artifactAndInterfaceBudgets.payloadLimitsVerifiedInStaging = true;
  config.verifiedEnvironmentUtf8BytesByFunction = Object.fromEntries(Object.keys(renderConfiguration(config).functions).map(name => [name, 3000]));
  assert.deepEqual(validateCandidateConfig(config).errors, []);
  // Only this in-memory fixture asserts acceptance; it is never written as release configuration.
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
  config.secrets = { jwtSecretRef: 'secret://old/auth#jwt' };
  assert.throws(() => renderConfiguration(config), /Secret-manager/);
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
    assert.equal(config.scfApiBaseUrl, 'https://api-scf.example.invalid');
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
