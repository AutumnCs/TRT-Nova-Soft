const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTaskSuggestions,
  buildMemoryRecall,
  markModelUnavailable,
  buildPlantTopicMismatch,
  buildPlantTopicMismatchInstruction,
  applyPlantTopicMismatch
} = require('../agent/chatHandler');
const { messageMentionsPlant, plantPetMatchesProfile } = require('../tools/plant');
const { selectRelevantMemories } = require('../agent/petContext');
const { buildChatMessages } = require('../lib/llmClient');
const {
  normalizeSessionKey,
  MAX_RECENT_MESSAGES,
  pruneMessages,
  saveExchange,
  markVisionExchangeSaved
} = require('../lib/agent-store');
const { getQuotaConfig, mapUsage, shanghaiDate, consumeQuota } = require('../lib/quota');
const {
  classifyAssistantScope,
  normalizeIntentText,
  filterModelHistory,
  buildSocialResponse,
  buildOutOfScopeResponse,
  buildDeferredScopeInstruction,
  buildDeferredFallbackResponse,
  hasExplicitTaskIntent
} = require('../agent/intentRouter');

test('职责域门禁在 RAG 和模型之前拒绝数学问题', () => {
  const outOfScope = classifyAssistantScope('请你证明哥德巴赫猜想', {
    hasPlantPet: true,
    history: []
  });
  assert.equal(outOfScope.status, 'out_of_scope');

  const response = buildOutOfScopeResponse('请你证明哥德巴赫猜想');
  assert.equal(response.intent.type, 'out_of_scope');
  assert.equal(response.scope.status, 'out_of_scope');
  assert.match(`${response.summary}\n${response.diagnosis}`, /哥德巴赫猜想.*植宠养护职责/);
  assert.equal(response.sources.length, 0);
  assert.equal(response.taskSuggestions.length, 0);
});

test('职责域门禁保留植物、记忆、任务、角色说明和连续追问', () => {
  assert.equal(classifyAssistantScope('月季是什么？', { mentionedPlantCount: 1 }).status, 'in_scope');
  assert.equal(classifyAssistantScope('月季怎么浇水？', { mentionedPlantCount: 1 }).status, 'in_scope');
  assert.equal(classifyAssistantScope('你记得这盆植物什么？').status, 'in_scope');
  assert.equal(classifyAssistantScope('帮我安排一个观察任务', { hasPlantPet: true }).status, 'in_scope');
  assert.equal(classifyAssistantScope('你能做什么？').status, 'in_scope');
  assert.equal(classifyAssistantScope('那多久一次？', {
    history: [{ role: 'assistant', response: { scope: { status: 'in_scope' } } }]
  }).status, 'in_scope');
});

test('规则不确定时只进入无私有上下文和无副作用的语义回退', () => {
  const uncertain = classifyAssistantScope('为什么天空是蓝的？');
  assert.equal(uncertain.status, 'deferred');

  const instruction = buildDeferredScopeInstruction(uncertain);
  assert.match(instruction, /没有提供植宠私有档案/);
  assert.match(instruction, /不要声称创建了任务或修改了记录/);

  const fallback = buildDeferredFallbackResponse({}, uncertain);
  assert.equal(fallback.scope.status, 'deferred');
  assert.equal(fallback.taskSuggestions.length, 0);
  assert.equal(fallback.sources[0].type, 'model_unavailable');
});

test('简单问候忽略中英文尾部标点并返回同一条轻量社交回复', () => {
  for (const message of ['你好', '你好?', '你好？', '你好！', '你好呀…']) {
    assert.equal(classifyAssistantScope(message).reason, 'social');
  }
  assert.equal(normalizeIntentText(' 你好？！ '), '你好');
  const plain = buildSocialResponse('你好');
  const punctuated = buildSocialResponse('你好?');
  assert.equal(plain.summary, punctuated.summary);
  assert.equal(plain.diagnosis, punctuated.diagnosis);
  assert.equal(plain.disclaimer, '');
  assert.deepEqual(plain.sources, []);
  assert.deepEqual(plain.taskSuggestions, []);
});

