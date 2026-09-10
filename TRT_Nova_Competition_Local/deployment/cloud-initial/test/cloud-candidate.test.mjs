import assert from 'node:assert/strict';

test('支持 SCF 公网加 VPC，不把历史凭据撤换当成本次部署门槛', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  config.network.publicProviderEgress = { mode: 'scf-public-network', natGatewayId: '' };
  config.acknowledgements.deploymentCredentialSourcesVerified = true;
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.every(item => !item.includes('publicProviderEgress.mode') && !item.includes('NAT Gateway') && !item.includes('轮换')));
  config.network.publicProviderEgress.mode = 'vpc-nat';
  assert.ok(validateCandidateConfig(config).errors.some(item => item.includes('NAT Gateway')));
  config.network.publicProviderEgress.mode = 'unknown-egress';
  assert.ok(validateCandidateConfig(config).errors.some(item => item.includes('publicProviderEgress.mode')));
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
    const uuidVersions = Object.entries(lock.packages).filter(([key]) => /(?:^|\/)node_modules\/uuid$/.test(key)).map(([, value]) => value.version);
    assert.deepEqual(uuidVersions, ['11.1.1']);
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

test('Function URL + SCF custom domain 路由清单与当前 handler 保持精确同步', () => {
  assert.equal(fs.existsSync(path.join(cloudRoot, 'api-gateway-routes.template.yaml')), false);
  const template = fs.readFileSync(path.join(cloudRoot, 'function-url-routes.template.yaml'), 'utf8');
  assert.match(template, /functionType:\s*["']Event["']/);
  assert.match(template, /PENDING_D_LEVEL_STAGING_COMPATIBILITY_TEST/);
  assert.doesNotMatch(template, /kind:\s*["']TencentApiGateway/);
  const mappingSection = template.split('customDomainPathMappings:')[1].split('routeGroups:')[0];
  const mappings = [...mappingSection.matchAll(/path:\s*["']([^"']+)["']\s*,\s*function:\s*["']([^"']+)["']/g)]
    .map((match) => `${match[1]} -> ${match[2]}`)
    .sort();
  assert.deepEqual(mappings, [
    '/agent/* -> agent-scf',
    '/ai/* -> api-scf',
    '/auth/* -> auth-scf',
    '/care/* -> api-scf',
    '/device/* -> api-scf',
    '/document/* -> agent-scf',
    '/health -> api-scf',
    '/ingest -> ingest-scf',
    '/journal/* -> api-scf',
    '/media/* -> api-scf',
    '/knowledge/* -> api-scf',
    '/plant/* -> api-scf',
    '/todo/* -> api-scf',
    '/user/* -> api-scf',
    '/vision/* -> agent-scf',
    '/weather/* -> api-scf'
  ].sort());
  const authSection = template.split('  auth-scf:')[1].split('  api-scf:')[0];
  const apiSection = template.split('  api-scf:')[1].split('  agent-scf:')[0];
  const agentSection = template.split('  agent-scf:')[1].split('  ingest-scf:')[0];
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

test('资源元数据填完仍因真实 SSM role 与 COS 验收缺失阻断，不再伪称适配未实现', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  Object.assign(config, {
    region: 'ap-guangzhou',
    namespace: 'nova-staging'
  });
  Object.assign(config.ingress, {
    httpsCustomDomain: 'https://staging.example.invalid'
  });
  Object.assign(config.network, {
    vpcId: 'vpc-staging',
    subnetId: 'subnet-staging'
  });
  Object.assign(config.network.publicProviderEgress, {
    mode: 'vpc-nat',
    natGatewayId: 'nat-staging'
  });
  Object.assign(config.database, {
    host: 'mysql.internal.example',
    name: 'nova_staging',
    userSecretRef: 'secret://nova-staging/mysql#username',
    passwordSecretRef: 'secret://nova-staging/mysql#password',
    tlsMode: 'required'
  });
  Object.assign(config.media, { cosBucket: 'nova-test-123456', cosRegion: 'ap-guangzhou' });
  Object.assign(config.secrets, {
    jwtSecretRef: 'secret://nova-staging/auth#jwt',
    wechatSecretRef: 'secret://nova-staging/wechat#secret',
    llmApiKeySecretRef: 'secret://nova-staging/llm#api-key'
  });
  config.plainEnvironment['auth-scf'].WECHAT_APPID = 'wx-staging-appid';
  Object.assign(config.plainEnvironment['agent-scf'], {
    LLM_API_BASE_URL: 'https://llm.example.invalid/v1',
    LLM_MODEL: 'verified-text-model',
    VISION_MODEL: 'verified-vision-model'
  });
  Object.assign(config.acknowledgements, {
    deploymentCredentialSourcesVerified: true,
    databaseMigrationVerified: true,
    functionUrlEventCompatibilityVerified: true,
    customDomainPathMappingVerified: true,
    vpcPrivateDatabaseAndPublicProviderEgressVerified: true,
    timerTimezoneSemanticsVerified: true
  });
  config.secretResolution.strategy = 'runtime-ssm-sdk';
  config.artifactAndInterfaceBudgets.layerInventory.verifiedAgainstTargetFunctionVersions = true;
  config.artifactAndInterfaceBudgets.finalRenderedEnvironmentVerified = true;
  config.artifactAndInterfaceBudgets.payloadLimitsVerifiedInStaging = true;
  config.finalEnvironmentByFunction = Object.fromEntries(loadPolicy().functions.map((item) => [
    item.name,
    { ...config.plainEnvironment.common, ...config.plainEnvironment[item.name], NOVA_FUNCTION_NAME: item.name }
  ]));
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.some(item => /SSM 最小权限/.test(item)));
  assert.ok(result.errors.some(item => /云媒体生命周期/.test(item)));
  assert.ok(result.errors.every(item => !/未实现/.test(item)));
});

test('Event Function、handler 与 SCF 配额合同均为机器可审计固定值', () => {
  const policy = loadPolicy();
  assert.equal(policy.functionType, 'Event');
  assert.equal(policy.handler, 'cloud-entry.main_handler');
  assert.ok(policy.functions.every((item) => item.functionType === 'Event'));
  assert.equal(policy.artifactLimits.zipMaxBytesExclusive, 50 * 1024 * 1024);
  assert.equal(policy.artifactLimits.codeAndLayersMaxBytesInclusive, 500 * 1024 * 1024);
  assert.equal(policy.artifactLimits.candidateLayerBytes, 0);
  assert.equal(policy.interfaceLimits.environmentUtf8MaxBytesInclusive, 4096);
  assert.equal(policy.interfaceLimits.syncInvocationPayloadMaxBytesInclusive, 6 * 1024 * 1024);
  assert.equal(policy.interfaceLimits.asyncInvocationPayloadMaxBytesInclusive, 128 * 1024);
  const manifest = fs.readFileSync(path.join(cloudRoot, 'scf-manifest.template.yaml'), 'utf8');
  assert.equal((manifest.match(/^\s*functionType:\s*["']Event["']\s*$/gm) || []).length, 6);
  assert.match(manifest, /handler:\s*["']cloud-entry\.main_handler["']/);
  assert.doesNotMatch(manifest, /trigger:\s*["']api-gateway/i);
});

test('每函数逻辑环境变量按 UTF-8 字节计数并在 4096 字节处 fail-closed', () => {
  const config = JSON.parse(fs.readFileSync(path.join(cloudRoot, 'candidate.config.example.json'), 'utf8'));
  const baseline = measureLogicalEnvironmentUtf8Bytes(config);
  assert.ok(Object.values(baseline).every((bytes) => bytes > 0 && bytes < 4096));
  assert.equal(measureEnvironmentUtf8Bytes({ A: '植' }), 4);
  config.plainEnvironment['auth-scf'].UTF8_BUDGET_PROBE = '植'.repeat(1400);
  config.finalEnvironmentByFunction = Object.fromEntries(loadPolicy().functions.map((item) => [
    item.name,
    { ...config.plainEnvironment.common, ...config.plainEnvironment[item.name], NOVA_FUNCTION_NAME: item.name }
  ]));
  const result = validateCandidateConfig(config);
  assert.ok(result.errors.some((item) => item.includes('auth-scf 逻辑环境变量 UTF-8 字节数')));
  assert.ok(result.errors.some((item) => item.includes('auth-scf 最终环境变量 UTF-8 字节数')));
  assert.equal(result.logicalEnvironmentMeasurementIsFinalEvidence, false);
});

test('云端入口先解析凭据再导入业务，媒体可委派而本地替代路径仍被阻止', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cloud-entry-'));
  fs.copyFileSync(path.join(cloudRoot, 'overlays', 'cloud-entry.js'), path.join(tempRoot, 'cloud-entry.js'));
  fs.copyFileSync(path.join(cloudRoot, 'overlays', 'cloud-media.js'), path.join(tempRoot, 'cloud-media.js'));
  fs.writeFileSync(path.join(tempRoot, 'cloud-secrets.js'), 'exports.initialize = async () => { process.env.NOVA_TEST_SECRETS_READY = "yes"; };\n');
  fs.writeFileSync(
    path.join(tempRoot, 'index.js'),
    "if (process.env.NOVA_TEST_SECRETS_READY !== 'yes') throw new Error('delegate imported before secrets');\nexports.main_handler = async () => ({ statusCode: 204, body: '' });\n",
    'utf8'
  );
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      NOVA_FUNCTION_NAME: 'api-scf',
      DB_HOST: 'mysql.internal.example',
      DB_NAME: 'nova',
      DB_USER: 'secret-injected-user',
      DB_PASSWORD: 'secret-injected-password',
      DB_TLS_MODE: 'required',
      MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'nova-test-123456', COS_REGION: 'ap-guangzhou', COS_PREFIX: 'nova-staging/test/',
      JWT_SECRET: '0123456789abcdef0123456789abcdef',
      ALLOW_LEGACY_OPENID_FALLBACK: 'false',
      LOCAL_MEDIA_ENABLED: 'false',
      NOVA_DEVICE_COMMANDS_ENABLED: 'false'
    });
    const requireFromTemp = createRequire(path.join(tempRoot, 'runner.cjs'));
    const entry = requireFromTemp('./cloud-entry.js');
    const missingVisionModel = entry._private.validateRuntimeEnvironment('agent-scf', {
      ...process.env,
      DB_HOST: 'mysql.internal.example',
      DB_NAME: 'nova',
      DB_USER: 'secret-injected-user',
      DB_PASSWORD: 'secret-injected-password',
      JWT_SECRET: '0123456789abcdef0123456789abcdef',
      ALLOW_LEGACY_OPENID_FALLBACK: 'false',
      DEBUG_OPENID: '',
      AGENT_SHADOW_ENABLED: 'false',
      AGENT_ROLLOUT_ENABLED: 'true',
      LLM_API_ENABLED: 'true',
      LLM_API_BASE_URL: 'https://llm.example.invalid/v1',
      LLM_API_KEY: 'secret-injected-key',
      LLM_MODEL: 'verified-text-model'
    });
    assert.match(missingVisionModel, /VISION_MODEL/);
    const mediaResponse = await entry.main_handler({ path: '/media/upload' });
    assert.equal(mediaResponse.statusCode, 204);
    const ordinaryResponse = await entry.main_handler({ path: '/knowledge/categories' });
    assert.equal(ordinaryResponse.statusCode, 204);
    process.env.LOCAL_DEV_OPENID = 'old-local-user';
    assert.match((await entry.main_handler({ path: '/knowledge/categories' })).body, /CLOUD_CONFIGURATION_BLOCKED/);
    delete process.env.LOCAL_DEV_OPENID;
    process.env.LOCAL_MEDIA_ENABLED = 'true';
    const unsafeResponse = await entry.main_handler({ path: '/knowledge/categories' });
    assert.equal(unsafeResponse.statusCode, 503);
    assert.match(unsafeResponse.body, /CLOUD_CONFIGURATION_BLOCKED/);

    process.env.LOCAL_MEDIA_ENABLED = 'false';
    process.env.NOVA_FUNCTION_NAME = 'ingest-scf';
    process.env.NOVA_INGEST_ENABLED = 'true';
    process.env.ONE_NET_TOKEN = 'secret-injected-token';
    const wrongIngestPath = await entry.main_handler({ httpMethod: 'POST', path: '/anything-else' });
    assert.equal(wrongIngestPath.statusCode, 404);

    process.env.NOVA_FUNCTION_NAME = 'history-cleanup-scf';
    process.env.NOVA_HISTORY_CLEANUP_ENABLED = 'true';
    const publicCleanup = await entry.main_handler({ httpMethod: 'POST', path: '/cleanup' });
    assert.equal(publicCleanup.statusCode, 403);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(previous, key)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
