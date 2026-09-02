const { buildSafetyMeta } = require('../lib/safety');
const { chatWithLlm, isLlmEnabled } = require('../lib/llmClient');
const { getDeviceSnapshot, getHistorySummary } = require('../tools/device');
const { buildTrendSentence, computeRiskFacts } = require('../rules/plantDiagnosis');
const { searchKnowledgeBundle } = require('../rag/knowledgeSearch');

const MAX_MESSAGE_LENGTH = 300;

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
      ? `我先根据已有植物资料和字段知识帮你整理了一版答案。`
      : '我暂时没有命中明确的植物知识片段，但可以继续从养护和设备角度帮你分析。',
    diagnosis: firstHit
      ? `${firstHit.content}${otherTitles.length ? `\n\n本轮还参考了：${otherTitles.join('、')}。` : ''}`
      : '你可以告诉我具体植物名、字段名，或者当前设备绑定的植物类型，这样我能回答得更准。',
    facts: [],
    suggestions: ['我的植物现在状态怎么样？', '我现在要不要浇水？', '最近湿度变化如何？'],
    followUpQuestions: ['这类植物平时怎么浇水？', '这个字段是什么意思？'],
    riskLevel: 'low',
    sources: bundle.hits.map((item) => ({
      type: item.type,
      title: item.title,
      source: item.source
    })),
    ...safetyMeta
  };
}

async function handleAgentChat(db, openid, body) {
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
            knowledgeBundle.hits.map((item) => ({
              type: item.type,
              title: item.title,
              source: item.source
            }))
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
      deviceKnowledgeBundle.hits.map((item) => ({
        type: item.type,
        title: item.title,
        source: item.source
      }))
    ),
    ...safetyMeta
  };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  handleAgentChat,
  inferIntent,
  normalizeLogicalKey
};