test('域外问答保留原始记录，但不会作为后续模型生成上下文', () => {
  const history = [
    { id: 1, role: 'user', content: '请证明哥德巴赫猜想' },
    { id: 2, role: 'assistant', content: '这不在职责内', response: { scope: { status: 'out_of_scope' } } },
    { id: 3, role: 'user', content: '月季怎么浇水？' },
    { id: 4, role: 'assistant', content: '先看盆土', response: { scope: { status: 'in_scope' } } },
    { id: 5, role: 'user', content: '我是谁？' },
    { id: 6, role: 'assistant', content: '当前账号昵称是小叶子', response: { scope: { status: 'in_scope', reason: 'personal_identity' } } }
  ];
  assert.deepEqual(filterModelHistory(history).map((item) => item.id), [3, 4]);
});

test('AI 任务只生成待确认候选并携带 ai 来源', () => {
  const tasks = buildTaskSuggestions('帮我安排一个浇水任务', 9);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].plantPetId, 9);
  assert.equal(tasks[0].source, 'ai');
  assert.equal(tasks[0].taskType, 'watering');
  assert.equal(buildTaskSuggestions('聊聊天', 9).length, 0);
  assert.equal(buildTaskSuggestions('我现在要不要浇水？', 9).length, 0);
  assert.equal(buildTaskSuggestions('给我一些浇水建议', 9).length, 0);
  assert.equal(buildTaskSuggestions('帮月季安排观察任务', 9, { blocked: true }).length, 0);
});

test('任务能力只接受明确安排意图，不把养护建议词或“识别”中的“别”当成否定', () => {
  for (const text of ['帮我安排一个观察任务', '明天提醒我浇水', '创建施肥提醒', '制定一个修剪计划', '不要忘了明天提醒我浇水', '请识别这盆植物，并帮我安排一个今天观察月季花瓣的任务。']) {
    assert.equal(hasExplicitTaskIntent(text), true, text);
  }
  for (const text of ['你好', '观察一下叶片', '保持通风和光照', '我现在要不要浇水', '给我浇水建议', '只观察图片，不要创建任务', '先不安排提醒', '请勿生成养护计划']) {
    assert.equal(hasExplicitTaskIntent(text), false, text);
  }
});

test('显式植物名与当前植宠不匹配时由模型自然表述边界，代码仍阻断任务绑定', () => {
  const rose = { name: '月季', scientificName: 'Rosa', aliases: ['玫瑰', '蔷薇'] };
  const monstera = { id: 7, nickname: '客厅龟背竹', speciesName: '龟背竹' };
  assert.equal(messageMentionsPlant('月季怎么浇水？', rose), true);
  assert.equal(plantPetMatchesProfile(monstera, rose), false);
  assert.equal(plantPetMatchesProfile({ speciesName: '玫瑰' }, rose), true);
  assert.equal(plantPetMatchesProfile({ nickname: '我的月季', speciesName: '龟背竹' }, rose), false);

  const mismatch = buildPlantTopicMismatch(monstera, rose);
  const instruction = buildPlantTopicMismatchInstruction(mismatch, '月季怎么浇水，并帮我安排观察任务？');
  assert.match(instruction, /自然融入回答/);
  assert.match(instruction, /龟背竹.*月季/);
  assert.match(instruction, /用户还提到了任务/);
  const response = applyPlantTopicMismatch({
    summary: '你当前选中的是客厅龟背竹，但这次问的是月季。我先只说月季：浇水前请先摸一下盆土。',
    diagnosis: '',
    taskSuggestions: [{ plantPetId: 7 }]
  }, mismatch, { modelGeneratedBoundary: true, taskRequested: true });
  assert.match(response.summary, /龟背竹.*月季/);
  assert.doesNotMatch(`${response.summary}\n${response.diagnosis}`, /知识库|RAG|已复核发布|任务绑定/);
  assert.equal(response.taskSuggestions.length, 0);
  assert.equal(response.topicMismatch.taskBindingBlocked, true);

  const fallback = applyPlantTopicMismatch({ summary: '根据盆土干湿决定是否浇水。' }, mismatch, {
    modelGeneratedBoundary: false,
    taskRequested: true
  });
  assert.match(fallback.summary, /龟背竹.*月季.*不混用当前植宠的记录/);
  assert.match(fallback.summary, /先切换到它对应的植宠或为它建档/);
});

