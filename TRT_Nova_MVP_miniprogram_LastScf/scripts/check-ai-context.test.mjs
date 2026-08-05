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

test('reports no errors on the current repository layout', async () => {
  const result = await checkAiContext({ projectRoot: process.cwd() });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});
