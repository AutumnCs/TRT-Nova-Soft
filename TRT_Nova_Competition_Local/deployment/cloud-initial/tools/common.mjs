import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const toolsDir = path.dirname(fileURLToPath(import.meta.url));
export const cloudRoot = path.resolve(toolsDir, '..');
export const repoRoot = path.resolve(toolsDir, '..', '..', '..');
export const policyPath = path.join(cloudRoot, 'source-policy.json');

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadPolicy() {
  return readJson(policyPath);
}

export function normalizeRelative(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function assertInside(parent, child, label = 'path') {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error(`${label} 超出允许目录：${child}`);
}

export function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const output = [];
  const stack = [path.resolve(rootDir)];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`候选包禁止符号链接：${absolute}`);
      }
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  return output.sort((a, b) => a.localeCompare(b, 'en'));
}

function isTypeDeclaration(relativePath) {
  return /\.d\.(?:ts|mts|cts)$/i.test(relativePath);
}

function matchesDocumentationBasename(basename, candidates = []) {
  const lower = String(basename || '').toLowerCase();
  return candidates.some((candidate) => {
    const token = String(candidate || '').toLowerCase();
    return lower === token || lower.startsWith(`${token}.`);
  });
}

function matchesFilenameToken(basename, candidates = []) {
  const tokens = String(basename || '').toLowerCase().split(/[._-]+/).filter(Boolean);
  return candidates.some((candidate) => tokens.includes(String(candidate || '').toLowerCase()));
}

export function classifyDependencyPrunePath(policy, relativePath) {
  const prunePolicy = policy?.dependencyPrunePolicy || {};
  const relative = normalizeRelative(relativePath).toLowerCase();
  const segments = relative.split('/').filter(Boolean);
  const basename = segments.at(-1) || '';
  const directorySegments = segments.slice(0, -1);
  if (prunePolicy.removeSourceMaps && relative.endsWith('.map')) return 'source-map';
  if (prunePolicy.removeTypeDeclarations && isTypeDeclaration(relative)) return 'type-declaration';
  if ((prunePolicy.documentationFiles || []).includes(basename)) return 'documentation';
  if (matchesDocumentationBasename(basename, prunePolicy.documentationBasenames)) return 'documentation';
  if ((prunePolicy.developmentOnlyDirectorySegments || []).some((token) => directorySegments.includes(String(token).toLowerCase()))) {
    return 'development-directory';
  }
  if (matchesFilenameToken(basename, prunePolicy.developmentOnlyFilenameTokens)) return 'development-filename';
  return '';
}

function removeEmptyDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      visit(path.join(directory, entry.name));
    }
    if (directory !== rootDir && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  };
  visit(rootDir);
}

export function pruneInstalledDependencyArtifacts(policy, stagingDir) {
  const nodeModulesDir = path.join(stagingDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    return { removedFiles: 0, removedBytes: 0, reasons: {}, protectedConflicts: [] };
  }
  const prunePolicy = policy?.dependencyPrunePolicy || {};
  const sensitiveExtensions = new Set(
    (prunePolicy.runtimeSensitiveExtensions || []).map((value) => String(value).toLowerCase())
  );
  const planned = [];
  const protectedConflicts = [];
  for (const filePath of walkFiles(nodeModulesDir)) {
    const relative = normalizeRelative(path.relative(nodeModulesDir, filePath));
    const reason = classifyDependencyPrunePath(policy, relative);
    if (!reason) continue;
    const extension = path.extname(filePath).toLowerCase();
    if (sensitiveExtensions.has(extension)) {
      protectedConflicts.push(`${relative} (${reason}, protected ${extension})`);
    } else {
      planned.push({ filePath, relative, reason, bytes: fs.statSync(filePath).size });
    }
  }
  if (protectedConflicts.length) {
    throw new Error(
      `依赖裁剪命中运行时敏感资产，已停止且未删除任何文件：\n${protectedConflicts.join('\n')}`
    );
  }
  const reasons = {};
  let removedBytes = 0;
  for (const item of planned) {
    fs.unlinkSync(item.filePath);
    removedBytes += item.bytes;
    reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  }
  removeEmptyDirectories(nodeModulesDir);
  return {
    removedFiles: planned.length,
    removedBytes,
    reasons,
    protectedConflicts
  };
}

