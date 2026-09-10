const crypto = require('crypto');
const { buildSafetyMeta } = require('../lib/safety');
const { chatWithLlm, isLlmEnabled } = require('../lib/llmClient');
const { getDeviceSnapshot, getHistorySummary } = require('../tools/device');
const { buildTrendSentence, computeRiskFacts } = require('../rules/plantDiagnosis');
const { searchKnowledgeBundle } = require('../rag/knowledgeSearch');
const {
  getOrCreateConversation,
  listRecentMessages,
  listMemories,
  findCommittedExchangeByKey,
  saveExchange
} = require('../lib/agent-store');
const { consumeQuota, recordTokenUsage } = require('../lib/quota');
const { hasOwnedPlantPet, loadPlantPetContext, buildPlantContextText, selectRelevantMemories } = require('./petContext');
const { loadUserDisplayProfile, buildUserIdentityResponse } = require('./userIdentity');
const { findMentionedPlantProfiles, plantPetMatchesProfile } = require('../tools/plant');
const { startAgentShadow, completeAgentShadow } = require('../runtime/shadowRuntime');
const { tryHandleControlledRollout } = require('../runtime/rolloutRuntime');
const {
  classifyAssistantScope,
  filterModelHistory,
  buildSocialResponse,
  buildOutOfScopeResponse,
  buildDeferredScopeInstruction,
  buildDeferredFallbackResponse,
  hasExplicitTaskIntent,
  classifyMemoryIntent
} = require('./intentRouter');
const { parseTaskDraft } = require('../runtime/capabilityPolicy');

const MAX_MESSAGE_LENGTH = 300;
const SELECTABLE_FUNCTIONS = Object.freeze({
  plant_status: { key: 'plant_status', capability: 'read_plant_context', sideEffect: 'none' },
  watering: { key: 'watering', capability: 'read_care_context', sideEffect: 'none' },
  memory: { key: 'memory', capability: 'read_structured_memory', sideEffect: 'none' }
});

function normalizeSelectedFunction(input = null) {
  const key = String(input?.key || '').trim();
  const selected = SELECTABLE_FUNCTIONS[key];
  return selected ? { ...selected, requestedByUser: true } : null;
}