test('NOVA 人设要求自然转述资料并隐藏内部治理术语', () => {
  const messages = buildChatMessages({ message: '月季怎么浇水？', contextText: '月季浇水资料' });
  const prompt = messages[0].content;
  assert.match(prompt, /温和.*诚实.*陪伴感/);
  assert.match(prompt, /自然说话/);
  assert.match(prompt, /不要向用户暴露/);
  assert.match(prompt, /知识库.*RAG.*任务绑定/);
});

test('跨会话记忆回顾保留来源而不是伪装为模型事实', () => {
  const response = buildMemoryRecall([{
    type: 'user_preference',
    key: 'preferred_name',
    content: '请叫我 Dola',
    userConfirmed: true,
    sourceType: 'user_confirmation',
    sourceId: 'memory-7',
    updatedAt: '2026-08-28 10:00:00'
  }], null, '你记得我叫什么吗？');
  assert.match(response.summary, /确认或留下/);
  assert.match(response.diagnosis, /Dola/);
  assert.equal(response.sources[0].type, 'structured_memory');
  assert.equal(response.sources[0].source, 'user_confirmation:memory-7');
});

test('会话键被轻量规范化，单页为 20 轮而不是原文保留上限', () => {
  assert.equal(normalizeSessionKey('assistant plant / 7'), 'assistant_plant___7');
  assert.equal(MAX_RECENT_MESSAGES, 40);
});

test('正常对话不因轮数或时间自动删除原文和图片', async () => {
  const calls = [];
  const keepRows = Array.from({ length: MAX_RECENT_MESSAGES }, (_, index) => ({
    id: 100 - index
  }));
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT DISTINCT file_id FROM ai_message_media_links/.test(sql)) return [[]];
      if (/SELECT id(?:, conversation_id)? FROM ai_messages WHERE openid/.test(sql)) {
        return [[{ id: 12, conversation_id: 7 }]];
      }
      if (/SELECT id FROM ai_messages.*id < \?/s.test(sql)) return [[{ id: 60 }, { id: 59 }]];
      if (/SELECT id FROM ai_messages/.test(sql)) return [keepRows];
      return [{ affectedRows: 1 }];
    }
  };

  await pruneMessages(db, 'owner', 7);

  const mediaDeletes = calls.filter((item) => /DELETE FROM media_objects/.test(item.sql));
  const messageDeletes = calls.filter((item) => /DELETE FROM ai_messages/.test(item.sql));
  assert.equal(mediaDeletes.length, 0);
  assert.equal(messageDeletes.length, 0);
  assert.equal(calls.length, 0);
});

test('会话交换允许为图片用户轮次保存非媒体元数据', async () => {
  const calls = [];
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id FROM ai_messages/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };
  await saveExchange(db, 'owner', 7, '图片问题', '结构化观察', { kind: 'vision_analysis' }, {
    userResponse: {
      kind: 'vision_input',
      message: '这是什么？',
      attachment: { type: 'image', originalPersisted: false }
    }
  });
  const insert = calls.find((item) => /INSERT INTO ai_messages/.test(item.sql));
  assert.ok(insert);
  assert.match(insert.params[3], /vision_input/);
  assert.match(insert.params[7], /vision_analysis/);
  assert.doesNotMatch(JSON.stringify(insert.params), /imageBase64|tempFilePath|data:image/);
});