export function findDeployableArtifactPolicyViolations(policy, rootDir) {
  const prunePolicy = policy?.dependencyPrunePolicy || {};
  const mediaExtensions = new Set(
    (prunePolicy.firstPartyLocalMediaExtensions || []).map((value) => String(value).toLowerCase())
  );
  const violations = [];
  for (const filePath of walkFiles(rootDir)) {
    const relative = normalizeRelative(path.relative(rootDir, filePath));
    const lower = relative.toLowerCase();
    const segments = lower.split('/');
    const inNodeModules = segments[0] === 'node_modules';
    if (segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))) {
      violations.push(`${relative}: environment-file`);
      continue;
    }
    if (inNodeModules) {
      const reason = classifyDependencyPrunePath(policy, segments.slice(1).join('/'));
      if (reason) violations.push(`${relative}: dependency-${reason}`);
      continue;
    }
    const forbidden = (policy.forbiddenFirstPartyArtifactSegments || []).some((candidate) => {
      const token = normalizeRelative(candidate).toLowerCase();
      if (token.includes('/')) return lower.includes(token);
      return segments.includes(token);
    });
    if (forbidden) violations.push(`${relative}: forbidden-first-party-path`);
    if (mediaExtensions.has(path.extname(filePath).toLowerCase())) {
      violations.push(`${relative}: first-party-local-media`);
    }
    if (lower.endsWith('.map')) violations.push(`${relative}: first-party-source-map`);
    if (isTypeDeclaration(lower)) violations.push(`${relative}: first-party-type-declaration`);
  }
  return violations;
}

export function scanFilesForLocalAbsolutePaths(files, baseDir) {
  const findings = [];
  const textExtensions = new Set(['.js', '.cjs', '.mjs', '.json', '.yaml', '.yml', '.md', '.txt']);
  const localPathPatterns = [
    /\b[A-Za-z]:[\\/]{1,2}(?:Users|Documents and Settings|Desktop|Downloads|AppData|ProgramData|Windows|Temp|workspace|projects?|repos?)[\\/]{1,2}[^\s'"<>]+/gi,
    /\b[A-Za-z]:[\\/]{1,2}[^\x00-\x7F\s'"<>]{2,}[\\/]{1,2}[^\s'"<>]+/gu,
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\/[^\s'"<>]+/g
  ];
  for (const filePath of files) {
    if (!textExtensions.has(path.extname(filePath).toLowerCase())) continue;
    const relative = normalizeRelative(path.relative(baseDir, filePath));
    const text = fs.readFileSync(filePath, 'utf8');
    for (const localPathPattern of localPathPatterns) {
      for (const match of text.matchAll(localPathPattern)) {
        findings.push(`${relative} 含绝对本机路径：${match[0]}`);
      }
    }
  }
  return findings;
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function hasPlaceholder(value) {
  const text = String(value ?? '').trim();
  return !text || /(?:__FILL_|__REQUIRED_|__CONDITIONAL_|replace-with|<[^>]+>)/i.test(text);
}

export function isTrue(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? '').trim());
}

export function measureEnvironmentUtf8Bytes(environment = {}) {
  return Object.entries(environment).reduce(
    (total, [key, value]) => total + Buffer.byteLength(String(key), 'utf8') + Buffer.byteLength(String(value ?? ''), 'utf8'),
    0
  );
}

export function measureLogicalEnvironmentUtf8Bytes(config) {
  const common = config?.plainEnvironment?.common || {};
  const result = {};
  for (const functionConfig of loadPolicy().functions) {
    const environment = {
      ...common,
      ...(config?.plainEnvironment?.[functionConfig.name] || {}),
      NOVA_FUNCTION_NAME: functionConfig.name
    };
    result[functionConfig.name] = measureEnvironmentUtf8Bytes(environment);
  }
  return result;
}

export function packageJsonComparable(pkg = {}) {
  return {
    name: pkg.name || '',
    version: pkg.version || '',
    private: pkg.private === true,
    main: pkg.main || '',
    license: pkg.license || '',
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies || {}).sort(([a], [b]) => a.localeCompare(b, 'en'))
    ),
    overrides: Object.fromEntries(Object.entries(pkg.overrides || {}).sort(([a], [b]) => a.localeCompare(b, 'en')))
  };
}

