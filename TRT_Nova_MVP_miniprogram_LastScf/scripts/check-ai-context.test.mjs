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
  assert.deepEqual(result.errors, []);
});

test('reports no errors on the current repository layout', async () => {
  const result = await checkAiContext({ projectRoot: process.cwd() });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});
