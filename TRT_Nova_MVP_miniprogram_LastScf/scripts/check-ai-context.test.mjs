import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkAiContext } from './check-ai-context.mjs';

test('reports missing required project files', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'trt-nova-ai-context-'));
  mkdirSync(join(projectRoot, 'docs'), { recursive: true });
  writeFileSync(join(projectRoot, 'AGENTS.md'), '# AGENTS\n');
  writeFileSync(join(projectRoot, 'docs', 'ai-workflow.md'), '# workflow\n');
  writeFileSync(join(projectRoot, 'docs', 'current-architecture.md'), '# arch\n');

  const result = await checkAiContext({ projectRoot });

  assert.ok(result.errors.includes('missing: docs/ai-project-map.md'));
});

test('recognizes admin console directories as part of the project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trt-nova-admin-'));
  mkdirSync(join(root, 'admin-web'), { recursive: true });
  mkdirSync(join(root, 'dist', 'scf', 'admin-scf'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n');
  writeFileSync(join(root, 'app.json'), '{}');
  writeFileSync(join(root, 'admin-web', 'index.html'), '<!doctype html>');
  writeFileSync(join(root, 'dist', 'scf', 'admin-scf', 'index.js'), 'module.exports = {};\n');

  const result = await checkAiContext({ projectRoot: root });
  assert.ok(result.errors.includes('missing: docs/ai-project-map.md'));
  assert.ok(result.errors.includes('missing: dist/scf/api-scf/index.js'));
});

test('requires admin entry points in addition to the core project context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trt-nova-admin-required-'));

  for (const file of [
    'AGENTS.md',
    'docs/ai-project-map.md',
    'docs/ai-workflow.md',
    'docs/current-architecture.md',
    'data/knowledge/articles.json',
    'dist/scf/api-scf/index.js',
    'dist/scf/auth-scf/index.js',
    'dist/scf/ingest-scf/index.js',
    'dist/scf/agent-scf/index.js',
    'dist/scf/history-cleanup-scf/index.js',
    'dist/scf/api-scf/data/knowledge/articles.json',
    'dist/scf/agent-scf/data/knowledge/articles.json',
    'dist/scf/api-scf/knowledge.js',
    'services/core/ScfApiAdapter.js',
    'services/modules/DeviceService.js',
    'services/modules/KnowledgeService.js',
    '.claude/skills/evolving-trt-nova/SKILL.md',
    '.claude/skills/evolving-trt-nova/agents/openai.yaml',
    'scripts/link-ai-skills.mjs'
  ]) {
    const target = join(root, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, file.endsWith('openai.yaml') ? 'default_prompt: "$evolving-trt-nova"\n' : 'placeholder\n');
  }
  mkdirSync(join(root, 'admin-web'), { recursive: true });
  mkdirSync(join(root, 'dist', 'scf', 'admin-scf'), { recursive: true });

  const result = await checkAiContext({ projectRoot: root });
  assert.ok(result.errors.includes('missing: admin-web/index.html'));
  assert.ok(result.errors.includes('missing: dist/scf/admin-scf/index.js'));
});

test('reports no errors on the current repository layout', async () => {
  const result = await checkAiContext({ projectRoot: process.cwd() });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});
