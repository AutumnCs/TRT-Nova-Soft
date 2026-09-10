import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { classifyAssistantScope } = require('../../dist/scf/agent-scf/agent/intentRouter.js');

const evalDir = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(evalDir, 'product-contract.json');
const baselinePath = resolve(evalDir, 'legacy-router-baseline.json');
const shouldWrite = process.argv.includes('--write-baseline');

const contract = JSON.parse(await readFile(contractPath, 'utf8'));

function historyFor(profile) {
  if (profile === 'in_scope') {
    return [{ role: 'assistant', response: { scope: { status: 'in_scope', reason: 'plant_domain' } } }];
  }
  if (profile === 'identity') {
    return [{ role: 'assistant', response: { scope: { status: 'in_scope', reason: 'personal_identity' } } }];
  }
  if (profile === 'deferred') {
    return [{ role: 'assistant', response: { scope: { status: 'deferred', reason: 'semantic_fallback' } } }];
  }
  return [];
}

function legacyCallMode(scope) {
  if (['social', 'capability', 'personal_identity', 'nickname_preference'].includes(scope.reason)) {
    return 'fixed_response';
  }
  if (scope.status === 'out_of_scope') return 'fixed_response';
  if (scope.status === 'deferred') return 'restricted_llm_without_history_or_private_context';
  return 'full_llm_path';
}

function mergeTarget(defaults, target) {
  return {
    ...defaults,
    ...target,
    requiredTools: target.requiredTools || defaults.requiredTools || [],
    requiredCapabilities: target.requiredCapabilities || [],
    forbiddenTools: [...new Set([...(defaults.forbiddenTools || []), ...(target.forbiddenTools || [])])]
  };
}

const rows = contract.cases.map((testCase) => {
  const context = {
    ...testCase.context,
    history: historyFor(testCase.context?.historyProfile)
  };
  delete context.historyProfile;
  const scope = classifyAssistantScope(testCase.query, context);
  const target = mergeTarget(contract.defaults, testCase.target);
  const callMode = legacyCallMode(scope);
  return {
    id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    context: testCase.context,
    legacy: {
      status: scope.status,
      reason: scope.reason,
      callMode
    },
    target,
    gaps: {
      modelBypassed: target.modelRequired && callMode === 'fixed_response',
      historySuppressed: target.historyPolicy === 'effective_branch' && callMode !== 'full_llm_path',
      targetToolLoopUnavailable: target.requiredTools.length > 0 && callMode !== 'full_llm_path'
    }
  };
});

const baseline = {
  schemaVersion: 1,
  capturedOn: '2026-09-03',
  source: 'dist/scf/agent-scf/agent/intentRouter.js in the current M6 worktree',
  note: 'This freezes observed legacy behavior; it is not the M7 product expectation.',
  rows
};

if (shouldWrite) {
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
} else {
  const frozen = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert.deepEqual(baseline, frozen, 'legacy router behavior drifted from the frozen M7 baseline');
}

const counts = rows.reduce((summary, row) => {
  summary.total += 1;
  summary.callModes[row.legacy.callMode] = (summary.callModes[row.legacy.callMode] || 0) + 1;
  for (const [gap, present] of Object.entries(row.gaps)) {
    if (present) summary.gaps[gap] += 1;
  }
  return summary;
}, {
  total: 0,
  callModes: {},
  gaps: { modelBypassed: 0, historySuppressed: 0, targetToolLoopUnavailable: 0 }
});

console.log(JSON.stringify({
  mode: shouldWrite ? 'baseline_written' : 'baseline_verified',
  baselinePath,
  ...counts
}, null, 2));