export function validateLockForFunction(functionConfig) {
  const sourceDir = path.join(repoRoot, loadPolicy().sourceRoot, functionConfig.name);
  const sourcePackagePath = path.join(sourceDir, 'package.json');
  const lockDir = path.join(cloudRoot, 'locks', functionConfig.name);
  const lockPackagePath = path.join(lockDir, 'package.json');
  const lockPath = path.join(lockDir, 'package-lock.json');
  const issues = [];
  for (const requiredPath of [sourcePackagePath, lockPackagePath, lockPath]) {
    if (!fs.existsSync(requiredPath)) issues.push(`缺少 ${path.relative(repoRoot, requiredPath)}`);
  }
  if (issues.length) return issues;

  const sourcePackage = cloudPackageForFunction(functionConfig.name, readJson(sourcePackagePath));
  const lockPackage = readJson(lockPackagePath);
  const lock = readJson(lockPath);
  if (JSON.stringify(packageJsonComparable(sourcePackage)) !== JSON.stringify(packageJsonComparable(lockPackage))) {
    issues.push(`${functionConfig.name} 的冻结 package.json 与源依赖 + 云适配依赖不一致`);
  }
  if (Number(lock.lockfileVersion) < 3) {
    issues.push(`${functionConfig.name} 的 package-lock.json 必须使用 lockfileVersion 3`);
  }
  const lockRoot = lock.packages?.[''];
  if (!lockRoot) {
    issues.push(`${functionConfig.name} 的 package-lock.json 缺少根 packages[\"\"]`);
  } else if (
    JSON.stringify(packageJsonComparable({ dependencies: lockRoot.dependencies }).dependencies) !==
    JSON.stringify(packageJsonComparable({ dependencies: sourcePackage.dependencies }).dependencies)
  ) {
    issues.push(`${functionConfig.name} 的 lockfile 根依赖与源 package.json 不一致`);
  }
  return issues;
}

export function cloudPackageForFunction(functionName, sourcePackage) {
  return { ...sourcePackage, dependencies: { ...sourcePackage.dependencies,
    'tencentcloud-sdk-nodejs-ssm': '4.1.298',
    ...(['api-scf', 'agent-scf', 'history-cleanup-scf'].includes(functionName)
      ? { 'cos-nodejs-sdk-v5': '3.0.0' } : {}) },
    // Tencent common uses named v4(); 11.1.1 retains CommonJS exports and fixes GHSA-w5hq-g745-h8pq.
    overrides: { ...sourcePackage.overrides, 'tencentcloud-sdk-nodejs-common': { uuid: '11.1.1' } } };
}

export function cloudOverlaysForFunction(functionName) {
  return ['cloud-entry.js', 'cloud-secrets.js',
    ...(['api-scf', 'agent-scf', 'history-cleanup-scf'].includes(functionName) ? ['cloud-media.js'] : [])];
}

export function collectFirstPartyFiles(policy, functionConfig) {
  const sourceDir = path.join(repoRoot, policy.sourceRoot, functionConfig.name);
  const files = [];
  for (const entry of functionConfig.sourceEntries) {
    const normalized = normalizeRelative(entry);
    if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) {
      throw new Error(`${functionConfig.name} 含不安全 sourceEntries：${entry}`);
    }
    const absolute = path.join(sourceDir, ...normalized.split('/'));
    assertInside(sourceDir, absolute, 'source entry');
    if (!fs.existsSync(absolute)) throw new Error(`${functionConfig.name} 缺少源码条目：${entry}`);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) files.push(...walkFiles(absolute));
    else if (stat.isFile()) files.push(absolute);
    else throw new Error(`${functionConfig.name} 源码条目不是普通文件/目录：${entry}`);
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, 'en'));
}