function normalizeLogicalKey(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function inferIntent(message = '') {
  const text = String(message || '').trim();
  if (!text) return 'general';

  if (/^(你好|您好|hi|hello|嗨|在吗|你是谁|介绍一下)/i.test(text)) return 'chat';
  if (/(怎么养|种植|养护|黄叶|光照|施肥|土壤湿度|soil_percent|run_state|fan_switch|什么意思|是什么)/.test(text)) return 'knowledge';
  if (text.includes('浇水')) return 'watering';
  if (text.includes('趋势') || text.includes('变化') || text.includes('最近')) return 'trend';
  if (text.includes('状态') || text.includes('怎么样') || text.includes('正常')) return 'status';
  if (text.includes('风扇') || text.includes('通风')) return 'control';
  return 'general';
}

function needsDeviceContext(intent) {
  return ['watering', 'trend', 'status', 'control'].includes(intent);
}

function deduplicateStrings(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildKnowledgeContextText(article = {}) {
  const title = String(article?.title || '').trim();
  if (!title) return '';

  const parts = [
    `当前引用文章：${title}`,
    article.summary ? `摘要：${String(article.summary).trim()}` : '',
    article.content ? `正文：${String(article.content).trim()}` : '',
    Array.isArray(article.tags) && article.tags.length ? `标签：${article.tags.join('、')}` : '',
    Array.isArray(article.plantTypes) && article.plantTypes.length ? `适用植物：${article.plantTypes.join('、')}` : '',
    Array.isArray(article.problemTypes) && article.problemTypes.length ? `相关问题：${article.problemTypes.join('、')}` : ''
  ].filter(Boolean);

  return parts.join('\n');
}

function buildLlmResponse(content, intent, safetyMeta, usage = null, sources = []) {
  return {
    success: true,
    intent: {
      type: intent,
      name: intent
    },
    summary: content,
    diagnosis: '',
    facts: [],
    suggestions: [
      '我的植物现在状态怎么样？',
      '我现在要不要浇水？',
      '最近湿度变化如何？'
    ],
    followUpQuestions: [
      '我的植物现在状态怎么样？',
      '我现在要不要浇水？',
      '最近湿度变化如何？'
    ],
    riskLevel: 'low',
    sources: [{ type: 'llm_chat', model: process.env.LLM_MODEL || '', usage }].concat(sources),
    ...safetyMeta
  };
}

function mapKnowledgeSource(item = {}) {
  return {
    type: item.type,
    title: item.title,
    source: item.source,
    sourceTitle: item.sourceTitle || '',
    sourcePublisher: item.sourcePublisher || '',
    sourceUrl: item.sourceUrl || '',
    sourceId: item.sourceId || '',
    contentUpdatedAt: item.contentUpdatedAt || '',
    reviewedAt: item.reviewedAt || null
  };
}

function buildKnowledgeFallbackResponse(bundle, intent, safetyMeta) {
  const firstHit = bundle.hits[0];
  const otherTitles = bundle.hits.slice(1).map((item) => item.title).filter(Boolean);

  return {
    success: true,
    intent: {
      type: intent,
      name: intent
    },
    summary: firstHit
      ? '我先从可靠资料里挑出和你这个问题最相关的部分。'
      : '我现在还没有足够可靠的信息，暂时不能给你一个确定结论。',
    diagnosis: firstHit
      ? `${firstHit.content}${otherTitles.length ? `\n\n本轮还参考了：${otherTitles.join('、')}。` : ''}`
      : '你可以再告诉我具体植物名和眼前能看到的状态；信息仍然不够时，我会直接告诉你不确定。',
    facts: [],
    suggestions: ['我的植物现在状态怎么样？', '我现在要不要浇水？', '最近湿度变化如何？'],
    followUpQuestions: ['这类植物平时怎么浇水？', '这个字段是什么意思？'],
    riskLevel: 'low',
    sources: bundle.hits.map(mapKnowledgeSource),
    ...safetyMeta
  };
}

async function handleLegacyAgentChat(db, openid, body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const logicalKey = normalizeLogicalKey(body?.logicalKey);
  const context = body?.context && typeof body.context === 'object' ? body.context : {};
  const safetyMeta = buildSafetyMeta();
  const knowledgeContextText = buildKnowledgeContextText(context.knowledgeContext || context.article || {});

  if (!message) {
    return {
      success: false,
      msg: 'message is required',
      ...safetyMeta
    };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      success: false,
      msg: `message is too long, max ${MAX_MESSAGE_LENGTH} characters`,
      ...safetyMeta
    };
  }

  const intent = inferIntent(message);
  const knowledgeBundle = await searchKnowledgeBundle(db, {
    query: message,
    plantType: context.plantType || '',
    plantLibraryId: context.plantLibraryId || 0,
    knowledgeLimit: 3
  });
  const combinedKnowledgeContextText = [
    knowledgeContextText,
    knowledgeBundle.contextText
  ].filter(Boolean).join('\n\n');

  if (!logicalKey) {
    if (!needsDeviceContext(intent)) {
      if (intent === 'knowledge' && !knowledgeBundle.hits.length && !knowledgeContextText) {
        return buildKnowledgeFallbackResponse(knowledgeBundle, intent, safetyMeta);
      }
      try {
        const llmResult = await chatWithLlm({
          message,
          contextText: combinedKnowledgeContextText
        });
        if (llmResult.enabled && llmResult.content) {
          return buildLlmResponse(
            llmResult.content,
            intent,
            safetyMeta,
            llmResult.rawUsage,
            knowledgeBundle.hits.map(mapKnowledgeSource)
          );
        }
      } catch (err) {
        console.warn('llm chat fallback:', err.message);
      }

      if (knowledgeBundle.hits.length) {
        return buildKnowledgeFallbackResponse(knowledgeBundle, intent, safetyMeta);
      }

      return {
        success: true,
        intent: {
          type: intent,
          name: intent
        },
        summary: isLlmEnabled()
          ? '这次普通对话 API 暂时没有返回成功，我先用本地助手模式回应你。'
          : '普通对话 API 还没有配置好，我现在先保持植物养护助手的本地模式。',
        diagnosis: '你可以先问我植物状态、浇水建议、历史趋势；配置 LLM_API_* 环境变量后，我也可以做更自然的普通对话。',
        facts: [],
        suggestions: ['我的植物现在状态怎么样？', '我现在要不要浇水？', '最近湿度变化如何？'],
        followUpQuestions: ['我的植物现在状态怎么样？', '我现在要不要浇水？'],
        riskLevel: 'low',
        sources: [{ type: 'local_fallback' }],
        ...safetyMeta
      };
    }

    return {
      success: true,
      summary: '我还不知道你现在想看哪台设备。',
      diagnosis: '请先选择一个设备，再问我状态、浇水建议或历史趋势。',
      facts: [],
      suggestions: ['先选择设备', '再问我“现在状态怎么样？”', '或者问我“最近湿度变化如何？”'],
      followUpQuestions: ['请选择设备后重试', '我的植物现在状态怎么样？'],
      riskLevel: 'low',
      ...safetyMeta
    };
  }

  const snapshot = await getDeviceSnapshot(db, openid, logicalKey);
  if (!snapshot) {
    return {
      success: false,
      msg: '未找到当前设备或你没有访问权限',
      ...safetyMeta
    };
  }

  const risk = computeRiskFacts(snapshot);
  const soilHistory = await getHistorySummary(db, logicalKey, 'soil_percent', '24h', '5m', 288);
  const tempHistory = await getHistorySummary(db, logicalKey, 'dht_temp', '24h', '5m', 288);
  const deviceKnowledgeBundle = await searchKnowledgeBundle(db, {
    query: message,
    plantType: context.plantType || snapshot.plantType || '',
    plantLibraryId: context.plantLibraryId || snapshot.plantLibraryId || 0,
    knowledgeLimit: 3
  });

  const facts = risk.facts.slice();
  const extraFacts = [];
  const suggestions = risk.suggestions.slice();
  let summary = '';
  let diagnosis = '';

  if (intent === 'watering') {
    extraFacts.push(buildTrendSentence('最近 24 小时土壤湿度', soilHistory));
    if (risk.soil !== null && risk.soil < 20) {
      summary = '当前土壤湿度偏低，建议补水。';
      diagnosis = '从当前数据看，这台植物已经接近或进入缺水区间。如果叶片也有发软或下垂现象，可以优先安排补水。';
      suggestions.unshift('今晚尽快补水一次');
      suggestions.push('补水后 1 到 2 小时复查湿度');
    } else if (risk.soil !== null && risk.soil > 80) {
      summary = '当前土壤湿度偏高，暂时不建议浇水。';
      diagnosis = '这台植物的土壤已经比较湿润，继续浇水可能增加积水风险。';
      suggestions.unshift('先暂停浇水');
      suggestions.push('观察明天湿度是否自然回落');
    } else {
      summary = '当前没有明显缺水信号，是否浇水可结合盆土表层状态再判断。';
      diagnosis = '从传感器数据看，土壤湿度还没有进入明显缺水区。若你看到表土发白、叶片微蔫，再考虑补水会更稳妥。';
      suggestions.push('先观察表土和叶片状态');
    }
  } else if (intent === 'trend') {
    extraFacts.push(buildTrendSentence('最近 24 小时土壤湿度', soilHistory));
    extraFacts.push(buildTrendSentence('最近 24 小时环境温度', tempHistory));
    summary = '我已经帮你看了最近的趋势变化。';
    diagnosis = `土壤湿度${buildTrendSentence('', soilHistory).replace(/^/, '') || '趋势暂不明确'}，环境温度${buildTrendSentence('', tempHistory).replace(/^/, '') || '趋势暂不明确'}。`;
    suggestions.push('如果你愿意，下一步我可以继续重点分析浇水风险');
  } else if (intent === 'control') {
    summary = '我可以先帮你判断当前是否适合通风。';
    if (risk.temp !== null && risk.temp > 30) {
      diagnosis = '当前环境温度偏高，如果设备支持风扇通风，可以考虑开启以改善闷热环境。';
      suggestions.unshift('可以在设备控制区手动确认开启风扇');
    } else {
      diagnosis = '从当前温度看，没有特别强的通风压力，但如果环境闷湿，也可以适当通风。';
      suggestions.push('也可以先观察湿度和叶片状态');
    }
  } else {
    summary = risk.alerts.length
      ? `当前我最关注的是：${risk.alerts[0]}。`
      : '当前这台植物的基础状态看起来还比较平稳。';
    diagnosis = risk.alerts.length
      ? `我结合实时设备数据看，当前有 ${risk.alerts.join('、')} 这类信号。优先建议先处理最明显的问题。`
      : '目前没有明显的温度、湿度、光照或土壤湿度异常，适合继续观察。';
    if (intent === 'knowledge' && deviceKnowledgeBundle.hits.length) {
      diagnosis = `${diagnosis}\n\n补充知识：${deviceKnowledgeBundle.hits[0].content}`;
    }
  }

  const finalFacts = deduplicateStrings(facts.concat(extraFacts).filter(Boolean)).slice(0, 5);
  const finalSuggestions = deduplicateStrings(suggestions).slice(0, 4);

  return {
    success: true,
    intent: {
      type: intent,
      name: intent
    },
    summary,
    diagnosis,
    facts: finalFacts,
    suggestions: finalSuggestions,
    followUpQuestions: [
      '最近湿度变化如何？',
      '我现在要不要浇水？',
      '我的植物现在状态怎么样？'
    ],
    riskLevel: risk.riskLevel,
    sources: [
      { type: 'device_latest', logicalKey },
      { type: 'device_history', range: '24h', metrics: ['soil_percent', 'dht_temp'] }
    ].concat(
      deviceKnowledgeBundle.hits.map(mapKnowledgeSource)
    ),
    ...safetyMeta
  };
}

function todayInShanghai(nowMs = Date.now()) {
  return new Date(Number(nowMs) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function buildTaskSuggestions(message, plantPetId, options = {}) {
  const text = String(message || '').trim();
  if (options.blocked) return [];
  if (!Number(plantPetId) || !hasExplicitTaskIntent(text)) return [];
  const parsed = parseTaskDraft(text);
  return [{
    plantPetId: Number(plantPetId),
    ...parsed,
    description: parsed.description || '这是 NOVA 的待确认建议，请结合现场情况修改日期、频率和内容后再保存。',
    source: 'ai'
  }];
}

function createProposalKey() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function prepareTaskProposalDrafts(taskSuggestions = []) {
  return (Array.isArray(taskSuggestions) ? taskSuggestions : []).slice(0, 1).map((suggestion) => {
    const proposalKey = suggestion.proposalKey || createProposalKey();
    Object.assign(suggestion, { proposalKey, status: 'pending' });
    return {
      proposalKey,
      proposalType: 'care_task',
      plantPetId: Number(suggestion.plantPetId) || 0,
      payload: {
        taskType: suggestion.taskType,
        title: suggestion.title,
        description: suggestion.description || '',
        scheduledFor: suggestion.scheduledFor,
        reminderTime: suggestion.reminderTime || null,
        recurrenceType: suggestion.recurrenceType || 'none',
        recurrenceInterval: Number(suggestion.recurrenceInterval) || 1,
        reason: suggestion.reason || '用户明确请求创建养护任务'
      },
      expiresAt: suggestion.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
  });
}

function prepareMemoryProposalDraft(message, response) {
  const intent = classifyMemoryIntent(message);
  if (intent.state !== 'propose' || !intent.preference) return [];
  const proposalKey = createProposalKey();
  response.memorySuggestions = [{
    proposalKey,
    status: 'pending',
    ...intent.preference,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }];
  response.diagnosis = `我先把“${intent.preference.value}”作为待确认称呼；只有你点击确认后，它才会进入跨会话长期记忆。请只使用昵称，不要提供真实姓名、手机号、证件号、密码等敏感信息。`;
  return [{
    proposalKey,
    proposalType: 'memory_preference',
    plantPetId: null,
    payload: intent.preference,
    expiresAt: response.memorySuggestions[0].expiresAt
  }];
}

function buildPlantTopicMismatch(pet, mentionedPlant) {
  if (!pet || !mentionedPlant || plantPetMatchesProfile(pet, mentionedPlant)) return null;
  return {
    selectedPlantPetId: Number(pet.id) || 0,
    selectedNickname: pet.nickname || '当前植宠',
    selectedSpecies: pet.speciesName || '未知品种',
    requestedPlantName: mentionedPlant.name || '问题中的植物',
    taskBindingBlocked: true
  };
}

function buildPlantTopicMismatchInstruction(mismatch = null, message = '') {
  if (!mismatch) return '';
  const taskRequested = hasExplicitTaskIntent(message);
  return [
    '本轮植物主题边界（请自然融入回答，不要逐条复述）：',
    `用户界面当前选中的是“${mismatch.selectedNickname}”（${mismatch.selectedSpecies}），但本轮实际咨询的是“${mismatch.requestedPlantName}”。`,
    `回答开头用一两句符合 NOVA 人设的自然中文说明这个差异，然后只回答“${mismatch.requestedPlantName}”的问题。`,
    `不要引用“${mismatch.selectedNickname}”的私有档案或养护记录，也不要把两盆植物的资料混在一起。`,
    taskRequested
      ? `用户还提到了任务：请自然说明需要先切换到“${mismatch.requestedPlantName}”对应植宠或为它建档，任务仍需用户确认。`
      : '用户没有要求创建任务，不要主动展开任务流程。',
    '不要使用“知识库、RAG、任务绑定、门禁、已复核发布”等内部实现词。'
  ].join('\n');
}

function mismatchWasExplained(response = {}, mismatch = null) {
  if (!mismatch) return true;
  const text = [response.summary, response.diagnosis].filter(Boolean).join('\n');
  const selectedMentioned = [mismatch.selectedNickname, mismatch.selectedSpecies]
    .filter(Boolean)
    .some((item) => text.includes(item));
  return selectedMentioned && text.includes(mismatch.requestedPlantName);
}

function applyPlantTopicMismatch(response = {}, mismatch = null, options = {}) {
  if (!mismatch) return response;
  const modelExplainedBoundary = options.modelGeneratedBoundary === true && mismatchWasExplained(response, mismatch);
  const taskRequested = options.taskRequested === true;
  const fallbackLead = [
    `你现在选中的是${mismatch.selectedNickname}（${mismatch.selectedSpecies}），这次问的是${mismatch.requestedPlantName}；我先只按${mismatch.requestedPlantName}的一般情况回答，不混用当前植宠的记录。`,
    taskRequested ? `若要为${mismatch.requestedPlantName}安排任务，请先切换到它对应的植宠或为它建档，再由你确认任务内容。` : ''
  ].filter(Boolean).join('\n');
  return {
    ...response,
    summary: modelExplainedBoundary
      ? response.summary
      : [fallbackLead, response.summary].filter(Boolean).join('\n\n'),
    suggestions: [
      `继续了解${mismatch.requestedPlantName}的一般养护`,
      `切换或新建${mismatch.requestedPlantName}植宠`
    ],
    followUpQuestions: [
      `继续了解${mismatch.requestedPlantName}的一般养护`,
      `切换或新建${mismatch.requestedPlantName}植宠`
    ],
    taskSuggestions: [],
    topicMismatch: mismatch
  };
}

function buildMemoryRecall(memories, pet, query = '') {
  const rows = selectRelevantMemories(memories, query, 5);
  if (!rows.length) return null;
  return {
    summary: pet ? `我记得 ${pet.nickname} 的这些信息。` : '我记得你确认或留下的这些信息。',
    diagnosis: rows.map((item) => `· ${item.content}`).join('\n'),
    facts: rows.map((item) => item.content),
    sources: rows.map((item) => ({
      type: 'structured_memory',
      title: item.type === 'user_preference' ? '用户确认偏好' : '植宠记忆',
      source: item.sourceId ? `${item.sourceType}:${item.sourceId}` : item.sourceType,
      sourceTitle: item.sourceType,
      contentUpdatedAt: item.updatedAt || item.sourceTime || ''
    }))
  };
}

function markModelUnavailable(response = {}) {
  return {
    ...response,
    summary: `模型暂不可用；以下仅依据已发布知识整理。${response.summary || ''}`,
    sources: [{ type: 'model_unavailable', title: '模型暂不可用' }].concat(response.sources || [])
  };
}

function buildAssistantText(response = {}) {
  return [response.summary, response.diagnosis].filter(Boolean).join('\n\n') || response.msg || '';
}

async function handleCurrentAgentChat(db, openid, body = {}) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return { success: false, msg: '请输入想咨询的问题', ...buildSafetyMeta() };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { success: false, msg: `问题不能超过 ${MAX_MESSAGE_LENGTH} 个字符`, ...buildSafetyMeta() };
  }

  // 旧硬件页面仍可走原有只读规则链；v0.1 默认助手走 PlantPet 会话与记忆链。
  if (body.logicalKey && !body.plantPetId && !body.sessionId) {
    return handleLegacyAgentChat(db, openid, body);
  }

  const plantPetId = Number(body.plantPetId) || 0;
  const sessionId = body.sessionId || `assistant_${plantPetId || 'global'}`;
  if (plantPetId && !await hasOwnedPlantPet(db, openid, plantPetId)) {
    const error = new Error('植宠不存在或无权访问');
    error.statusCode = 404;
    throw error;
  }
  const conversation = await getOrCreateConversation(db, openid, sessionId, plantPetId || null);
  if (body.clientTurnKey) {
    const replay = await findCommittedExchangeByKey(db, openid, body.clientTurnKey);
    if (replay) {
      if (Number(replay.conversationId) !== Number(conversation.id)) {
        const error = new Error('clientTurnKey 已用于其他会话');
        error.statusCode = 409;
        throw error;
      }
      return {
        ...(replay.response || {}),
        success: true,
        sessionId: conversation.session_key,
        conversationId: Number(conversation.id) || 0,
        userMessageId: Number(replay.userMessageId) || 0,
        assistantMessageId: Number(replay.assistantMessageId) || 0,
        proposals: Array.isArray(replay.proposals) ? replay.proposals : [],
        idempotent: true
      };
    }
  }
  const quotaResult = await consumeQuota(db, openid, 'chat');

  const preliminaryScope = classifyAssistantScope(message);
  const sessionContext = require('../lib/conversation-context').getTurnContext();
  if (!sessionContext && ['personal_identity', 'nickname_preference'].includes(preliminaryScope.reason)) {
    let displayProfile = { available: true, displayName: '' };
    if (preliminaryScope.reason === 'personal_identity') {
      try {
        displayProfile = await loadUserDisplayProfile(db, openid);
      } catch (err) {
        console.warn('[chat] user display profile unavailable:', err.message);
        displayProfile = { available: false, displayName: '' };
      }
    }
    const safetyMeta = buildSafetyMeta();
    const response = buildUserIdentityResponse(displayProfile, safetyMeta, preliminaryScope);
    if (preliminaryScope.reason === 'personal_identity') {
      const confirmedPreferences = await listMemories(db, openid, null);
      const preferredName = confirmedPreferences.find((item) =>
        item.userConfirmed === true
        && item.type === 'user_preference'
        && /preferred_name|nickname|称呼/.test(`${item.key} ${item.content}`)
      );
      if (preferredName) {
        const rememberedName = String(preferredName.content || '')
          .replace(/^用户希望被称呼为/, '')
          .replace(/^希望被称呼为/, '')
          .trim();
        if (rememberedName) {
          response.summary = `我记得你希望我称呼你「${rememberedName}」。`;
          response.diagnosis = '这是你明确确认过的跨会话称呼偏好，不代表我知道你的真实身份。你可以在 NOVA 记忆页随时修改或删除；也不要在聊天中提供手机号、证件号或密码。';
          response.sources = [{ type: 'structured_memory', title: '用户确认偏好', source: preferredName.key }];
        }
      }
    }
    const proposalDrafts = prepareMemoryProposalDraft(message, response);
    const assistantText = buildAssistantText(response);
    const exchange = await saveExchange(db, openid, conversation.id, message, assistantText, response, {
      proposals: proposalDrafts,
      clientTurnKey: body.clientTurnKey || ''
    });
    return {
      ...(exchange.response || response),
      sessionId: conversation.session_key,
      conversationId: Number(conversation.id) || 0,
      userMessageId: exchange.userMessageId,
      assistantMessageId: exchange.assistantMessageId,
      memoryUpdated: false,
      quota: quotaResult.usage
    };
  }
  const history = await listRecentMessages(db, openid, conversation.id);
  const petContext = await loadPlantPetContext(db, openid, plantPetId);
  const memories = (await listMemories(db, openid, plantPetId || null))
    .filter(item => !sessionContext || !['user_preference', 'ai_summary'].includes(item.type));
  const intent = inferIntent(message);
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const selectedFunction = normalizeSelectedFunction(context.selectedFunction);
  const knowledgeContextText = buildKnowledgeContextText(context.knowledgeContext || context.article || {});
  const mentionedPlants = await findMentionedPlantProfiles(db, message, 3);
  const mentionedPlant = mentionedPlants[0] || null;
  const scope = classifyAssistantScope(message, {
    mentionedPlantCount: mentionedPlants.length,
    hasPlantPet: Boolean(petContext.pet),
    hasKnowledgeContext: Boolean(knowledgeContextText),
    history
  });
  const safetyMeta = buildSafetyMeta();
  if (sessionContext && (scope.status === 'out_of_scope' || ['social', 'personal_identity', 'nickname_preference'].includes(scope.reason))) {
    scope.status = 'deferred';
    scope.reason = 'contextual_dialogue';
  }
  if (!sessionContext && scope.reason === 'social') {
    const response = buildSocialResponse(message, safetyMeta);
    const assistantText = buildAssistantText(response);
    const exchange = await saveExchange(db, openid, conversation.id, message, assistantText, response, {
      clientTurnKey: body.clientTurnKey || '',
      proposals: []
    });
    return {
      ...(exchange.response || response),
      sessionId: conversation.session_key,
      conversationId: Number(conversation.id) || 0,
      userMessageId: exchange.userMessageId,
      assistantMessageId: exchange.assistantMessageId,
      memoryUpdated: false,
      quota: quotaResult.usage
    };
  }
  if (scope.status === 'out_of_scope') {
    const response = buildOutOfScopeResponse(message, safetyMeta, scope);
    const assistantText = buildAssistantText(response);
    const exchange = await saveExchange(db, openid, conversation.id, message, assistantText, response, {
      clientTurnKey: body.clientTurnKey || '',
      proposals: []
    });
    return {
      ...(exchange.response || response),
      sessionId: conversation.session_key,
      conversationId: Number(conversation.id) || 0,
      userMessageId: exchange.userMessageId,
      assistantMessageId: exchange.assistantMessageId,
      memoryUpdated: false,
      quota: quotaResult.usage
    };
  }
  if (scope.status === 'deferred') {
    let response = null;
    let rawUsage = null;
    try {
      const llmResult = await chatWithLlm({
        message,
        contextText: sessionContext
          ? '结合提供的会话原话与摘要自然回答。昵称和关系互动属于正常交流，不要机械拒绝。不要编造未提供的业务事实，也不能声称已创建任务或修改档案。'
          : buildDeferredScopeInstruction(scope),
        history: []
      });
      if (llmResult.enabled && llmResult.content) {
        rawUsage = llmResult.rawUsage;
        response = {
          ...buildLlmResponse(llmResult.content, 'general', safetyMeta, rawUsage, []),
          scope,
          taskSuggestions: []
        };
      }
    } catch (err) {
      console.warn('[chat] semantic fallback failed:', err.message);
    }
    response = response || buildDeferredFallbackResponse(safetyMeta, scope);
    const assistantText = buildAssistantText(response);
    const exchange = await saveExchange(db, openid, conversation.id, message, assistantText, response, {
      clientTurnKey: body.clientTurnKey || '',
      proposals: []
    });
    const usage = rawUsage
      ? await recordTokenUsage(db, openid, rawUsage)
      : quotaResult.usage;
    return {
      ...(exchange.response || response),
      sessionId: conversation.session_key,
      conversationId: Number(conversation.id) || 0,
      userMessageId: exchange.userMessageId,
      assistantMessageId: exchange.assistantMessageId,
      memoryUpdated: false,
      quota: usage
    };
  }
  const topicMismatch = buildPlantTopicMismatch(petContext.pet, mentionedPlant);
  const knowledgePlantType = mentionedPlant?.name || petContext.pet?.speciesName || context.plantType || '';
  const knowledgeBundle = await searchKnowledgeBundle(db, {
    query: message,
    plantType: knowledgePlantType,
    plantLibraryId: topicMismatch ? 0 : context.plantLibraryId || 0,
    knowledgeLimit: 3
  });
  const taskSuggestions = buildTaskSuggestions(message, plantPetId, { blocked: Boolean(topicMismatch) });
  const modelHistory = filterModelHistory(history);
  const plantContextText = buildPlantContextText(petContext.pet, petContext.facts, memories, message);
  const modelContextText = [
    plantContextText,
    knowledgeContextText,
    knowledgeBundle.contextText
  ].filter(Boolean).join('\n\n');

  let response;
  let rawUsage = null;
  const memoryRecall = !sessionContext && /(记得|记住|上次|之前|历史)/.test(message)
    ? buildMemoryRecall(memories, petContext.pet, message)
    : null;
  if (topicMismatch) {
    let topicResponse = null;
    const mismatchInstruction = buildPlantTopicMismatchInstruction(topicMismatch, message);
    try {
      const llmResult = await chatWithLlm({
        message,
        contextText: [mismatchInstruction, knowledgeBundle.contextText].filter(Boolean).join('\n\n'),
        history: []
      });
      if (llmResult.enabled && llmResult.content) {
        rawUsage = llmResult.rawUsage;
        topicResponse = buildLlmResponse(
          llmResult.content,
          intent,
          safetyMeta,
          llmResult.rawUsage,
          knowledgeBundle.hits.map(mapKnowledgeSource)
        );
      }
    } catch (err) {
      console.warn('[chat] topic response failed:', err.message);
    }
    response = applyPlantTopicMismatch(
      { ...(topicResponse || buildKnowledgeFallbackResponse(knowledgeBundle, intent, safetyMeta)), taskSuggestions },
      topicMismatch,
      {
        modelGeneratedBoundary: Boolean(topicResponse),
        taskRequested: hasExplicitTaskIntent(message)
      }
    );
  } else if (memoryRecall) {
    response = {
      success: true,
      intent: { type: 'memory', name: 'memory' },
      ...memoryRecall,
      suggestions: ['查看或修改 AI 记忆', '根据这些记录给我养护建议'],
      followUpQuestions: ['你还记得哪些养护记录？'],
      riskLevel: 'low',
      taskSuggestions,
      ...safetyMeta
    };
  } else if (intent === 'knowledge' && !knowledgeBundle.hits.length && !knowledgeContextText) {
    response = {
      ...buildKnowledgeFallbackResponse(knowledgeBundle, intent, safetyMeta),
      taskSuggestions
    };
  } else {
    let modelUnavailable = !isLlmEnabled();
    try {
      const llmResult = await chatWithLlm({
        message,
        contextText: modelContextText,
        history: modelHistory
      });
      if (llmResult.enabled && llmResult.content) {
        rawUsage = llmResult.rawUsage;
        response = {
          ...buildLlmResponse(
            llmResult.content,
            intent,
            safetyMeta,
            llmResult.rawUsage,
            knowledgeBundle.hits.map(mapKnowledgeSource)
          ),
          taskSuggestions
        };
      }
    } catch (err) {
      modelUnavailable = true;
      console.warn('[chat] provider request failed:', err.message);
    }

    if (!response && knowledgeBundle.hits.length) {
      response = { ...buildKnowledgeFallbackResponse(knowledgeBundle, intent, safetyMeta), taskSuggestions };
      if (modelUnavailable) response = markModelUnavailable(response);
    }
    if (!response) {
      response = {
        success: true,
        intent: { type: intent, name: intent },
        summary: isLlmEnabled()
          ? '这次模型请求没有成功，我不能把未生成的内容伪装成答案。'
          : 'NOVA 对话模型当前未启用。',
        diagnosis: petContext.pet
          ? `你仍可手动维护 ${petContext.pet.nickname} 的档案、任务和成长日记；知识库有可靠依据时我也会继续展示来源。`
          : '手动建档、任务、日记和症状记录仍可正常使用。',
        facts: [],
        suggestions: ['查看植物知识库', '手动建立养护任务', '稍后重试'],
        followUpQuestions: ['这盆植物是什么品种？'],
        riskLevel: 'low',
        sources: [{ type: 'model_unavailable', title: '模型暂不可用' }],
        taskSuggestions,
        ...safetyMeta
      };
    }
  }

  response = {
    ...response,
    scope,
    ...(selectedFunction ? { selectedFunction } : {})
  };
  const proposalDrafts = prepareTaskProposalDrafts(response.taskSuggestions);
  const assistantText = buildAssistantText(response);
  const exchange = await saveExchange(db, openid, conversation.id, message, assistantText, response, {
    proposals: proposalDrafts,
    clientTurnKey: body.clientTurnKey || ''
  });
  const usage = rawUsage
    ? await recordTokenUsage(db, openid, rawUsage)
    : quotaResult.usage;
  return {
    ...(exchange.response || response),
    sessionId: conversation.session_key,
    conversationId: Number(conversation.id) || 0,
    userMessageId: exchange.userMessageId,
    assistantMessageId: exchange.assistantMessageId,
    memoryUpdated: false,
    quota: usage
  };
}

async function handleAgentChat(db, openid, body = {}) {
  const rollout = await tryHandleControlledRollout({ db, openid, body });
  if (rollout.accepted) return rollout.response;

  let shadowHandle = null;
  if (!rollout.selected) {
    try {
      shadowHandle = startAgentShadow({ db, openid, body });
    } catch (error) {
      console.warn('[agent-shadow] start failed');
    }
  }

  try {
    const response = await handleCurrentAgentChat(db, openid, body);
    if (shadowHandle) await completeAgentShadow(shadowHandle, response);
    return response;
  } catch (error) {
    if (shadowHandle) await completeAgentShadow(shadowHandle, null, error);
    throw error;
  }
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  handleAgentChat,
  handleLegacyAgentChat,
  buildTaskSuggestions,
  buildPlantTopicMismatch,
  buildPlantTopicMismatchInstruction,
  applyPlantTopicMismatch,
  buildMemoryRecall,
  markModelUnavailable,
  normalizeSelectedFunction,
  inferIntent,
  normalizeLogicalKey
};
