const crypto = require('crypto');
const { buildSafetyMeta } = require('../lib/safety');
const { isLlmEnabled } = require('../lib/llmClient');
const {
  getOrCreateConversation,
  listRecentMessages,
  listConversationEvents,
  findCommittedExchangeByKey,
  saveExchange
} = require('../lib/agent-store');
const { consumeQuota, recordTokenUsage } = require('../lib/quota');
const { hasOwnedPlantPet } = require('../agent/petContext');
const {
  classifyTaskIntent,
  classifyMemoryIntent
} = require('../agent/intentRouter');
const { createTurnEnvelope } = require('./turnEnvelope');
const {
  isAccountNicknameQuery,
  requiresPublishedKnowledge,
  getAllowedToolNames
} = require('./capabilityPolicy');
const { createAgentToolExecutor } = require('./toolRegistry');
const { createOpenAiCompatibleAgentModel } = require('./modelAdapter');
const { PlantPetRuntime } = require('./plantPetRuntime');
const { projectTurnContext } = require('./contextProjector');

const TASK_CAPABILITY_PATTERN = /(任务|提醒|日程|计划|安排|打卡)/i;
const MEMORY_CAPABILITY_PATTERN = /(ai\s*记忆|记得|记住|忘记|上次|之前|历史|以后.{0,8}叫我|称呼.{0,8}偏好)/i;
const CURRENT_PLANT_CAPABILITY_PATTERN = /(我的植宠|当前植宠|这盆|它怎么|它现在|怎么了|叶子.{0,8}黄|叶片.{0,8}(黄|蔫|斑|卷)|最近.{0,8}(湿度|温度|状态)|状态怎么样|要不要浇水)/i;
const HIGH_RISK_CAPABILITY_PATTERN = /(误食|中毒|农药|杀虫剂|除草剂|加倍喷|孩子.{0,8}吃|宠物.{0,8}吃)/i;
const SECURITY_CAPABILITY_PATTERN = /(另一个用户|别人的|其他账号|跨账号|openid|读取植宠\s*\d+|指定植宠\s*\d+)/i;
const UNCERTAINTY_PATTERN = /(不确定|不知道|没有足够|资料不足|依据不足|无法确认|需要更多|暂时不能确定|还不能判断)/;
const IDENTITY_PRIVACY_PATTERN = /(账号昵称|账号称呼|真实身份|隐私|敏感信息|手机号|证件号|密码)/;
const INTERNAL_LEAK_PATTERN = /(<policy_read_results>|agent[_ -]?runtime|tool[_ -]?call|search_published_knowledge|get_account_nickname|get_selected_plant|\bRAG\b)/i;
const WRITE_CLAIM_PATTERN = /(已经|已为你|帮你)(成功)?(创建|安排|添加|设置|记录).{0,12}(任务|提醒|档案|日记)/;

function isRolloutEnabled(env = process.env) {
  return String(env.AGENT_ROLLOUT_ENABLED || '').toLowerCase() === 'true';
}

function fingerprintCohort(openid, sessionKey, secret) {
  if (!secret) {
    const error = new Error('rollout cohort secret is required');
    error.code = 'ROLLOUT_COHORT_KEY_REQUIRED';
    throw error;
  }
  return crypto.createHmac('sha256', String(secret))
    .update(`${String(openid || '')}\n${String(sessionKey || '')}`)
    .digest('hex')
    .slice(0, 16);
}