export function findForbiddenArtifactPaths(policy, rootDir) {
  return walkFiles(rootDir).filter((absolute) => {
    const relative = normalizeRelative(path.relative(rootDir, absolute)).toLowerCase();
    const segments = relative.split('/');
    return policy.forbiddenFirstPartyArtifactSegments.some((candidate) => {
      const token = normalizeRelative(candidate).toLowerCase();
      if (token.includes('/')) return relative.includes(token);
      if (token === '.env') return segments.some((segment) => segment === '.env' || segment.startsWith('.env.'));
      return segments.includes(token);
    });
  });
}

const SECRET_ASSIGNMENT = /^\s*([A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_KEY)|[A-Z][A-Z0-9_]*_TOKEN)\s*=\s*(.+?)\s*$/;
const SAFE_EXAMPLE = /^(?:|false|true|0|1|__.*__|<.*>|replace[-_ ]?with.*|your[-_ ].*|example.*)$/i;

export function scanTextForLikelySecrets(text, sourceLabel = '') {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const assignment = line.match(SECRET_ASSIGNMENT);
    if (assignment) {
      const value = assignment[2].trim().replace(/^['\"]|['\"]$/g, '');
      if (value && !SAFE_EXAMPLE.test(value)) {
        findings.push(`${sourceLabel}:${index + 1} ${assignment[1]} 含具体值`);
      }
    }
    if (/AKID[A-Za-z0-9]{12,}/.test(line)) findings.push(`${sourceLabel}:${index + 1} 疑似腾讯云 SecretId`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) {
      findings.push(`${sourceLabel}:${index + 1} 含私钥头`);
    }
    if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(line)) findings.push(`${sourceLabel}:${index + 1} 疑似 API Key`);
  });
  return findings;
}

export function scanFilesForLikelySecrets(files, baseDir) {
  const findings = [];
  const textExtensions = new Set(['.js', '.cjs', '.mjs', '.json', '.yaml', '.yml', '.md', '.txt', '.env']);
  for (const filePath of files) {
    if (!textExtensions.has(path.extname(filePath).toLowerCase()) && !path.basename(filePath).startsWith('.env')) continue;
    const relative = normalizeRelative(path.relative(baseDir, filePath));
    findings.push(...scanTextForLikelySecrets(fs.readFileSync(filePath, 'utf8'), relative));
  }
  return findings;
}

export function trackedCredentialExampleFindings(policy) {
  const findings = [];
  for (const functionConfig of policy.functions) {
    const envPath = path.join(repoRoot, policy.sourceRoot, functionConfig.name, '.env.example');
    if (!fs.existsSync(envPath)) continue;
    findings.push(...scanTextForLikelySecrets(
      fs.readFileSync(envPath, 'utf8'),
      normalizeRelative(path.relative(repoRoot, envPath))
    ));
  }
  return findings;
}

