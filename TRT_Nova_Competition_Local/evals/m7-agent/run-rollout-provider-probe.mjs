import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('M7_ROLLOUT_ENV_MISSING');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const keyFile = String(process.env.LLM_API_KEY_FILE || '').trim();
  if (!process.env.LLM_API_KEY && keyFile) {
    const resolved = path.isAbsolute(keyFile) ? keyFile : path.resolve(projectRoot, keyFile);
    if (fs.existsSync(resolved)) process.env.LLM_API_KEY = fs.readFileSync(resolved, 'utf8').trim();
  }
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function normalizeAnswer(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function evaluateAnswerContract(testCase, result, assessment) {
  if (!assessment.accepted) {
    return { evaluated: false, passed: true, checks: [] };
  }
  const content = normalizeAnswer(result.finalContent);
  const checks = [];
  const requirePattern = (id, pattern) => checks.push({ id, passed: pattern.test(content) });

  if (testCase.id === 'common-arithmetic') {
    requirePattern('answers_two', /(?:^|\D)(?:2|二)(?:\D|$)/);
  }
  if (['common-arithmetic-month-rose', 'common-arithmetic-rose-count'].includes(testCase.id)) {
    requirePattern('answers_three', /(?:^|\D)(?:3|三)(?:\D|$)/);
  }
  if (testCase.id === 'common-translation') {
    requirePattern('translates_watering', /\bwater(?:ing)?\b/i);
  }
  if (testCase.category === 'boundary') {
    requirePattern('states_product_boundary', /不能|无法|不擅长|不属于|超出|主要.{0,8}植物|专注.{0,8}植物|更适合.{0,8}植物/);
  }
  if (testCase.id === 'knowledge-rose-definition') {
    requirePattern('keeps_rose_subject', /月季|蔷薇/);
  }
  if (testCase.id === 'knowledge-rose-watering') {
    requirePattern('answers_watering_subject', /月季|浇水|盆土/);
  }
  if (testCase.id === 'knowledge-monstera-light') {
    requirePattern('answers_light_subject', /龟背竹|光照|散射光/);
  }

  return {
    evaluated: checks.length > 0,
    passed: checks.every((item) => item.passed),
    checks
  };
}

if (process.env.M7_ROLLOUT_PROVIDER_PROBE !== '1') {
  throw new Error('M7_ROLLOUT_PROVIDER_PROBE must be 1 to authorize the real provider probe');
}

loadLocalEnv();

const contract = require('./product-contract.json');
const baseline = require('./legacy-router-baseline.json');
const { createReadOnlyToolExecutor, TOOL_META } = require('../../dist/scf/agent-scf/runtime/toolRegistry');
const { createOpenAiCompatibleAgentModel } = require('../../dist/scf/agent-scf/runtime/modelAdapter');
const { PlantPetRuntime } = require('../../dist/scf/agent-scf/runtime/plantPetRuntime');
const {
  planControlledRollout,
  assessRolloutResult
} = require('../../dist/scf/agent-scf/runtime/rolloutRuntime');

const model = createOpenAiCompatibleAgentModel({
  timeoutMs: Math.max(3000, Number(process.env.AGENT_ROLLOUT_TIMEOUT_MS) || 30000),
  maxTokens: Math.max(128, Number(process.env.AGENT_ROLLOUT_MAX_TOKENS) || 500)
});
if (!model.isEnabled()) throw new Error('M7_ROLLOUT_PROVIDER_DISABLED');

const noDatabaseSideEffects = {
  async execute(sql) {
    if (!/^\s*SELECT\b/i.test(String(sql || ''))) throw new Error('M7_ROLLOUT_WRITE_ATTEMPT');
    throw new Error('M7_ROLLOUT_SEED_FALLBACK');
  },
  async query(sql) {
    if (!/^\s*SELECT\b/i.test(String(sql || ''))) throw new Error('M7_ROLLOUT_WRITE_ATTEMPT');
    throw new Error('M7_ROLLOUT_SEED_FALLBACK');
  }
};

function fixtureHistory(profile = '') {
  if (profile === 'in_scope') {
    return [
      { role: 'user', content: '我在阳台养了一盆月季。' },
      { role: 'assistant', content: '好呀，我们可以结合盆土和光照一起观察。' }
    ];
  }
  if (profile === 'identity') {
    return [
      { role: 'user', content: '你可以叫我 dola。' },
      { role: 'assistant', content: '这轮对话里我会这样称呼你。' }
    ];
  }
  return [];
}

const report = {
  schemaVersion: 1,
  mode: 'real_provider_controlled_rollout_probe',
  generatedAt: new Date().toISOString(),
  model: process.env.LLM_MODEL || '',
  scenarios: []
};
const implementedTools = new Set(Object.keys(TOOL_META));

for (const testCase of contract.cases) {
  const legacy = baseline.rows.find((item) => item.id === testCase.id);
  if (!legacy) throw new Error(`M7_ROLLOUT_BASELINE_MISSING:${testCase.id}`);
  const body = {
    message: testCase.query,
    sessionId: `m7-rollout-${testCase.id}`,
    plantPetId: testCase.context?.hasPlantPet ? 700001 : 0,
    context: { ...(testCase.context || {}) }
  };
  const plan = planControlledRollout({
    force: true,
    openid: 'm7-rollout-fixture-owner',
    cohortSecret: 'm7-rollout-probe-only',
    body
  });
  if (!plan.selected) {
    report.scenarios.push({
      id: testCase.id,
      category: testCase.category,
      legacyCallMode: legacy.legacy.callMode,
      selected: false,
      skipReason: plan.reason
    });
    continue;
  }

  const tools = createReadOnlyToolExecutor({
    db: noDatabaseSideEffects,
    openid: 'm7-rollout-fixture-owner',
    selectedPlantPetId: body.plantPetId,
    defaultQuery: testCase.query,
    defaultPlantType: '',
    profileReader: async () => ({ available: true, displayName: '测试植友' }),
    plantReader: async (db, openid, id) => openid === 'm7-rollout-fixture-owner' && id === 700001
      ? { id, nickname: '测试月季', speciesName: '月季', status: 'active' }
      : null
  });
  const runtime = new PlantPetRuntime({
    model,
    tools,
    maxSteps: Number(process.env.AGENT_ROLLOUT_MAX_STEPS) || 3,
    maxToolCalls: Number(process.env.AGENT_ROLLOUT_MAX_TOOL_CALLS) || 5,
    timeoutMs: Math.max(3000, Number(process.env.AGENT_ROLLOUT_TIMEOUT_MS) || 30000)
  });
  let result;
  let assessment;
  try {
    result = await runtime.run({
      ...plan.envelope,
      plantType: '',
      history: fixtureHistory(testCase.context?.historyProfile)
    });
    assessment = assessRolloutResult(result, plan.envelope);
  } catch (error) {
    result = {
      status: 'failed',
      modelSteps: 0,
      toolCalls: 0,
      toolTrace: [],
      elapsedMs: 0
    };
    assessment = { accepted: false, reason: String(error?.code || error?.name || 'probe_failed') };
  }
  const usedTools = Array.from(new Set((result.toolTrace || [])
    .filter((item) => item.outcome === 'success')
    .map((item) => item.toolName)));
  const expectedTools = (testCase.target.requiredTools || []).filter((name) => implementedTools.has(name));
  const unexpectedPrivateTools = (result.toolTrace || [])
    .filter((item) => item.source === 'model' && item.outcome === 'success')
    .map((item) => item.toolName)
    .filter((name) => ['get_account_nickname', 'get_selected_plant'].includes(name) && !expectedTools.includes(name));
  const answerContract = evaluateAnswerContract(testCase, result, assessment);
  report.scenarios.push({
    id: testCase.id,
    category: testCase.category,
    legacyCallMode: legacy.legacy.callMode,
    selected: true,
    accepted: assessment.accepted,
    fallbackReason: assessment.accepted ? '' : assessment.reason,
    targetResponseMode: testCase.target.responseMode,
    expectedPhase3Tools: expectedTools,
    missingExpectedTools: expectedTools.filter((name) => !usedTools.includes(name)),
    unexpectedPrivateTools: Array.from(new Set(unexpectedPrivateTools)),
    answerContract,
    answerDigest: assessment.accepted
      ? crypto.createHash('sha256').update(normalizeAnswer(result.finalContent)).digest('hex').slice(0, 16)
      : '',
    runtime: {
      status: result.status,
      modelSteps: result.modelSteps,
      toolCalls: result.toolCalls,
      toolTrace: result.toolTrace,
      elapsedMs: result.elapsedMs,
      promptTokens: Number(result.rawUsage?.prompt_tokens) || 0,
      completionTokens: Number(result.rawUsage?.completion_tokens) || 0,
      totalTokens: Number(result.rawUsage?.total_tokens) || 0,
      knowledgeSourceCount: Array.isArray(result.knowledgeHits) ? result.knowledgeHits.length : 0
    }
  });
}

const selected = report.scenarios.filter((item) => item.selected);
const accepted = selected.filter((item) => item.accepted);
const elapsed = selected.map((item) => item.runtime?.elapsedMs || 0).filter(Boolean);
const falseRejectCandidates = selected.filter((item) =>
  ['fixed_response', 'restricted_llm_without_history_or_private_context'].includes(item.legacyCallMode)
);
report.summary = {
  totalContractCases: report.scenarios.length,
  selectedCases: selected.length,
  acceptedCases: accepted.length,
  safeFallbackCases: selected.length - accepted.length,
  skippedCases: report.scenarios.length - selected.length,
  falseRejectCandidates: falseRejectCandidates.length,
  falseRejectCandidatesAccepted: falseRejectCandidates.filter((item) => item.accepted).length,
  evaluatedAnswerContractCases: selected.filter((item) => item.answerContract?.evaluated).length,
  answerContractFailures: selected.filter((item) => item.answerContract?.evaluated && !item.answerContract.passed).length,
  missingExpectedToolCases: selected.filter((item) => item.missingExpectedTools?.length).length,
  unexpectedPrivateToolCases: selected.filter((item) => item.unexpectedPrivateTools?.length).length,
  blockedOrFailedToolCalls: selected.reduce(
    (count, item) => count + (item.runtime?.toolTrace || []).filter((trace) => trace.outcome !== 'success').length,
    0
  ),
  p50ElapsedMs: percentile(elapsed, 0.5),
  p95ElapsedMs: percentile(elapsed, 0.95),
  totalPromptTokens: selected.reduce((sum, item) => sum + (item.runtime?.promptTokens || 0), 0),
  totalCompletionTokens: selected.reduce((sum, item) => sum + (item.runtime?.completionTokens || 0), 0),
  totalTokens: selected.reduce((sum, item) => sum + (item.runtime?.totalTokens || 0), 0),
  persistedBusinessWrites: 0
};

const outputPath = path.join(scriptDir, 'rollout-provider-probe.latest.json');
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));

if (
  report.summary.totalContractCases !== contract.cases.length
  || report.summary.selectedCases === 0
  || report.summary.acceptedCases < Math.ceil(report.summary.selectedCases * 0.8)
  || report.summary.falseRejectCandidatesAccepted === 0
  || report.summary.answerContractFailures !== 0
  || report.summary.missingExpectedToolCases !== 0
  || report.summary.unexpectedPrivateToolCases !== 0
  || report.summary.blockedOrFailedToolCalls !== 0
  || report.summary.persistedBusinessWrites !== 0
) process.exitCode = 1;
