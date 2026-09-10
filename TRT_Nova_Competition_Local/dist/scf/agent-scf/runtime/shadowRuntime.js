const crypto = require('crypto');
const { isLlmEnabled } = require('../lib/llmClient');
const { createTurnEnvelope } = require('./turnEnvelope');
const { createReadOnlyToolExecutor } = require('./toolRegistry');
const { createOpenAiCompatibleShadowModel } = require('./modelAdapter');
const { PlantPetRuntime } = require('./plantPetRuntime');

function isShadowEnabled(env = process.env) {
  return String(env.AGENT_SHADOW_ENABLED || '').toLowerCase() === 'true';
}

function fingerprintTurn(envelope = {}, secret = '') {
  if (!secret) {
    const error = new Error('shadow fingerprint secret is required');
    error.code = 'SHADOW_FINGERPRINT_KEY_REQUIRED';
    throw error;
  }
  return crypto.createHmac('sha256', String(secret))
    .update(`${envelope.sessionKey || ''}\n${envelope.message || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function shouldSample(fingerprint, env = process.env) {
  const configured = Number(env.AGENT_SHADOW_SAMPLE_RATE);
  const rate = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : 1;
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const bucket = Number.parseInt(String(fingerprint || '').slice(0, 8), 16) / 0xffffffff;
  return bucket < rate;
}

function summarizeLegacyResponse(response = {}) {
  const sources = Array.isArray(response.sources) ? response.sources : [];
  return {
    success: response.success !== false,
    route: response.scope?.status
      ? `${response.scope.status}:${response.scope.reason || 'unknown'}`
      : `legacy:${response.intent?.type || 'unknown'}`,
    intent: String(response.intent?.type || ''),
    usedModel: sources.some((source) => source?.type === 'llm_chat'),
    knowledgeSourceCount: sources.filter((source) => ['knowledge_article', 'plant_library', 'protocol'].includes(source?.type)).length,
    taskProposalCount: Array.isArray(response.taskSuggestions) ? response.taskSuggestions.length : 0
  };
}

function buildComparison(handle, legacyResponse, shadowResult, legacyError = null) {
  const trace = Array.isArray(shadowResult?.toolTrace) ? shadowResult.toolTrace : [];
  const knowledgeTrace = trace.find((item) => item.toolName === 'search_published_knowledge');
  const legacy = legacyResponse ? summarizeLegacyResponse(legacyResponse) : {
    success: false,
    route: 'legacy:error',
    intent: '',
    usedModel: false,
    knowledgeSourceCount: 0,
    taskProposalCount: 0
  };
  return {
    schemaVersion: 1,
    mode: 'read_only_shadow',
    queryFingerprint: handle.fingerprint,
    legacy,
    shadow: {
      status: String(shadowResult?.status || 'failed'),
      modelSteps: Number(shadowResult?.modelSteps) || 0,
      toolCalls: Number(shadowResult?.toolCalls) || 0,
      toolTrace: trace,
      elapsedMs: Number(shadowResult?.elapsedMs) || 0
    },
    differences: {
      shadowUsedNicknameTool: trace.some((item) => item.toolName === 'get_account_nickname' && item.outcome === 'success'),
      shadowUsedSelectedPlantTool: trace.some((item) => item.toolName === 'get_selected_plant' && item.outcome === 'success'),
      shadowKnowledgeProbeHits: Number(knowledgeTrace?.hitCount) || 0,
      legacyKnowledgeSourceCount: legacy.knowledgeSourceCount,
      legacyUsedModel: legacy.usedModel
    },
    legacyError: legacyError ? String(legacyError.code || legacyError.name || 'LEGACY_FAILED').slice(0, 80) : ''
  };
}

function defaultRecorder(report) {
  console.info(`[agent-shadow] ${JSON.stringify(report)}`);
}

function startAgentShadow(options = {}) {
  const env = options.env || process.env;
  if (!options.force && !isShadowEnabled(env)) return null;
  if (options.body?.logicalKey && !options.body?.plantPetId && !options.body?.sessionId) return null;

  const envelope = createTurnEnvelope(options.body || {});
  const fingerprintSecret = options.fingerprintSecret
    || env.AGENT_SHADOW_FINGERPRINT_KEY
    || env.JWT_SECRET;
  const fingerprint = fingerprintTurn(envelope, options.force && !fingerprintSecret ? 'shadow-test-only' : fingerprintSecret);
  if (!options.force && !shouldSample(fingerprint, env)) return null;

  const model = options.model || createOpenAiCompatibleShadowModel();
  if (!options.force && (!isLlmEnabled() || !model.isEnabled?.())) return null;
  const tools = options.tools || createReadOnlyToolExecutor({
    db: options.db,
    openid: options.openid,
    selectedPlantPetId: envelope.selectedPlantPetId,
    defaultQuery: envelope.message,
    defaultPlantType: envelope.plantType
  });
  const runtime = options.runtime || new PlantPetRuntime({
    model,
    tools,
    maxSteps: Number(env.AGENT_SHADOW_MAX_STEPS) || 3,
    maxToolCalls: Number(env.AGENT_SHADOW_MAX_TOOL_CALLS) || 5,
    timeoutMs: Number(env.AGENT_SHADOW_TIMEOUT_MS) || 12000
  });

  return {
    fingerprint,
    promise: runtime.run(envelope),
    recorder: options.recorder || defaultRecorder
  };
}

async function completeAgentShadow(handle, legacyResponse = null, legacyError = null) {
  if (!handle) return null;
  let shadowResult;
  try {
    shadowResult = await handle.promise;
  } catch (error) {
    shadowResult = {
      status: 'failed',
      modelSteps: 0,
      toolCalls: 0,
      toolTrace: [{ toolName: '', source: 'runtime', outcome: 'blocked_or_failed', errorCode: String(error?.code || error?.name || 'SHADOW_FAILED').slice(0, 80) }],
      elapsedMs: 0
    };
  }
  const report = buildComparison(handle, legacyResponse, shadowResult, legacyError);
  try {
    handle.recorder(report);
  } catch (error) {
    console.warn('[agent-shadow] recorder failed');
  }
  return report;
}

module.exports = {
  isShadowEnabled,
  fingerprintTurn,
  shouldSample,
  summarizeLegacyResponse,
  buildComparison,
  startAgentShadow,
  completeAgentShadow
};
