import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env.local');
  if (!fs.existsSync(envPath)) throw new Error('M7_SHADOW_ENV_MISSING');
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

if (process.env.M7_SHADOW_PROVIDER_PROBE !== '1') {
  throw new Error('M7_SHADOW_PROVIDER_PROBE must be 1 to authorize the real provider probe');
}

loadLocalEnv();

const { createReadOnlyToolExecutor, TOOL_META } = require('../../dist/scf/agent-scf/runtime/toolRegistry');
const { createOpenAiCompatibleShadowModel } = require('../../dist/scf/agent-scf/runtime/modelAdapter');
const { PlantPetRuntime } = require('../../dist/scf/agent-scf/runtime/plantPetRuntime');
const legacyBaseline = require('./legacy-router-baseline.json');

const scenarios = [
  { id: 'social-hello-plain', selectedPlantPetId: 0 },
  { id: 'identity-who-am-i', selectedPlantPetId: 0 },
  { id: 'knowledge-rose-watering', selectedPlantPetId: 0, plantType: '月季' },
  { id: 'plant-selected-status', selectedPlantPetId: 700001, plantType: '月季' },
  { id: 'common-arithmetic', selectedPlantPetId: 0 }
];
const implementedTools = new Set(Object.keys(TOOL_META));
const model = createOpenAiCompatibleShadowModel();
if (!model.isEnabled()) throw new Error('M7_SHADOW_PROVIDER_DISABLED');

const noDatabaseSideEffects = {
  async execute(sql) {
    if (!/^\s*SELECT\b/i.test(String(sql || ''))) throw new Error('M7_SHADOW_WRITE_ATTEMPT');
    throw new Error('M7_SHADOW_SEED_FALLBACK');
  },
  async query(sql) {
    if (!/^\s*SELECT\b/i.test(String(sql || ''))) throw new Error('M7_SHADOW_WRITE_ATTEMPT');
    throw new Error('M7_SHADOW_SEED_FALLBACK');
  }
};

const report = {
  schemaVersion: 1,
  mode: 'real_provider_read_only_shadow_probe',
  generatedAt: new Date().toISOString(),
  model: process.env.LLM_MODEL || '',
  persistedBusinessWrites: 0,
  scenarios: []
};

for (const scenario of scenarios) {
  const baseline = legacyBaseline.rows.find((item) => item.id === scenario.id);
  if (!baseline) throw new Error(`M7_SHADOW_BASELINE_MISSING:${scenario.id}`);
  const tools = createReadOnlyToolExecutor({
    db: noDatabaseSideEffects,
    openid: 'm7-shadow-fixture-owner',
    selectedPlantPetId: scenario.selectedPlantPetId,
    defaultQuery: baseline.query,
    defaultPlantType: scenario.plantType || '',
    profileReader: async () => ({ available: true, displayName: '测试植友' }),
    plantReader: async (db, openid, id) => openid === 'm7-shadow-fixture-owner' && id === 700001
      ? { id, nickname: '测试月季', speciesName: '月季', status: 'active' }
      : null
  });
  const runtime = new PlantPetRuntime({
    model,
    tools,
    maxSteps: 3,
    maxToolCalls: 5,
    timeoutMs: Math.max(3000, Number(process.env.AGENT_SHADOW_TIMEOUT_MS) || 30000)
  });
  const result = await runtime.run({
    message: baseline.query,
    plantType: scenario.plantType || '',
    selectedPlantPetId: scenario.selectedPlantPetId
  });
  const usedTools = Array.from(new Set(result.toolTrace
    .filter((item) => item.outcome === 'success')
    .map((item) => item.toolName)));
  const expectedTools = (baseline.target.requiredTools || []).filter((name) => implementedTools.has(name));
  const unexpectedPrivateTools = result.toolTrace
    .filter((item) => item.source === 'model' && item.outcome === 'success')
    .map((item) => item.toolName)
    .filter((name) => ['get_account_nickname', 'get_selected_plant'].includes(name) && !expectedTools.includes(name));
  report.scenarios.push({
    id: scenario.id,
    legacy: baseline.legacy,
    targetResponseMode: baseline.target.responseMode,
    shadow: {
      status: result.status,
      modelSteps: result.modelSteps,
      toolCalls: result.toolCalls,
      toolTrace: result.toolTrace,
      elapsedMs: result.elapsedMs
    },
    expectedPhase2Tools: expectedTools,
    missingExpectedTools: expectedTools.filter((name) => !usedTools.includes(name)),
    unexpectedPrivateTools: Array.from(new Set(unexpectedPrivateTools))
  });
}

report.summary = {
  total: report.scenarios.length,
  completed: report.scenarios.filter((item) => item.shadow.status === 'completed').length,
  missingExpectedToolCases: report.scenarios.filter((item) => item.missingExpectedTools.length).length,
  unexpectedPrivateToolCases: report.scenarios.filter((item) => item.unexpectedPrivateTools.length).length,
  blockedOrFailedToolCalls: report.scenarios.reduce(
    (count, item) => count + item.shadow.toolTrace.filter((trace) => trace.outcome !== 'success').length,
    0
  ),
  persistedBusinessWrites: report.persistedBusinessWrites
};

const outputPath = path.join(scriptDir, 'shadow-provider-probe.latest.json');
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));

if (
  report.summary.completed !== report.summary.total
  || report.summary.missingExpectedToolCases !== 0
  || report.summary.unexpectedPrivateToolCases !== 0
  || report.summary.blockedOrFailedToolCalls !== 0
  || report.summary.persistedBusinessWrites !== 0
) process.exitCode = 1;
