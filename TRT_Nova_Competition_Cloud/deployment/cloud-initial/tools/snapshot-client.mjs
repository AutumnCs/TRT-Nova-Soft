#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudRoot, repoRoot, assertInside, readJson, writeJson, walkFiles, sha256File, scanFilesForLikelySecrets } from './common.mjs';
import { renderConfiguration } from './render-config.mjs';

const ENTRIES = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'pages', 'components', 'custom-tab-bar', 'services', 'images', 'data'];
const CLIENT_EXTENSIONS = new Set(['.js', '.json', '.wxml', '.wxss', '.wxs', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ttf', '.woff', '.woff2']);
export function snapshotClient(config, target = path.join(cloudRoot, 'build', 'miniprogram'), options = {}) {
  const allowedRoot = path.resolve(target).startsWith(path.resolve(cloudRoot, 'state') + path.sep)
    ? path.join(cloudRoot, 'state') : path.join(cloudRoot, 'build');
  assertInside(allowedRoot, target, 'frontend candidate');
  if (path.resolve(target) === path.resolve(allowedRoot)) throw new Error('Refusing to overwrite output root');
  if (fs.existsSync(target)) throw new Error('Candidate frontend target already exists; choose a fresh output directory');
  const rendered = renderConfiguration(config, options);
  const copies = [];
  for (const entry of ENTRIES) {
    const source = path.join(repoRoot, entry);
    for (const file of fs.statSync(source).isDirectory() ? walkFiles(source) : [source]) {
      const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
      if (relative === 'services/config/local-runtime.js') continue;
      if (!CLIENT_EXTENSIONS.has(path.extname(file)) || /(?:^|\/)(?:test|tests|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\./i.test(relative)) continue;
      copies.push({ file, relative });
    }
  }
  const secrets = scanFilesForLikelySecrets(copies.map(value => value.file), repoRoot);
  if (secrets.length) throw new Error('Frontend source contains suspected credentials');
  for (const { file, relative } of copies) {
    const output = path.join(target, relative); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(file, output);
  }
  const runtime = rendered.frontend;
  // Generated candidate only: all DevTools/trial/release traffic uses the configured staging origin.
  fs.writeFileSync(path.join(target, 'services/config/runtime-profile.js'),
    `const { DEFAULT_RUNTIME_CONFIG } = require('./runtime');\nconst candidate = Object.freeze(${JSON.stringify(runtime, null, 2)});\nfunction resolveAppRuntimeConfig() { return { ...DEFAULT_RUNTIME_CONFIG, ...candidate }; }\nmodule.exports = { resolveAppRuntimeConfig, createRuntimeConfig: resolveAppRuntimeConfig };\n`);
  fs.writeFileSync(path.join(target, 'envList.js'), 'module.exports = { envList: [] };\n');
  const app = readJson(path.join(target, 'app.json'));
  app.networkTimeout = { request: runtime.scfRequestTimeoutMs, uploadFile: 60000, downloadFile: 60000 };
  writeJson(path.join(target, 'app.json'), app);
  const project = readJson(path.join(repoRoot, 'project.config.json'));
  Object.assign(project, { appid: runtime.appid, projectname: 'TRT Nova 竞赛云端版' });
  Object.assign(project.setting, { urlCheck: true, uploadWithSourceMap: false });
  writeJson(path.join(target, 'project.config.json'), project);
  const manifest = { schemaVersion: 'nova.client-candidate/v1', claim: 'LATEST_CLIENT_SNAPSHOT_NOT_WECHAT_CLOUD_ACCEPTANCE',
    generatedAt: new Date().toISOString(), retainedSourceFiles: copies.map(({ file, relative }) => ({ path: relative, sha256: sha256File(file) })),
    candidateOnlyOverrides: ['services/config/runtime-profile.js', 'envList.js', 'app.json', 'project.config.json'],
    files: walkFiles(target).map(file => ({ path: path.relative(target, file).replaceAll('\\', '/'), sha256: sha256File(file) })) };
  writeJson(path.join(target, 'NOVA_CLIENT_MANIFEST.json'), manifest);
  return { target, fileCount: manifest.files.length, claim: manifest.claim };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2); const value = name => args[args.indexOf(name) + 1];
    if (!args.includes('--config')) throw new Error('Usage: node tools/snapshot-client.mjs --config <candidate.json> [--out <fresh-build-subdir>] [--allow-placeholders]');
    console.log(JSON.stringify(snapshotClient(readJson(path.resolve(value('--config'))), args.includes('--out') ? path.resolve(value('--out')) : undefined,
      { allowPlaceholders: args.includes('--allow-placeholders') }), null, 2));
  } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