function fingerprintQuery(envelope, secret) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${String(envelope.sessionKey || '')}\n${String(envelope.message || '')}`)
    .digest('hex')
    .slice(0, 16);
}

function shouldSampleCohort(fingerprint, env = process.env) {
  const raw = String(env.AGENT_ROLLOUT_SAMPLE_RATE ?? '').trim();
  const configured = raw === '' ? 0.1 : Number(raw);
  const rate = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : 0.1;
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const bucket = Number.parseInt(String(fingerprint || '').slice(0, 8), 16) / 0xffffffff;
  return bucket < rate;
}

function requiredLegacyCapability(body = {}, message = '') {
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (body.logicalKey && !body.plantPetId && !body.sessionId) return 'legacy_hardware';
  if (context.selectedFunction) return 'selected_function';
  if (context.knowledgeContext || context.article || context.hasKnowledgeContext) return 'article_context';
  if (context.hasImage || context.hasDocument || body.visionInput || body.documentInput) return 'attachment';
  const memoryIntent = classifyMemoryIntent(message);
  if (memoryIntent.state === 'manage') return 'memory_governance';
  if (CURRENT_PLANT_CAPABILITY_PATTERN.test(message)) return 'current_plant_state';
  if (HIGH_RISK_CAPABILITY_PATTERN.test(message)) return 'high_risk';
  if (SECURITY_CAPABILITY_PATTERN.test(message)) return 'security_boundary';
  return '';
}

function planControlledRollout(options = {}) {
  const env = options.env || process.env;
  if (!options.force && !isRolloutEnabled(env)) return { selected: false, reason: 'disabled' };

  let envelope;
  try {
    envelope = createTurnEnvelope(options.body || {});
  } catch (error) {
    return { selected: false, reason: 'invalid_input' };
  }
  const legacyCapability = requiredLegacyCapability(options.body || {}, envelope.message);
  if (legacyCapability) return { selected: false, reason: legacyCapability, envelope };

  const secret = options.cohortSecret
    || env.AGENT_ROLLOUT_COHORT_KEY
    || env.AGENT_SHADOW_FINGERPRINT_KEY
    || env.JWT_SECRET
    || (options.force ? 'rollout-test-only' : '');
  if (!secret) return { selected: false, reason: 'missing_cohort_key', envelope };
  const cohortFingerprint = fingerprintCohort(options.openid, envelope.sessionKey, secret);
  if (!options.force && !shouldSampleCohort(cohortFingerprint, env)) {
    return { selected: false, reason: 'not_sampled', envelope, cohortFingerprint };
  }
  return {
    selected: true,
    reason: 'sampled',
    envelope,
    cohortFingerprint,
    queryFingerprint: fingerprintQuery(envelope, secret)
  };
}

function projectExistingHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && item.content)
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 1600) }));
}

function mapKnowledgeSource(item = {}) {
  return {
    type: String(item.type || 'knowledge_article'),
    title: String(item.title || ''),
    source: String(item.sourceId || item.sourceTitle || ''),
    sourceTitle: String(item.sourceTitle || ''),
    sourcePublisher: String(item.sourcePublisher || ''),
    sourceUrl: String(item.sourceUrl || ''),
    sourceId: String(item.sourceId || ''),
    contentUpdatedAt: String(item.contentUpdatedAt || ''),
    reviewedAt: item.reviewedAt || null
  };
}

function assessRolloutResult(result = {}, envelope = {}) {
  if (result.status !== 'completed') return { accepted: false, reason: result.status || 'runtime_incomplete' };
  const content = String(result.finalContent || '').trim();
  if (!content) return { accepted: false, reason: 'empty_content' };
  if (content.length > 4000) return { accepted: false, reason: 'content_too_long' };
  if (INTERNAL_LEAK_PATTERN.test(content)) return { accepted: false, reason: 'internal_term_leak' };
  if (WRITE_CLAIM_PATTERN.test(content)) return { accepted: false, reason: 'write_claim' };

  const trace = Array.isArray(result.toolTrace) ? result.toolTrace : [];
  if (trace.some((item) => item.outcome !== 'success')) return { accepted: false, reason: 'tool_failure' };
  const taskIntent = classifyTaskIntent(envelope.message);
  const memoryIntent = classifyMemoryIntent(envelope.message);
  if (trace.some((item) => item.toolName === 'get_selected_plant') && taskIntent.state !== 'request') {
    return { accepted: false, reason: 'current_plant_requires_legacy' };
  }
  if (!envelope.contextualMemory && !isAccountNicknameQuery(envelope.message)
    && memoryIntent.state !== 'recall'
    && trace.some((item) => item.toolName === 'get_account_nickname')) {
    return { accepted: false, reason: 'unnecessary_private_read' };
  }
  if (!envelope.contextualMemory && (isAccountNicknameQuery(envelope.message) || memoryIntent.state === 'recall')) {
    if (!trace.some((item) => item.toolName === 'recall_relevant_memories' && item.outcome === 'success')) {
      return { accepted: false, reason: 'memory_recall_tool_missing' };
    }
    if (!trace.some((item) => item.toolName === 'get_account_nickname' && item.outcome === 'success')) {
      return { accepted: false, reason: 'identity_tool_missing' };
    }
    if (!IDENTITY_PRIVACY_PATTERN.test(content)) {
      return { accepted: false, reason: 'identity_privacy_missing' };
    }
  }
  const proposals = Array.isArray(result.proposalDrafts) ? result.proposalDrafts : [];
  if (taskIntent.state === 'request') {
    if (!trace.some((item) => item.toolName === 'get_selected_plant' && item.outcome === 'success')) {
      return { accepted: false, reason: 'task_plant_tool_missing' };
    }
    if (!trace.some((item) => item.toolName === 'propose_care_task' && item.outcome === 'success')
      || !proposals.some((item) => item.proposalType === 'care_task')) {
      return { accepted: false, reason: 'task_proposal_missing' };
    }
  } else if (proposals.some((item) => item.proposalType === 'care_task')) {
    return { accepted: false, reason: 'unexpected_task_proposal' };
  }
  if (!envelope.contextualMemory && memoryIntent.state === 'propose') {
    if (!trace.some((item) => item.toolName === 'propose_memory_candidate' && item.outcome === 'success')
      || !proposals.some((item) => item.proposalType === 'memory_preference')) {
      return { accepted: false, reason: 'memory_proposal_missing' };
    }
  } else if (proposals.some((item) => item.proposalType === 'memory_preference')) {
    return { accepted: false, reason: 'unexpected_memory_proposal' };
  }
  if (requiresPublishedKnowledge(envelope)) {
    const knowledgeTrace = trace.find((item) =>
      item.toolName === 'search_published_knowledge' && item.outcome === 'success'
    );
    if (!knowledgeTrace) return { accepted: false, reason: 'knowledge_tool_missing' };
    if (knowledgeTrace.unknown === true && !UNCERTAINTY_PATTERN.test(content)) {
      return { accepted: false, reason: 'knowledge_uncertainty_missing' };
    }
    if (knowledgeTrace.hitCount > 0 && !(Array.isArray(result.knowledgeHits) && result.knowledgeHits.length)) {
      return { accepted: false, reason: 'knowledge_sources_missing' };
    }
  }
  return { accepted: true, reason: 'runtime_complete' };
}

function buildRolloutResponse(result, envelope) {
  const knowledgeSources = (Array.isArray(result.knowledgeHits) ? result.knowledgeHits : [])
    .map(mapKnowledgeSource);
  const trace = Array.isArray(result.toolTrace) ? result.toolTrace : [];
  const taskIntent = classifyTaskIntent(envelope.message);
  const memoryIntent = classifyMemoryIntent(envelope.message);
  const proposalDrafts = Array.isArray(result.proposalDrafts) ? result.proposalDrafts : [];
  const taskSuggestions = proposalDrafts
    .filter((item) => item.proposalType === 'care_task')
    .map((item) => ({
      proposalKey: item.proposalKey,
      status: 'pending',
      plantPetId: Number(item.plantPetId) || 0,
      ...(item.payload || {}),
      expiresAt: item.expiresAt
    }));
  const memorySuggestions = proposalDrafts
    .filter((item) => item.proposalType === 'memory_preference')
    .map((item) => ({
      proposalKey: item.proposalKey,
      status: 'pending',
      kind: item.payload?.kind || 'preference',
      value: item.payload?.value || '',
      content: item.payload?.content || '',
      expiresAt: item.expiresAt
    }));
  const intent = taskIntent.state === 'request'
    ? 'task_proposal'
    : memoryIntent.state === 'propose'
      ? 'memory_proposal'
      : (isAccountNicknameQuery(envelope.message) || memoryIntent.state === 'recall')
    ? 'identity'
    : (trace.some((item) => item.toolName === 'search_published_knowledge') ? 'knowledge' : 'general');
  return {
    success: true,
    intent: { type: intent, name: intent },
    summary: String(result.finalContent || '').trim(),
    diagnosis: '',
    facts: [],
    suggestions: knowledgeSources.length
      ? ['继续说说具体环境', '查看相关植物知识']
      : ['继续聊聊你的植物', '看看当前花园'],
    followUpQuestions: knowledgeSources.length
      ? ['这类植物还要注意什么？']
      : ['今天想聊哪盆植物？'],
    riskLevel: 'low',
    sources: [{
      type: 'llm_chat',
      model: process.env.LLM_MODEL || '',
      usage: result.rawUsage || null
    }].concat(knowledgeSources),
    taskSuggestions,
    memorySuggestions,
    scope: { status: 'in_scope', reason: 'runtime_controlled_rollout' },
    runtime: {
      name: 'plantpet_runtime',
      phase: 5,
      mode: 'controlled_rollout'
    },
    ...buildSafetyMeta()
  };
}

function defaultRecorder(report) {
  console.info(`[agent-rollout] ${JSON.stringify(report)}`);
}

function buildRolloutReport(plan, result, assessment, error = null) {
  const trace = Array.isArray(result?.toolTrace) ? result.toolTrace : [];
  return {
    schemaVersion: 1,
    mode: 'controlled_rollout',
    cohortFingerprint: String(plan?.cohortFingerprint || ''),
    queryFingerprint: String(plan?.queryFingerprint || ''),
    accepted: assessment?.accepted === true,
    reason: String(assessment?.reason || error?.code || error?.name || 'runtime_failed').slice(0, 80),
    status: String(result?.status || 'failed'),
    modelSteps: Number(result?.modelSteps) || 0,
    toolCalls: Number(result?.toolCalls) || 0,
    tools: trace.map((item) => ({
      toolName: String(item.toolName || ''),
      source: String(item.source || ''),
      outcome: String(item.outcome || ''),
      errorCode: String(item.errorCode || '')
    })),
    elapsedMs: Number(result?.elapsedMs) || 0
  };
}

function safeRecord(recorder, report) {
  try {
    recorder(report);
  } catch (error) {
    console.warn('[agent-rollout] recorder failed');
  }
}

async function tryHandleControlledRollout(options = {}) {
  const env = options.env || process.env;
  const model = options.model || createOpenAiCompatibleAgentModel({
    timeoutMs: Number(env.AGENT_ROLLOUT_TIMEOUT_MS) || 12000,
    maxTokens: Number(env.AGENT_ROLLOUT_MAX_TOKENS) || 500
  });
  if (!options.force && (!isLlmEnabled() || !model.isEnabled?.())) {
    return { selected: false, accepted: false, reason: 'model_disabled' };
  }
  const plan = planControlledRollout(options);
  if (!plan.selected) return { ...plan, accepted: false };

  const dependencies = {
    hasOwnedPlantPet,
    getOrCreateConversation,
    listRecentMessages,
    listConversationEvents,
    findCommittedExchangeByKey,
    saveExchange,
    consumeQuota,
    recordTokenUsage,
    ...(options.dependencies || {})
  };
  const recorder = options.recorder || defaultRecorder;
  const plantPetId = Number(options.body?.plantPetId) || 0;
  if (plantPetId && !await dependencies.hasOwnedPlantPet(options.db, options.openid, plantPetId)) {
    const error = new Error('植宠不存在或无权访问');
    error.statusCode = 404;
    throw error;
  }

  const conversation = await dependencies.getOrCreateConversation(
    options.db,
    options.openid,
    plan.envelope.sessionKey,
    plantPetId || null
  );
  if (plan.envelope.clientTurnKey) {
    const replay = await dependencies.findCommittedExchangeByKey(
      options.db,
      options.openid,
      plan.envelope.clientTurnKey
    );
    if (replay) {
      if (Number(replay.conversationId) !== Number(conversation.id)) {
        const error = new Error('clientTurnKey 已用于其他会话');
        error.code = 'CLIENT_TURN_KEY_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      return {
        selected: true,
        accepted: true,
        reason: 'idempotent_replay',
        response: {
          ...(replay.response || {}),
          success: true,
          sessionId: conversation.session_key,
          conversationId: Number(conversation.id) || 0,
          userMessageId: Number(replay.userMessageId) || 0,
          assistantMessageId: Number(replay.assistantMessageId) || 0,
          proposals: Array.isArray(replay.proposals) ? replay.proposals : [],
          idempotent: true
        },
        plan
      };
    }
  }
  const history = await dependencies.listRecentMessages(
    options.db,
    options.openid,
    conversation.id
  );
  const auditEvents = typeof options.db?.execute === 'function'
    ? await dependencies.listConversationEvents(options.db, options.openid, conversation.id)
    : [];
  const contextProjection = projectTurnContext({
    query: plan.envelope.message,
    messages: history,
    auditEvents,
    agentState: {
      route: 'controlled_rollout',
      allowedToolNames: getAllowedToolNames(plan.envelope)
    },
    privateContextAllowed: true
  });
  const envelope = {
    ...plan.envelope,
    contextualMemory: Boolean(require('../lib/conversation-context').getTurnContext()),
    plantType: '',
    history: contextProjection.history.map((item) => ({ role: item.role, content: item.content })),
    contextProjection
  };
  const baseTools = options.tools || createAgentToolExecutor({
    db: options.db,
    openid: options.openid,
    selectedPlantPetId: plantPetId,
    defaultQuery: envelope.message,
    defaultPlantType: '',
    allowedToolNames: getAllowedToolNames(envelope)
  });
  const tools = require('../lib/conversation-context').withHistoryTool(baseTools,
    require('../lib/conversation-context').getTurnContext());
  const runtime = options.runtime || new PlantPetRuntime({
    model,
    tools,
    maxSteps: Number(env.AGENT_ROLLOUT_MAX_STEPS) || 3,
    maxToolCalls: Number(env.AGENT_ROLLOUT_MAX_TOOL_CALLS) || 5,
    timeoutMs: Number(env.AGENT_ROLLOUT_TIMEOUT_MS) || 12000
  });

  let result;
  try {
    result = await runtime.run(envelope);
  } catch (error) {
    const assessment = { accepted: false, reason: String(error?.code || error?.name || 'runtime_failed') };
    safeRecord(recorder, buildRolloutReport(plan, null, assessment, error));
    return { selected: true, accepted: false, reason: assessment.reason, plan };
  }

  const assessment = assessRolloutResult(result, envelope);
  safeRecord(recorder, buildRolloutReport(plan, result, assessment));
  if (!assessment.accepted) {
    if (result.rawUsage) {
      try {
        await dependencies.recordTokenUsage(options.db, options.openid, result.rawUsage);
      } catch (error) {
        console.warn('[agent-rollout] rejected token usage could not be recorded');
      }
    }
    return { selected: true, accepted: false, reason: assessment.reason, result, plan };
  }

  const quotaResult = await dependencies.consumeQuota(options.db, options.openid, 'chat');
  const response = buildRolloutResponse(result, envelope);
  const exchange = await dependencies.saveExchange(
    options.db,
    options.openid,
    conversation.id,
    envelope.message,
    response.summary,
    response,
    {
      proposals: Array.isArray(result.proposalDrafts) ? result.proposalDrafts : [],
      clientTurnKey: plan.envelope.clientTurnKey || ''
    }
  );
  const usage = result.rawUsage
    ? await dependencies.recordTokenUsage(options.db, options.openid, result.rawUsage)
    : quotaResult.usage;
  return {
    selected: true,
    accepted: true,
    reason: assessment.reason,
    response: {
      ...(exchange.response || response),
      sessionId: conversation.session_key,
      conversationId: Number(conversation.id) || 0,
      userMessageId: exchange.userMessageId,
      assistantMessageId: exchange.assistantMessageId,
      memoryUpdated: false,
      proposals: Array.isArray(exchange.proposals) ? exchange.proposals : [],
      quota: usage
    },
    result,
    plan
  };
}

module.exports = {
  TASK_CAPABILITY_PATTERN,
  MEMORY_CAPABILITY_PATTERN,
  CURRENT_PLANT_CAPABILITY_PATTERN,
  HIGH_RISK_CAPABILITY_PATTERN,
  SECURITY_CAPABILITY_PATTERN,
  isRolloutEnabled,
  fingerprintCohort,
  shouldSampleCohort,
  requiredLegacyCapability,
  planControlledRollout,
  projectExistingHistory,
  mapKnowledgeSource,
  assessRolloutResult,
  buildRolloutResponse,
  buildRolloutReport,
  tryHandleControlledRollout
};
