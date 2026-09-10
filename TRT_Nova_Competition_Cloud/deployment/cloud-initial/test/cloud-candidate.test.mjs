import assert from 'node:assert/strict';

test('复用 LastScf 网络配置，不新增 NAT 或凭据轮换门槛', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  assert.ok(validateCandidateConfig(config).errors.every(item => !/NAT|轮换/.test(item)));
  config.network.mode = 'unknown';
  assert.ok(validateCandidateConfig(config).errors.some(item => item.includes('network.mode')));
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  classifyDependencyPrunePath,
  cloudRoot,
  collectFirstPartyFiles,
  findDeployableArtifactPolicyViolations,
  loadPolicy,
  measureEnvironmentUtf8Bytes,
  measureLogicalEnvironmentUtf8Bytes,
  pruneInstalledDependencyArtifacts,
  repoRoot,
  scanFilesForLocalAbsolutePaths,
  scanTextForLikelySecrets,
  validateCandidateConfig,
  validateLockForFunction
} from '../tools/common.mjs';

function writeFixture(rootDir, relativePath, body = 'fixture') {
  const target = path.join(rootDir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
  return target;
}

function extractHandlerRoutes(source) {
  const positive = [...source.matchAll(/method === ['\"](GET|POST|PUT|PATCH|DELETE)['\"]\s*&&\s*path\.endsWith\(['\"]([^'\"]+)['\"]\)/g)]
    .map((match) => `${match[1]} ${match[2]}`);
  const singleAllowed = [...source.matchAll(/method !== ['\"](GET|POST|PUT|PATCH|DELETE)['\"]\s*\|\|\s*!path\.endsWith\(['\"]([^'\"]+)['\"]\)/g)]
    .map((match) => `${match[1]} ${match[2]}`);
  return [...positive, ...singleAllowed].sort();
}

function extractTemplateRoutes(section) {
  return [...section.matchAll(/method:\s*['\"](GET|POST|PUT|PATCH|DELETE)['\"]\s*,\s*path:\s*['\"]([^'\"]+)['\"]/g)]
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

test('云端候选精确包含五个 SCF 单元且 lockfile 与源依赖一致', () => {
  const policy = loadPolicy();
  assert.deepEqual(policy.functions.map((item) => item.name), [
    'auth-scf',
    'api-scf',
    'ingest-scf',
    'agent-scf',
    'history-cleanup-scf'
  ]);
  for (const functionConfig of policy.functions) {
    assert.deepEqual(validateLockForFunction(functionConfig), []);
    const lock = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'locks', functionConfig.name, 'package-lock.json')));
    assert.ok(Object.keys(lock.packages).every(key => !/cos-nodejs-sdk|tencentcloud-sdk-nodejs-ssm|@cloudbase\/signature-nodejs/.test(key)));
    assert.ok(collectFirstPartyFiles(policy, functionConfig).length >= 2);
  }
});

test('秘密扫描识别具体值但允许空值和占位符', () => {
  assert.equal(scanTextForLikelySecrets('JWT_SECRET=\nLLM_API_KEY=<secret-ref>\n', 'safe.env').length, 0);
  assert.equal(scanTextForLikelySecrets('JWT_SECRET=concrete-secret-value-123\n', 'unsafe.env').length, 1);
});

test('依赖裁剪规则精确识别 map、类型、文档和开发期产物', () => {
  const policy = loadPolicy();
  assert.equal(classifyDependencyPrunePath(policy, 'dist/runtime.js'), '');
  assert.equal(classifyDependencyPrunePath(policy, 'dist/runtime.js.map'), 'source-map');
  assert.equal(classifyDependencyPrunePath(policy, 'types/index.d.ts'), 'type-declaration');
  assert.equal(classifyDependencyPrunePath(policy, 'README.md'), 'documentation');
  assert.equal(classifyDependencyPrunePath(policy, 'http_signing.md'), 'documentation');
  assert.equal(classifyDependencyPrunePath(policy, 'http_signing.js'), '');
  assert.equal(classifyDependencyPrunePath(policy, 'test/parser.js'), 'development-directory');
  assert.equal(classifyDependencyPrunePath(policy, 'lib/parser.spec.js'), 'development-filename');
  assert.equal(classifyDependencyPrunePath(policy, 'lib/example-adapter.js'), 'development-filename');
});

test('依赖裁剪保留运行所需敏感资产，并在开发目录命中时先失败且不做部分删除', () => {
  const policy = loadPolicy();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cloud-prune-'));
  try {
    const nodeModules = path.join(tempRoot, 'node_modules');
    const runtimeJs = writeFixture(nodeModules, 'pkg/lib/runtime.js', 'module.exports = 1;');
    const runtimeWasm = writeFixture(nodeModules, 'pkg/assets/parser.wasm', 'runtime-wasm');
    const runtimeCertificate = writeFixture(nodeModules, 'pkg/certs/ca.pem', 'runtime-certificate');
    const runtimeDictionary = writeFixture(nodeModules, 'pkg/data/words.dict', 'runtime-dictionary');
    const sourceMap = writeFixture(nodeModules, 'pkg/lib/runtime.js.map');
    const declaration = writeFixture(nodeModules, 'pkg/types/index.d.ts');
    const readme = writeFixture(nodeModules, 'pkg/README.md');
    const testFile = writeFixture(nodeModules, 'pkg/test/parser.test.js');
    const exampleFile = writeFixture(nodeModules, 'pkg/lib/example-adapter.js');
    const protectedConflict = writeFixture(nodeModules, 'pkg/fixtures/test-ca.pem', 'must-not-delete-silently');

    assert.throws(
      () => pruneInstalledDependencyArtifacts(policy, tempRoot),
      /运行时敏感资产/
    );
    for (const filePath of [sourceMap, declaration, readme, testFile, exampleFile, protectedConflict]) {
      assert.equal(fs.existsSync(filePath), true, `冲突时不得先删除 ${filePath}`);
    }

    fs.unlinkSync(protectedConflict);
    const result = pruneInstalledDependencyArtifacts(policy, tempRoot);
    assert.equal(result.protectedConflicts.length, 0);
    assert.equal(result.removedFiles, 5);
    for (const filePath of [sourceMap, declaration, readme, testFile, exampleFile]) {
      assert.equal(fs.existsSync(filePath), false, `应裁剪 ${filePath}`);
    }
    for (const filePath of [runtimeJs, runtimeWasm, runtimeCertificate, runtimeDictionary]) {
      assert.equal(fs.existsSync(filePath), true, `必须保留 ${filePath}`);
    }
    assert.deepEqual(findDeployableArtifactPolicyViolations(policy, tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('候选包策略拒绝环境文件、开发期路径、本地媒体和绝对本机路径', () => {
  const policy = loadPolicy();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cloud-policy-'));
  try {
    const envFile = writeFixture(tempRoot, '.env.example', 'JWT_SECRET=<secret-ref>');
    writeFixture(tempRoot, 'test/handler.js');
    writeFixture(tempRoot, 'photo.jpg');
    const localPathFile = writeFixture(
      tempRoot,
      'index.js',
      "const leakedA = 'C:/Users/example/secret.txt';\nconst leakedB = 'D:\\\\Users\\\\example\\\\secret.txt';\n"
    );
    const violations = findDeployableArtifactPolicyViolations(policy, tempRoot);
    assert.ok(violations.some((item) => item.includes('.env.example: environment-file')));
    assert.ok(violations.some((item) => item.includes('test/handler.js: forbidden-first-party-path')));
    assert.ok(violations.some((item) => item.includes('photo.jpg: first-party-local-media')));
    assert.ok(scanFilesForLocalAbsolutePaths([localPathFile, envFile], tempRoot).some((item) => item.includes('C:/Users/')));
    assert.ok(scanFilesForLocalAbsolutePaths([localPathFile, envFile], tempRoot).some((item) => item.includes('D:\\\\Users')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('LastScf 独立 Function URL 路由清单与当前 handler 保持精确同步', () => {
  assert.equal(fs.existsSync(path.join(cloudRoot, 'api-gateway-routes.template.yaml')), false);
  const template = fs.readFileSync(path.join(cloudRoot, 'function-url-routes.template.yaml'), 'utf8');
  assert.match(template, /functionType:\s*["']Event["']/);
  assert.match(template, /PENDING_D_LEVEL_STAGING_COMPATIBILITY_TEST/);
  assert.doesNotMatch(template, /kind:\s*["']TencentApiGateway/);
  assert.doesNotMatch(template, /customDomainPathMappings|httpsCustomDomain/);
  for (const name of ['AUTH', 'API', 'AGENT']) assert.ok(template.includes('__FILL_' + name + '_SCF_FUNCTION_URL__'));
  const routeTemplate = template.split('routeGroups:')[1];
  const authSection = routeTemplate.split('  auth-scf:')[1].split('  api-scf:')[0];
  const apiSection = routeTemplate.split('  api-scf:')[1].split('  agent-scf:')[0];
  const agentSection = routeTemplate.split('  agent-scf:')[1].split('  ingest-scf:')[0];
  const sourceRoot = path.join(repoRoot, 'dist', 'scf');
  const authSource = fs.readFileSync(path.join(sourceRoot, 'auth-scf', 'index.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(sourceRoot, 'api-scf', 'index.js'), 'utf8');
  const agentSource = fs.readFileSync(path.join(sourceRoot, 'agent-scf', 'index.js'), 'utf8');
  assert.deepEqual(extractTemplateRoutes(authSection), extractHandlerRoutes(authSource));
  assert.deepEqual(extractTemplateRoutes(apiSection), extractHandlerRoutes(apiSource));
  assert.deepEqual(extractTemplateRoutes(agentSection), extractHandlerRoutes(agentSource));
});

test('示例配置必须因占位符、迁移确认和本次部署凭据来源未核对而无法发布', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.some((item) => item.includes('region')));
  assert.ok(result.errors.some((item) => item.includes('本次部署凭据')));
  assert.ok(result.errors.every((item) => !item.includes('轮换')));
  assert.ok(result.errors.some((item) => item.includes('数据库迁移')));
  assert.ok(result.errors.some((item) => item.includes('云媒体生命周期')));
});

test('部署模板仍因真实环境和云媒体验收缺失阻断，不伪称云上通过', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.some(item => /SCF 配置并核验/.test(item)));
  assert.ok(result.errors.some(item => /云媒体生命周期/.test(item)));
  assert.ok(result.errors.every(item => !/SSM 最小权限|未实现|COS 验收/.test(item)));
});

test('Event Function、handler 与 SCF 配额合同均为机器可审计固定值', () => {
  const policy = loadPolicy();
  assert.equal(policy.functionType, 'Event');
  assert.equal(policy.handler, 'index.main_handler');
  assert.ok(policy.functions.every((item) => item.functionType === 'Event'));
  assert.equal(policy.artifactLimits.zipMaxBytesExclusive, 50 * 1024 * 1024);
  assert.equal(policy.artifactLimits.codeAndLayersMaxBytesInclusive, 500 * 1024 * 1024);
  assert.equal(policy.artifactLimits.candidateLayerBytes, 0);
  assert.equal(policy.interfaceLimits.environmentUtf8MaxBytesInclusive, 4096);
  assert.equal(policy.interfaceLimits.syncInvocationPayloadMaxBytesInclusive, 6 * 1024 * 1024);
  assert.equal(policy.interfaceLimits.asyncInvocationPayloadMaxBytesInclusive, 128 * 1024);
  const manifest = fs.readFileSync(path.join(cloudRoot, 'scf-manifest.template.yaml'), 'utf8');
  assert.equal((manifest.match(/^\s*functionType:\s*["']Event["']\s*$/gm) || []).length, 6);
  assert.match(manifest, /handler:\s*["']index\.main_handler["']/);
  assert.doesNotMatch(manifest, /trigger:\s*["']api-gateway/i);
});

test('每函数逻辑环境变量按 UTF-8 字节计数并在 4096 字节处 fail-closed', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  const baseline = measureLogicalEnvironmentUtf8Bytes(config);
  assert.ok(Object.values(baseline).every((bytes) => bytes > 0 && bytes < 4096));
  assert.equal(measureEnvironmentUtf8Bytes({ A: '植' }), 4);
  config.plainEnvironment['auth-scf'].UTF8_BUDGET_PROBE = '植'.repeat(1400);
  config.verifiedEnvironmentUtf8BytesByFunction = Object.fromEntries(loadPolicy().functions.map(item => [item.name, item.name === 'auth-scf' ? 4200 : 2000]));
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.some((item) => item.includes('auth-scf 逻辑环境变量 UTF-8 字节数')));
  assert.ok(result.errors.some((item) => item.includes('auth-scf 最终环境变量 UTF-8 字节数')));
  assert.equal(result.logicalEnvironmentMeasurementIsFinalEvidence, false);
});

test('原生入口的校验只读 SCF 环境，不改变业务 handler 或引入凭据服务', () => {
  const require = createRequire(import.meta.url);
  const entry = require('../overlays/cloud-runtime.js');
  const env = {
    DB_HOST: 'mysql.internal.example', DB_NAME: 'nova',
    DB_USER: 'fixture-user', DB_PASSWORD: 'fixture-password', DB_TLS_MODE: 'legacy-direct',
    JWT_SECRET: '0123456789abcdef0123456789abcdef', WECHAT_APPID: 'wx-fixture', WECHAT_SECRET: 'fixture-wechat',
    MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-media-test',
    CLOUDBASE_STORAGE_REGION: 'ap-shanghai', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/test/media/',
    LOCAL_MEDIA_ENABLED: 'false', ALLOW_LEGACY_OPENID_FALLBACK: 'false'
  };
  assert.equal(entry.validateInvocation('api-scf', { path: '/media/upload' }, env), null);
  assert.equal(entry.validateInvocation('api-scf', { path: '/device/cmd' }, env).statusCode, 403);
  for (const bad of [{ LOCAL_DEV_OPENID: 'old-user' }, { LOCAL_MEDIA_ENABLED: 'true' },
    { DB_HOST: '127.0.0.1' }, { WECHAT_SECRET: '' }, { NOVA_FUNCTION_NAME: 'auth-scf' }]) {
    assert.equal(entry.validateInvocation('api-scf', {}, { ...env, ...bad }).statusCode, 503);
  }
  assert.match(entry._private.validateRuntimeEnvironment('agent-scf', { ...env, LLM_API_ENABLED: 'true',
    LLM_API_BASE_URL: 'https://llm.example.invalid', LLM_API_KEY: 'fixture-key', LLM_MODEL: 'text' }), /VISION_MODEL/);
  assert.equal(entry.validateInvocation('ingest-scf', { path: '/wrong' },
    { ...env, NOVA_INGEST_ENABLED: 'true', ONE_NET_TOKEN: 'fixture-token' }).statusCode, 404);
  assert.equal(entry.validateInvocation('history-cleanup-scf', { httpMethod: 'POST' },
    { ...env, NOVA_HISTORY_CLEANUP_ENABLED: 'true' }).statusCode, 403);
  assert.equal(fs.existsSync(path.join(cloudRoot, 'overlays/cloud-secrets.js')), false);
  assert.equal(fs.existsSync(path.join(cloudRoot, 'overlays/cloud-entry.js')), false);
  for (const unit of loadPolicy().functions) {
    const source = fs.readFileSync(path.join(repoRoot, 'dist/scf', unit.name, 'index.js'), 'utf8');
    assert.match(source, /exports.main_handler/);
    assert.ok(source.includes("validateInvocation('" + unit.name + "'"));
  }
});