export function validateCandidateConfig(config) {
  const errors = [];
  const warnings = [];
  const policy = loadPolicy();
  if (config?.schemaVersion !== 'nova.cloud-candidate/v1') errors.push('配置 schemaVersion 不匹配');
  if (config?.environment !== 'staging') errors.push('本初版只允许 environment=staging');
  for (const [label, value] of [
    ['region', config?.region],
    ['namespace', config?.namespace],
    ['ingress.httpsCustomDomain', config?.ingress?.httpsCustomDomain],
    ['network.vpcId', config?.network?.vpcId],
    ['network.subnetId', config?.network?.subnetId],
    ['network.publicProviderEgress.mode', config?.network?.publicProviderEgress?.mode],
    ['database.host', config?.database?.host],
    ['database.name', config?.database?.name],
    ['database.userSecretRef', config?.database?.userSecretRef],
    ['database.passwordSecretRef', config?.database?.passwordSecretRef],
    ['secrets.jwtSecretRef', config?.secrets?.jwtSecretRef],
    ['secrets.wechatSecretRef', config?.secrets?.wechatSecretRef],
    ['secrets.llmApiKeySecretRef', config?.secrets?.llmApiKeySecretRef]
  ]) {
    if (hasPlaceholder(value)) errors.push(`${label} 尚未填写`);
  }
  for (const [label, value] of [
    ['database.userSecretRef', config?.database?.userSecretRef],
    ['database.passwordSecretRef', config?.database?.passwordSecretRef],
    ['secrets.jwtSecretRef', config?.secrets?.jwtSecretRef],
    ['secrets.wechatSecretRef', config?.secrets?.wechatSecretRef],
    ['secrets.llmApiKeySecretRef', config?.secrets?.llmApiKeySecretRef]
  ]) {
    if (!hasPlaceholder(value) && !/^secret:\/\/[a-z0-9._/-]+(?:#[a-z0-9._-]+)?$/i.test(String(value))) {
      errors.push(`${label} 必须使用 secret:// 引用，不能填写真实秘密`);
    }
  }
  if (/^(?:localhost\.?|0\.0\.0\.0|127\..*|\[?::1\]?|\[?::ffff:127\..*)$/i.test(String(config?.database?.host || '').trim())) {
    errors.push('database.host 不得使用本机回环地址');
  }
  if (config?.functionRuntime?.functionType !== 'Event') {
    errors.push('SCF functionRuntime.functionType 必须显式为 Event');
  }
  if (config?.functionRuntime?.handler !== 'cloud-entry.main_handler') {
    errors.push('SCF handler 必须为 cloud-entry.main_handler');
  }
  if (config?.ingress?.mode !== 'scf-function-url-custom-domain') {
    errors.push('入口必须使用 SCF Function URL + SCF custom domain path mapping');
  }
  if (!/^https:\/\//i.test(String(config?.ingress?.httpsCustomDomain || ''))) {
    errors.push('ingress.httpsCustomDomain 必须是 HTTPS');
  }
  if (config?.ingress?.routeTemplate !== 'function-url-routes.template.yaml') {
    errors.push('ingress.routeTemplate 必须指向当前 Function URL 路由契约');
  }
  if (config?.ingress?.preserveOriginalPath !== true) errors.push('Function URL 自定义域名必须保留原始 path');
  const egressMode = String(config?.network?.publicProviderEgress?.mode || '');
  if (!hasPlaceholder(egressMode) && !['vpc-nat', 'scf-public-network'].includes(egressMode)) {
    errors.push('publicProviderEgress.mode 只支持 vpc-nat 或 scf-public-network');
  }
  if (egressMode === 'vpc-nat' && hasPlaceholder(config?.network?.publicProviderEgress?.natGatewayId)) {
    errors.push('VPC+公网 Provider 路线必须填写 NAT Gateway 标识');
  }
  const resolutionStrategy = String(config?.secretResolution?.strategy || '');
  if (resolutionStrategy !== 'runtime-ssm-sdk') errors.push('secretResolution.strategy 必须为 runtime-ssm-sdk');
  if (config?.secretResolution?.leastPrivilegeAccessVerified !== true) errors.push('尚未在云端验证 SSM 最小权限角色');
  if (config?.database?.tlsMode !== 'required') errors.push('database.tlsMode 必须为 required');
  if (config?.media?.mode !== 'cos-proxy') errors.push('云候选必须使用 media.mode=cos-proxy');
  if (!/^[a-z0-9-]+-\d+$/.test(config?.media?.cosBucket || '')) errors.push('media.cosBucket 尚未填写有效的隔离存储桶');
  if (!/^[a-z]+-[a-z0-9-]+$/.test(config?.media?.cosRegion || '')) errors.push('media.cosRegion 尚未填写');
  if (!/^nova-staging\/[a-z0-9_-]+\/$/.test(config?.media?.cosPrefix || '')) errors.push('media.cosPrefix 必须是 nova-staging/<env>/');
  const apiEnv = config?.plainEnvironment?.['api-scf'] || {};
  if (isTrue(apiEnv.QWEATHER_ENABLED)) {
    for (const key of ['QWEATHER_API_HOST', 'QWEATHER_PROJECT_ID', 'QWEATHER_CREDENTIAL_ID']) {
      if (hasPlaceholder(apiEnv[key])) errors.push(`启用天气时 ${key} 尚未填写`);
    }
    if (!/^secret:\/\/[a-z0-9._/-]+(?:#[a-z0-9._-]+)?$/i.test(config?.secrets?.qweatherPrivateKeySecretRef || '')) {
      errors.push('启用天气时必须填写 QWEATHER_PRIVATE_KEY 的 secret:// 引用');
    }
  }
  if (String(apiEnv.ALLOW_LEGACY_OPENID_FALLBACK) !== 'false') errors.push('API 必须显式设置 legacy openid fallback=false');
  if (String(apiEnv.LOCAL_MEDIA_ENABLED) !== 'false') errors.push('API 必须显式设置 LOCAL_MEDIA_ENABLED=false');
  if (isTrue(apiEnv.ALLOW_LEGACY_OPENID_FALLBACK)) errors.push('API 禁止 legacy openid fallback');
  if (isTrue(apiEnv.LOCAL_MEDIA_ENABLED)) errors.push('云端禁止 LOCAL_MEDIA_ENABLED');
  const agentEnv = config?.plainEnvironment?.['agent-scf'] || {};
  if (hasPlaceholder(config?.plainEnvironment?.['auth-scf']?.WECHAT_APPID)) errors.push('auth-scf.WECHAT_APPID 尚未填写');
  const frontendAppid = config?.frontend?.appid;
  const authAppid = config?.plainEnvironment?.['auth-scf']?.WECHAT_APPID;
  if (frontendAppid && !hasPlaceholder(frontendAppid) && !hasPlaceholder(authAppid) && frontendAppid !== authAppid) {
    errors.push('frontend.appid 必须与 auth-scf.WECHAT_APPID 一致');
  }
  if (String(agentEnv.ALLOW_LEGACY_OPENID_FALLBACK) !== 'false') errors.push('Agent 必须显式设置 legacy openid fallback=false');
  if (isTrue(agentEnv.ALLOW_LEGACY_OPENID_FALLBACK)) errors.push('Agent 禁止 legacy openid fallback');
  if (String(agentEnv.DEBUG_OPENID || '').trim()) errors.push('Agent 禁止 DEBUG_OPENID');
  if (isTrue(agentEnv.AGENT_SHADOW_ENABLED)) errors.push('云候选禁止 shadow 旁路调用');
  if (isTrue(agentEnv.LLM_API_ENABLED) && !/^https:\/\//i.test(String(agentEnv.LLM_API_BASE_URL || ''))) {
    errors.push('启用 LLM 时 LLM_API_BASE_URL 必须是 HTTPS');
  }
  if (isTrue(agentEnv.LLM_API_ENABLED)) {
    if (hasPlaceholder(agentEnv.LLM_MODEL)) errors.push('启用 LLM 时 LLM_MODEL 尚未填写');
    if (hasPlaceholder(agentEnv.VISION_MODEL)) errors.push('启用 LLM 时 VISION_MODEL 尚未填写');
  }
  if (isTrue(config?.plainEnvironment?.['ingest-scf']?.NOVA_INGEST_ENABLED)) {
    const oneNetRef = config?.secrets?.oneNetTokenSecretRef;
    const emqxRef = config?.secrets?.emqxWebhookTokenSecretRef;
    if (hasPlaceholder(oneNetRef) && hasPlaceholder(emqxRef)) {
      errors.push('启用 ingest 时至少需要一个 provider token 的 secret:// 引用');
    }
  }
  const environmentBytes = measureLogicalEnvironmentUtf8Bytes(config);
  const environmentLimit = Number(policy.interfaceLimits?.environmentUtf8MaxBytesInclusive);
  for (const [functionName, bytes] of Object.entries(environmentBytes)) {
    if (bytes > environmentLimit) errors.push(`${functionName} 逻辑环境变量 UTF-8 字节数 ${bytes} 超过 ${environmentLimit}`);
  }
  if (Number(config?.artifactAndInterfaceBudgets?.environmentUtf8BytesMaxInclusive) !== environmentLimit) {
    errors.push(`环境变量门禁必须固定为每函数 UTF-8 总字节 <=${environmentLimit}`);
  }
  if (config?.artifactAndInterfaceBudgets?.finalRenderedEnvironmentVerified !== true) {
    errors.push('尚未验证每函数最终渲染环境变量的 UTF-8 总字节数；逻辑模板计数不能替代最终值证据');
  }
  const finalEnvironmentBytes = {};
  const finalEnvironment = config?.finalEnvironmentByFunction;
  if (!finalEnvironment || typeof finalEnvironment !== 'object' || Array.isArray(finalEnvironment)) {
    errors.push('缺少已渲染的 finalEnvironmentByFunction（仅 SSM 引用，不含秘密），无法校验最终环境变量字节数');
  } else {
    for (const functionConfig of policy.functions) {
      const environment = finalEnvironment[functionConfig.name];
      if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
        errors.push(`${functionConfig.name} 缺少最终环境变量对象`);
        continue;
      }
      const bytes = measureEnvironmentUtf8Bytes(environment);
      finalEnvironmentBytes[functionConfig.name] = bytes;
      if (bytes > environmentLimit) errors.push(`${functionConfig.name} 最终环境变量 UTF-8 字节数 ${bytes} 超过 ${environmentLimit}`);
    }
  }
  if (Number(config?.artifactAndInterfaceBudgets?.zipBytesMaxExclusive) !== Number(policy.artifactLimits?.zipMaxBytesExclusive)) {
    errors.push('ZIP 大小门禁与 source-policy 不一致');
  }
  if (Number(config?.artifactAndInterfaceBudgets?.codeAndLayersBytesMaxInclusive) !== Number(policy.artifactLimits?.codeAndLayersMaxBytesInclusive)) {
    errors.push('代码+Layer 解压大小门禁与 source-policy 不一致');
  }
  const layerInventory = config?.artifactAndInterfaceBudgets?.layerInventory;
  if (layerInventory?.mode !== 'none' || Number(layerInventory?.layerBytes) !== 0) {
    errors.push('本候选必须显式声明无 Layer 且 layerBytes=0；新增 Layer 必须先扩展可审计清单');
  }
  if (layerInventory?.verifiedAgainstTargetFunctionVersions !== true) {
    errors.push('尚未确认目标函数版本未绑定额外 Layer');
  }
  if (Number(config?.artifactAndInterfaceBudgets?.synchronousPayloadBytesMaxInclusive) !== Number(policy.interfaceLimits?.syncInvocationPayloadMaxBytesInclusive) ||
      Number(config?.artifactAndInterfaceBudgets?.asynchronousPayloadBytesMaxInclusive) !== Number(policy.interfaceLimits?.asyncInvocationPayloadMaxBytesInclusive)) {
    errors.push('同步/异步载荷门禁与 source-policy 不一致');
  }
  if (config?.artifactAndInterfaceBudgets?.payloadLimitsVerifiedInStaging !== true) {
    errors.push('尚未在 staging 验证 Function URL 同步 6 MiB 与异步 128 KiB 边界');
  }
  if (config?.acknowledgements?.stagingOnly !== true) errors.push('必须确认 stagingOnly=true');
  if (config?.acknowledgements?.deploymentCredentialSourcesVerified !== true) {
    errors.push('尚未核对本次部署凭据的受控来源及对应 SSM 引用');
  }
  if (config?.acknowledgements?.databaseMigrationVerified !== true) {
    errors.push('尚未确认数据库迁移已在空库与存量库克隆验证');
  }
  if (config?.acknowledgements?.functionUrlEventCompatibilityVerified !== true) {
    errors.push('尚未在目标 SCF Event Function 验证 Function URL event 结构与 cloud-entry.main_handler 兼容');
  }
  if (config?.acknowledgements?.customDomainPathMappingVerified !== true) {
    errors.push('尚未在 staging 验证 SCF 自定义域名 path mapping 与路径保留语义');
  }
  if (config?.acknowledgements?.vpcPrivateDatabaseAndPublicProviderEgressVerified !== true) {
    errors.push('尚未验证所选 VPC 私网数据库与公网 Provider 出站路线');
  }
  if (config?.acknowledgements?.timerTimezoneSemanticsVerified !== true) {
    errors.push('尚未在 staging 实测定时触发器时区语义与 Asia/Shanghai 业务日期');
  }
  if (config?.acknowledgements?.cloudMediaLifecycleVerified !== true) {
    errors.push('云媒体生命周期未验证：本地适配测试不能替代真实 COS 权限与清理验收');
  }
  return {
    errors,
    warnings,
    logicalEnvironmentUtf8Bytes: environmentBytes,
    logicalEnvironmentMeasurementIsFinalEvidence: false,
    finalEnvironmentUtf8Bytes: finalEnvironmentBytes
  };
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
