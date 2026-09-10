import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalDir = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await readFile(resolve(evalDir, 'product-contract.json'), 'utf8'));

function mergedTarget(testCase) {
  return {
    ...contract.defaults,
    ...testCase.target,
    requiredTools: testCase.target.requiredTools || contract.defaults.requiredTools || [],
    forbiddenTools: [...new Set([
      ...(contract.defaults.forbiddenTools || []),
      ...(testCase.target.forbiddenTools || [])
    ])]
  };
}

test('M7 product contract has stable unique case ids', () => {
  assert.ok(contract.cases.length >= 40, 'expected a broad product corpus');
  const ids = contract.cases.map((testCase) => testCase.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids must be unique');
});

test('every case declares a model-owned response mode and effective history', () => {
  const allowedModes = new Set(['direct', 'tool_assisted', 'clarify', 'boundary']);
  for (const testCase of contract.cases) {
    const target = mergedTarget(testCase);
    assert.equal(target.modelRequired, true, `${testCase.id} must reach the model`);
    assert.equal(target.historyPolicy, 'effective_branch', `${testCase.id} must preserve effective history`);
    assert.ok(allowedModes.has(target.responseMode), `${testCase.id} has an invalid response mode`);
  }
});

test('required tools never conflict with forbidden tools', () => {
  for (const testCase of contract.cases) {
    const target = mergedTarget(testCase);
    const overlap = target.requiredTools.filter((toolName) => target.forbiddenTools.includes(toolName));
    assert.deepEqual(overlap, [], `${testCase.id} requires and forbids the same tool`);
  }
});

test('formal task creation is never granted to the model', () => {
  for (const testCase of contract.cases) {
    const target = mergedTarget(testCase);
    assert.ok(target.forbiddenTools.includes('direct_business_write'));
    if (target.requiredTools.includes('propose_care_task')) {
      assert.equal(target.sideEffectPolicy, 'proposal_only', `${testCase.id} must remain proposal-only`);
    }
  }
});

test('plant knowledge questions require published knowledge retrieval', () => {
  const careKnowledgeCases = contract.cases.filter((testCase) =>
    ['plant-knowledge', 'high-risk'].includes(testCase.category) &&
    testCase.target.responseMode === 'tool_assisted'
  );
  assert.ok(careKnowledgeCases.length > 0);
  for (const testCase of careKnowledgeCases) {
    assert.ok(
      mergedTarget(testCase).requiredTools.includes('search_published_knowledge'),
      `${testCase.id} must retrieve published knowledge`
    );
  }
});
