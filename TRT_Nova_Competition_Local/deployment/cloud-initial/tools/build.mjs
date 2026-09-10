#!/usr/bin/env node

import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  assertInside,
  cloudRoot,
  cloudOverlaysForFunction,
  collectFirstPartyFiles,
  findDeployableArtifactPolicyViolations,
  findForbiddenArtifactPaths,
  loadPolicy,
  normalizeRelative,
  pruneInstalledDependencyArtifacts,
  readJson,
  repoRoot,
  scanFilesForLikelySecrets,
  scanFilesForLocalAbsolutePaths,
  sha256File,
  validateLockForFunction,
  walkFiles,
  writeJson
} from './common.mjs';

function parseArgs(argv) {
  const result = { finalize: false, skipInstall: false };
  for (const token of argv) {
    if (token === '--finalize') result.finalize = true;
    else if (token === '--skip-install') result.skipInstall = true;
    else throw new Error(`未知参数：${token}`);
  }
  return result;
}

function removeControlledDirectory(targetPath) {
  assertInside(cloudRoot, targetPath, 'clean target');
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyFile(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyFirstParty(policy, functionConfig, stagingDir) {
  const sourceDir = path.join(repoRoot, policy.sourceRoot, functionConfig.name);
  const sourceFiles = collectFirstPartyFiles(policy, functionConfig);
  for (const sourcePath of sourceFiles) {
    const relative = path.relative(sourceDir, sourcePath);
    copyFile(sourcePath, path.join(stagingDir, relative));
  }
  return sourceFiles;
}

function runNpmCi(stagingDir) {
  const npmArguments = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  const npmCli = npmCliCandidates.find((candidate) => fs.existsSync(candidate));
  const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm');
  const commandArguments = npmCli
    ? [npmCli, ...npmArguments]
    : (process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm.cmd ${npmArguments.join(' ')}`]
        : npmArguments);
  const result = childProcess.spawnSync(
    npmCommand,
    commandArguments,
    {
      cwd: stagingDir,
      encoding: 'utf8',
      stdio: 'pipe'
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `npm ci 失败 (${stagingDir})\n${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`.trim()
    );
  }
  return String(result.stdout || '').trim();
}

function buildPackageManifest(policy, functionConfig, stagingDir, installOutput, pruneSummary, contentPolicy) {
  const manifestPath = path.join(stagingDir, 'NOVA_PACKAGE_MANIFEST.json');
  const files = walkFiles(stagingDir)
    .filter((filePath) => filePath !== manifestPath)
    .map((filePath) => ({
      path: normalizeRelative(path.relative(stagingDir, filePath)),
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath)
    }));
  const manifest = {
    schemaVersion: 'nova.scf-package/v1',
    candidate: policy.candidateName,
    function: functionConfig.name,
    functionType: functionConfig.functionType,
    runtime: policy.runtime,
    handler: policy.handler,
    limits: {
      zipMaxBytesExclusive: policy.artifactLimits.zipMaxBytesExclusive,
      codeAndLayersMaxBytesInclusive: policy.artifactLimits.codeAndLayersMaxBytesInclusive,
      candidateLayerBytes: policy.artifactLimits.candidateLayerBytes,
      candidateLayerInventory: policy.artifactLimits.candidateLayerInventory
    },
    sourcePolicySha256: sha256File(path.join(cloudRoot, 'source-policy.json')),
    packageLockSha256: sha256File(path.join(stagingDir, 'package-lock.json')),
    dependencyInstall: installOutput ? 'npm ci --omit=dev --ignore-scripts' : 'SKIPPED_FOR_INSPECTION_ONLY',
    dependencyPrune: pruneSummary,
    contentPolicy,
    generatedAt: new Date().toISOString(),
    files
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

function stageAll(options) {
  const policy = loadPolicy();
  const buildRoot = path.join(cloudRoot, 'build');
  const artifactsRoot = path.join(cloudRoot, 'artifacts');
  removeControlledDirectory(buildRoot);
  removeControlledDirectory(artifactsRoot);
  const summary = [];

  for (const functionConfig of policy.functions) {
    const lockIssues = validateLockForFunction(functionConfig);
    if (lockIssues.length) throw new Error(lockIssues.join('\n'));
    const stagingDir = path.join(buildRoot, functionConfig.name);
    fs.mkdirSync(stagingDir, { recursive: true });
    const firstPartyFiles = copyFirstParty(policy, functionConfig, stagingDir);
    const firstPartySecrets = scanFilesForLikelySecrets(firstPartyFiles, repoRoot);
    if (firstPartySecrets.length) throw new Error(firstPartySecrets.join('\n'));
    const firstPartyLocalPaths = scanFilesForLocalAbsolutePaths(firstPartyFiles, repoRoot);
    if (firstPartyLocalPaths.length) throw new Error(firstPartyLocalPaths.join('\n'));
    copyFile(
      path.join(cloudRoot, 'locks', functionConfig.name, 'package-lock.json'),
      path.join(stagingDir, 'package-lock.json')
    );
    copyFile(path.join(cloudRoot, 'locks', functionConfig.name, 'package.json'), path.join(stagingDir, 'package.json'));
    for (const overlay of cloudOverlaysForFunction(functionConfig.name)) {
      copyFile(path.join(cloudRoot, 'overlays', overlay), path.join(stagingDir, overlay));
    }

    const forbiddenBeforeInstall = findForbiddenArtifactPaths(policy, stagingDir);
    if (forbiddenBeforeInstall.length) {
      throw new Error(`${functionConfig.name} staging 含禁止文件：\n${forbiddenBeforeInstall.join('\n')}`);
    }
    const installOutput = options.skipInstall ? '' : runNpmCi(stagingDir);
    const pruneSummary = options.skipInstall
      ? { status: 'SKIPPED_FOR_INSPECTION_ONLY', removedFiles: 0, removedBytes: 0, reasons: {}, protectedConflicts: [] }
      : { status: 'APPLIED', ...pruneInstalledDependencyArtifacts(policy, stagingDir) };
    const forbiddenAfterInstall = findDeployableArtifactPolicyViolations(policy, stagingDir);
    if (forbiddenAfterInstall.length) {
      throw new Error(`${functionConfig.name} 依赖裁剪后仍含禁止产物：\n${forbiddenAfterInstall.join('\n')}`);
    }
    const deployableFiles = walkFiles(stagingDir);
    const stagedSecrets = scanFilesForLikelySecrets(deployableFiles, stagingDir);
    if (stagedSecrets.length) {
      throw new Error(`${functionConfig.name} 完整 staging 疑似含秘密：\n${stagedSecrets.join('\n')}`);
    }
    const stagedLocalPaths = scanFilesForLocalAbsolutePaths(deployableFiles, stagingDir);
    if (stagedLocalPaths.length) {
      throw new Error(`${functionConfig.name} 完整 staging 含绝对本机路径：\n${stagedLocalPaths.join('\n')}`);
    }
    const contentPolicy = {
      scope: 'all-staging-text-plus-all-deployable-paths-before-manifest',
      deployablePathViolations: forbiddenAfterInstall.length,
      suspectedSecretFindings: stagedSecrets.length,
      localAbsolutePathFindings: stagedLocalPaths.length
    };
    const manifest = buildPackageManifest(
      policy,
      functionConfig,
      stagingDir,
      installOutput,
      pruneSummary,
      contentPolicy
    );
    const manifestViolations = findDeployableArtifactPolicyViolations(policy, stagingDir);
    if (manifestViolations.length) {
      throw new Error(`${functionConfig.name} manifest 写入后出现禁止产物：\n${manifestViolations.join('\n')}`);
    }
    summary.push({
      function: functionConfig.name,
      stagingDir: normalizeRelative(path.relative(repoRoot, stagingDir)),
      fileCount: manifest.files.length,
      bytes: manifest.files.reduce((sum, item) => sum + item.bytes, 0),
      dependencyInstall: manifest.dependencyInstall,
      dependencyPrune: pruneSummary
    });
  }

  writeJson(path.join(buildRoot, 'BUILD_SUMMARY.json'), {
    schemaVersion: 'nova.scf-build/v1',
    candidate: policy.candidateName,
    generatedAt: new Date().toISOString(),
    packages: summary
  });
  console.log(JSON.stringify({ ok: true, stage: 'built', packages: summary }, null, 2));
}

function finalizeArtifacts() {
  const policy = loadPolicy();
  const artifactsRoot = path.join(cloudRoot, 'artifacts');
  const packages = [];
  for (const functionConfig of policy.functions) {
    const zipPath = path.join(artifactsRoot, `${functionConfig.name}.zip`);
    if (!fs.existsSync(zipPath)) throw new Error(`缺少 ZIP：${zipPath}`);
    packages.push({
      function: functionConfig.name,
      file: path.basename(zipPath),
      bytes: fs.statSync(zipPath).size,
      sha256: sha256File(zipPath),
      runtime: policy.runtime,
      functionType: functionConfig.functionType,
      handler: policy.handler,
      layerBytes: policy.artifactLimits.candidateLayerBytes
    });
  }
  const releaseManifestPath = path.join(artifactsRoot, 'RELEASE_MANIFEST.json');
  writeJson(releaseManifestPath, {
    schemaVersion: 'nova.scf-release/v1',
    candidate: policy.candidateName,
    deploymentClaim: 'STAGING_ARTIFACTS_BUILT_NOT_DEPLOYED',
    fullCloudFeatureClaim: 'CLOUD_ADAPTERS_IMPLEMENTED_REAL_CLOUD_ACCEPTANCE_PENDING',
    generatedAt: new Date().toISOString(),
    sourcePolicySha256: sha256File(path.join(cloudRoot, 'source-policy.json')),
    packages
  });
  console.log(JSON.stringify({ ok: true, stage: 'finalized', releaseManifestPath, packages }, null, 2));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.finalize) finalizeArtifacts();
  else stageAll(options);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
