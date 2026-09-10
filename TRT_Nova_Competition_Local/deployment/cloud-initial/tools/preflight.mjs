#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  cloudRoot,
  cloudOverlaysForFunction,
  collectFirstPartyFiles,
  hasPlaceholder,
  loadPolicy,
  measureLogicalEnvironmentUtf8Bytes,
  readJson,
  repoRoot,
  scanFilesForLikelySecrets,
  trackedCredentialExampleFindings,
  validateCandidateConfig,
  validateLockForFunction
} from './common.mjs';
import { renderConfiguration } from './render-config.mjs';

function parseArgs(argv) {
  const options = { release: false, configPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--release') options.release = true;
    else if (token === '--config') options.configPath = argv[++index] || '';
    else throw new Error(`未知参数：${token}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = loadPolicy();
  const errors = [];
  const warnings = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) errors.push(`需要 Node.js >=20，当前为 ${process.version}`);
  if (policy.runtime !== 'Nodejs20.19') errors.push(`运行时策略异常：${policy.runtime}`);
  if (policy.functionType !== 'Event') errors.push(`函数类型策略异常：${policy.functionType}`);
  if (policy.handler !== 'cloud-entry.main_handler') errors.push(`Handler 策略异常：${policy.handler}`);
  if (!Array.isArray(policy.functions) || policy.functions.length !== 5) errors.push('必须精确声明 5 个候选函数');
  if ((policy.functions || []).some((item) => item.functionType !== 'Event')) errors.push('5 个候选函数都必须显式声明 functionType=Event');

  const scfManifestPath = path.join(cloudRoot, 'scf-manifest.template.yaml');
  const routeContractPath = path.join(cloudRoot, 'function-url-routes.template.yaml');
  const retiredGatewayPath = path.join(cloudRoot, 'api-gateway-routes.template.yaml');
  if (!fs.existsSync(scfManifestPath)) errors.push('缺少 scf-manifest.template.yaml');
  else {
    const manifestText = fs.readFileSync(scfManifestPath, 'utf8');
    const eventTypeDeclarations = manifestText.match(/^\s*functionType:\s*["']?Event["']?\s*$/gm) || [];
    if (eventTypeDeclarations.length !== 6) errors.push('SCF manifest 必须在 global 与 5 个函数上显式声明 functionType=Event');
    if (!/^\s*handler:\s*["']?cloud-entry\.main_handler["']?\s*$/m.test(manifestText)) errors.push('SCF manifest handler 与云入口不一致');
    if (/trigger:\s*["']?api-gateway/i.test(manifestText)) errors.push('SCF manifest 仍引用已停服的 API Gateway trigger');
  }
  if (!fs.existsSync(routeContractPath)) errors.push('缺少 Function URL + SCF custom domain 路由契约');
  if (fs.existsSync(retiredGatewayPath)) errors.push('已停服的 API Gateway 路由模板不得继续存在');
  if (!(Number(policy.artifactLimits?.zipMaxBytesExclusive) === 50 * 1024 * 1024 &&
        Number(policy.artifactLimits?.codeAndLayersMaxBytesInclusive) === 500 * 1024 * 1024 &&
        Number(policy.artifactLimits?.candidateLayerBytes) === 0)) {
    errors.push('本地候选必须固定 ZIP <50MiB、代码+Layer <=500MiB 且显式无 Layer');
  }
  if (!(Number(policy.interfaceLimits?.environmentUtf8MaxBytesInclusive) === 4096 &&
        Number(policy.interfaceLimits?.syncInvocationPayloadMaxBytesInclusive) === 6 * 1024 * 1024 &&
        Number(policy.interfaceLimits?.asyncInvocationPayloadMaxBytesInclusive) === 128 * 1024)) {
    errors.push('环境变量/同步/异步载荷门禁与 SCF 配额合同不一致');
  }

  for (const functionConfig of policy.functions || []) {
    errors.push(...validateLockForFunction(functionConfig));
    for (const overlay of cloudOverlaysForFunction(functionConfig.name)) {
      if (!fs.existsSync(path.join(cloudRoot, 'overlays', overlay))) errors.push(`缺少 ${functionConfig.name} 云适配文件 ${overlay}`);
    }
    try {
      const sourceFiles = collectFirstPartyFiles(policy, functionConfig);
      const handlerSource = fs.readFileSync(path.join(repoRoot, policy.sourceRoot, functionConfig.name, 'index.js'), 'utf8');
      if (!/exports\.main_handler\s*=/.test(handlerSource)) {
        errors.push(`${functionConfig.name} 未导出 main_handler`);
      }
      const sourceSecrets = scanFilesForLikelySecrets(sourceFiles, repoRoot);
      errors.push(...sourceSecrets.map((finding) => `${functionConfig.name} 打包源码疑似含秘密：${finding}`));
    } catch (error) {
      errors.push(error.message);
    }
  }

  const overlayPath = path.join(cloudRoot, 'overlays', 'cloud-entry.js');
  if (!fs.existsSync(overlayPath)) errors.push('缺少 fail-closed 云端入口 overlays/cloud-entry.js');
  const trackedFindings = trackedCredentialExampleFindings(policy);
  if (trackedFindings.length) {
    const prefix = options.release ? errors : warnings;
    prefix.push(`源目录 .env.example 仍有 ${trackedFindings.length} 个疑似凭据式具体值；构建会排除它们，但发布前必须轮换并清理`);
    warnings.push(...trackedFindings.map((finding) => `凭据审计：${finding}`));
  }

  if (options.release) {
    if (!options.configPath) errors.push('--release 必须同时提供 --config <repo外或ignored配置>');
    else {
      const absoluteConfig = path.resolve(process.cwd(), options.configPath);
      if (!fs.existsSync(absoluteConfig)) errors.push(`配置文件不存在：${absoluteConfig}`);
      else {
        const config = readJson(absoluteConfig);
        try {
          const rendered = renderConfiguration(config);
          // Recompute actual control-plane values (SSM references, not fetched secrets).
          config.finalEnvironmentByFunction = Object.fromEntries(Object.entries(rendered.functions).map(([name, unit]) => [name, unit.environment]));
        } catch (error) { errors.push(`配置无法渲染：${error.message}`); }
        const configResult = validateCandidateConfig(config);
        errors.push(...configResult.errors);
        warnings.push(...configResult.warnings);
        warnings.push(`逻辑环境变量 UTF-8 计数（不是最终渲染证据）：${JSON.stringify(measureLogicalEnvironmentUtf8Bytes(config))}`);
      }
    }
  } else if (options.configPath && !hasPlaceholder(options.configPath)) {
    warnings.push('未启用 --release，提供的 config 不参与发布门禁');
  }

  const result = {
    ok: errors.length === 0,
    mode: options.release ? 'release' : 'build',
    candidate: policy.candidateName,
    runtime: policy.runtime,
    handler: policy.handler,
    functionType: policy.functionType,
    artifactLimits: policy.artifactLimits,
    interfaceLimits: policy.interfaceLimits,
    node: process.version,
    functions: policy.functions.map((item) => item.name),
    errors,
    warnings
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
