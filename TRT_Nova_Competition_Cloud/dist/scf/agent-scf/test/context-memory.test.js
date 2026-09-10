const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { turnStorage, getTurnContext, selectRecent, validateFacts, sensitive, withHistoryTool } = require('../lib/conversation-context');
const { normalizeHistoryMessages, chatWithLlm } = require('../lib/llmClient');
const { getAllowedToolNames, getRequiredReadTools } = require('../runtime/capabilityPolicy');
const { PlantPetRuntime } = require('../runtime/plantPetRuntime');

test('上下文保留完整轮次和长消息，不沿用旧的逐句1600字截断', () => {
  const rows = [{ id: 1, role: 'user', content: '前'.repeat(1800) + '请叫我dola' }, { id: 2, role: 'assistant', content: '好' }];
  turnStorage.run({ history: rows }, () => assert.match(normalizeHistoryMessages([])[0].content, /dola$/));
  assert.deepEqual(selectRecent(rows, 100), rows);
  assert.equal(selectRecent([...rows, ...rows], 2000).length, 2);
});

test('上下文隔离于请求，不让同时对话共享状态', async () => {
  const found = await Promise.all(['a', 'b'].map(owner => turnStorage.run({ owner }, async () => {
    await new Promise(resolve => setImmediate(resolve)); return getTurnContext().owner;
  })));
  assert.deepEqual(found, ['a', 'b']); assert.equal(getTurnContext(), null);
});

test('自动摘要必须有本轮原话依据，只接收低风险类别', () => {
  const source = '以后叫我dola吧。我喜欢月季。';
  const base = { key: 'preferred_name', category: 'nickname', content: '喜欢被叫作dola', quote: '以后叫我dola吧' };
  assert.equal(validateFacts([base], source).length, 1);
  assert.equal(validateFacts([{ ...base, quote: '没有说过' }], source).length, 0);
  assert.equal(validateFacts([{ ...base, category: 'diagnosis' }], source).length, 0);
  assert.equal(validateFacts([{ ...base, content: '手机号13800138000' }], source).length, 0);
  assert.equal(validateFacts([{ ...base, key: 'create_task' }], source).length, 0);
  assert.equal(sensitive('密码是 hello123'), true);
  assert.equal(sensitive('我习惯周末检查盆土'), false);
});

test('新上下文模式不再强制昵称候选，但保留任务提案确认', () => {
  turnStorage.run({ history: [] }, () => {
    assert.ok(!getAllowedToolNames({ message: '以后叫我dola吧' }).includes('propose_memory_candidate'));
    assert.ok(!getRequiredReadTools({ message: '我是谁' }).some(t => t.name === 'recall_relevant_memories'));
    assert.ok(getRequiredReadTools({ message: '帮我安排明天观察任务' }).some(t => t.name === 'propose_care_task'));
  });
});

test('历史检索不能由模型更换账号或会话，LIKE通配符按字面查找', async () => {
  let query;
  const tools = withHistoryTool({ definitions: [], execute() { throw new Error('unexpected'); } }, {
    openid: 'owner', conversationId: 17, db: { async execute(sql, params) { query = { sql, params }; return [[]]; } }
  });
  await tools.execute({ function: { name: 'search_session_history', arguments: JSON.stringify({ query: '100%_x', beforeMessageId: 99 }) } });
  assert.deepEqual(query.params, ['owner', 17, '%100!%!_x%', 99]);
  await assert.rejects(tools.execute({ function: { name: 'search_session_history', arguments: '{"query":"x","openid":"other"}' } }));
});

test('真实运行时的模型输入确实带上本会话历史和跨会话摘要', async () => {
  let messages;
  await turnStorage.run({ text: '已开启跨会话摘要：偏好简短回复', history: [{ role: 'user', content: '叫我dola' }, { role: 'assistant', content: '好的' }] }, async () => {
    const runtime = new PlantPetRuntime({
      model: { isEnabled: () => true, async next(input) { messages = input.messages; return { content: 'dola你好', toolCalls: [] }; } },
      tools: { definitions: [], async execute() { throw new Error('unexpected'); } }
    });
    const result = await runtime.run({ message: '你该怎么称呼我？' });
    assert.equal(result.finalContent, 'dola你好');
  });
  assert.ok(messages.some(m => /叫我dola/.test(m.content)));
  assert.ok(messages.some(m => /偏好简短回复/.test(m.content)));
});

test('文档和普通Chat使用的DeepSeek适配禁用默认思考，并区分空正文与未启用', async () => {
  const backup = { ...process.env };
  let payload;
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      payload = JSON.parse(raw); res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    Object.assign(process.env, { LLM_API_ENABLED: 'true', LLM_API_BASE_URL: 'http://127.0.0.1:' + server.address().port, LLM_API_KEY: 'test-only', LLM_MODEL: 'deepseek-v4-flash' });
    const result = await chatWithLlm({ message: '文档内容', maxTokens: 1600 });
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(payload.max_tokens, 1600);
    assert.equal(result.enabled, true); assert.equal(result.finishReason, 'length'); assert.equal(result.content, '');
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in backup)) delete process.env[key];
    Object.assign(process.env, backup);
  }
});