test('用户保存观察记录后只关联本人对应的图片会话', async () => {
  let updatedResponse = null;
  const db = {
    async execute(sql, params = []) {
      if (/FROM plant_diagnoses/.test(sql)) return [[{ media_file_id: 'local://diagnosis/rose.jpg' }]];
      if (/SELECT response_json FROM ai_messages/.test(sql)) {
        return [[{ response_json: JSON.stringify({
          kind: 'vision_analysis',
          attachment: { originalPersisted: true, mediaFileId: 'local://conversation/rose.jpg' }
        }) }]];
      }
      if (/UPDATE ai_messages SET response_json/.test(sql)) {
        updatedResponse = JSON.parse(params[0]);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }
  };
  assert.equal(await markVisionExchangeSaved(db, 'owner', 22, 9), true);
  assert.equal(updatedResponse.attachment.originalPersisted, true);
  assert.equal(updatedResponse.attachment.mediaFileId, 'local://conversation/rose.jpg');
  assert.equal(updatedResponse.attachment.diagnosisMediaFileId, 'local://diagnosis/rose.jpg');
  assert.equal(updatedResponse.attachment.diagnosisId, 9);

  const deniedDb = { async execute() { return [[]]; } };
  assert.equal(await markVisionExchangeSaved(deniedDb, 'other-owner', 22, 9), false);
});

test('Chat/Vision 对所有账户无限开放，同时保留 Asia/Shanghai 用量统计', () => {
  assert.deepEqual(getQuotaConfig(), { unlimited: true, chat: null, vision: null });
  const usage = mapUsage({ chat_count: 49, vision_count: 10, total_tokens: 123 });
  assert.equal(usage.unlimited, true);
  assert.deepEqual(usage.chat, { used: 49, limit: null, remaining: null, unlimited: true });
  assert.deepEqual(usage.vision, { used: 10, limit: null, remaining: null, unlimited: true });
  assert.equal(shanghaiDate(Date.parse('2026-08-27T16:30:00Z')), '2026-08-28');
});

test('历史计数不会阻断新请求，用量仍持续递增', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [{ affectedRows: 2 }];
      return [[{
        usage_date: '2026-08-28',
        chat_count: 501,
        vision_count: 10,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }]];
    }
  };
  const result = await consumeQuota(db, 'quota-user', 'chat', Date.parse('2026-08-28T01:00:00+08:00'));
  assert.equal(result.allowed, true);
  assert.equal(result.usage.chat.used, 501);
  assert.equal(result.usage.chat.remaining, null);
  assert.match(calls[0].sql, /chat_count = chat_count \+ 1/);
  assert.deepEqual(calls[0].params, ['quota-user', '2026-08-28']);
});

test('长期记忆只召回已确认且与问题相关的用户偏好', () => {
  const selected = selectRelevantMemories([
    { id: 1, type: 'business_event', content: '昨天完成浇水' },
    { id: 2, type: 'user_preference', content: '我习惯周末浇水', userConfirmed: true },
    { id: 3, type: 'plant_fact', content: '龟背竹摆放在客厅' },
    { id: 4, type: 'business_event', content: '昨天完成浇水' },
    { id: 5, type: 'ai_summary', content: '旧版摘要' }
  ], '周末应该怎么浇水', 3);
  assert.deepEqual(selected.map((item) => item.id), [2]);
  assert.deepEqual(selectRelevantMemories([
    { id: 2, type: 'user_preference', content: '我习惯周末浇水', userConfirmed: true }
  ], '哥德巴赫猜想是什么', 3), []);
});

test('Chat 模型失败但知识可用时仍显式标记模型状态', () => {
  const response = markModelUnavailable({
    summary: '我先根据已复核资料整理。',
    sources: [{ type: 'knowledge_article', title: '月季养护' }]
  });
  assert.match(response.summary, /模型暂不可用/);
  assert.equal(response.sources[0].type, 'model_unavailable');
  assert.equal(response.sources[1].title, '月季养护');
});
