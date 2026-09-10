const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const productContract = require('../../../../evals/m7-agent/product-contract.json');
const {
  TOOL_META,
  READ_ONLY_TOOL_DEFINITIONS,
  PROPOSAL_TOOL_DEFINITIONS,
  createReadOnlyToolExecutor
} = require('../runtime/toolRegistry');
const { PlantPetRuntime } = require('../runtime/plantPetRuntime');
const { createOpenAiCompatibleShadowModel } = require('../runtime/modelAdapter');
const {
  getRequiredReadTools,
  requiresPublishedKnowledge
} = require('../runtime/capabilityPolicy');
const {
  isShadowEnabled,
  fingerprintTurn,
  shouldSample,
  startAgentShadow,
  completeAgentShadow
} = require('../runtime/shadowRuntime');
const { requiredLegacyCapability } = require('../runtime/rolloutRuntime');

function toolCall(name, args = {}, id = `call-${name}`) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

function scriptedModel(decisions = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    isEnabled: () => true,
    async next(input) {
      calls.push(JSON.parse(JSON.stringify(input)));
      return decisions[index++] || { enabled: true, content: '完成', toolCalls: [] };
    }
  };
}

function createScopedExecutor(overrides = {}) {
  return createReadOnlyToolExecutor({
    db: overrides.db || { execute: async () => [[]] },
    openid: overrides.openid || 'owner-a',
    selectedPlantPetId: overrides.selectedPlantPetId || 7,
    defaultQuery: overrides.defaultQuery || '月季怎么浇水？',
    defaultPlantType: overrides.defaultPlantType || '月季',
    profileReader: overrides.profileReader || (async () => ({ available: true, displayName: '小叶' })),
    plantReader: overrides.plantReader || (async () => ({
      id: 7,
      nickname: '小月',
      speciesName: '月季',
      status: 'active'
    })),
    knowledgeSearcher: overrides.knowledgeSearcher || (async () => ({
      hits: [{
        type: 'knowledge_article',
        title: '月季浇水',
        content: '观察盆土后浇透并排掉积水。',
        sourcePublisher: 'Example Extension',
        sourceUrl: 'https://example.test/rose',
        reviewedAt: '2026-09-01'
      }]
    }))
  });
}

test('Phase 2 read-only surface remains three tools while Phase 4/5 tools are proposal-only or read-only', () => {
  assert.deepEqual(READ_ONLY_TOOL_DEFINITIONS.map((item) => item.function.name).sort(), [
    'get_account_nickname',
    'get_selected_plant',
    'search_published_knowledge'
  ]);
  assert.equal(READ_ONLY_TOOL_DEFINITIONS.length, 3);
  assert.deepEqual(PROPOSAL_TOOL_DEFINITIONS.map((item) => item.function.name).sort(), [
    'propose_care_task',
    'propose_memory_candidate',
    'recall_relevant_memories'
  ]);
  assert.equal(TOOL_META.recall_relevant_memories.sideEffect, 'none');
  assert.equal(TOOL_META.propose_memory_candidate.sideEffect, 'proposal_only');
  assert.equal(TOOL_META.propose_care_task.sideEffect, 'proposal_only');
  const exposedProperties = READ_ONLY_TOOL_DEFINITIONS.flatMap((item) =>
    Object.keys(item.function.parameters.properties || {})
  );
  assert.ok(!exposedProperties.some((key) => /openid|plantPetId|executeSql|createTask|controlDevice/i.test(key)));
});

test('selected plant tool binds the authenticated owner and selected id in application scope', async () => {
  const calls = [];
  const tools = createScopedExecutor({
    openid: 'owner-a',
    selectedPlantPetId: 91,
    plantReader: async (db, openid, plantPetId) => {
      calls.push({ openid, plantPetId });
      return null;
    }
  });

  const result = await tools.execute(toolCall('get_selected_plant'));
  assert.deepEqual(calls, [{ openid: 'owner-a', plantPetId: 91 }]);
  assert.deepEqual(result, { selected: true, found: false, plant: null });

  await assert.rejects(
    tools.execute(toolCall('get_selected_plant', { plantPetId: 92, openid: 'owner-b' })),
    (error) => error.code === 'TOOL_ARGS_FORBIDDEN'
  );
  assert.equal(calls.length, 1);
});

test('default selected-plant reader performs an owner-scoped SELECT and returns no cross-account row', async () => {
  const statements = [];
  const db = {
    async execute(sql, params) {
      statements.push({ sql, params });
      return [[]];
    }
  };
  const tools = createScopedExecutor({
    db,
    openid: 'owner-a',
    selectedPlantPetId: 91,
    plantReader: undefined
  });
  // Remove the helper's injected reader so this test exercises loadOwnedPlantPet.
  const realTools = createReadOnlyToolExecutor({
    db,
    openid: 'owner-a',
    selectedPlantPetId: 91,
    defaultQuery: '你好',
    knowledgeSearcher: async () => ({ hits: [] })
  });
  const result = await realTools.execute(toolCall('get_selected_plant'));
  assert.equal(tools.metadata.get_selected_plant.sideEffect, 'none');
  assert.deepEqual(result, { selected: true, found: false, plant: null });
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /^\s*SELECT\b/i);
  assert.match(statements[0].sql, /WHERE pp\.id = \? AND pp\.openid = \?/i);
  assert.deepEqual(statements[0].params, [91, 'owner-a']);
});

test('published-knowledge tool uses only published rows and preserves readable provenance', async () => {
  const statements = [];
  const db = {
    async query(sql) {
      statements.push(sql);
      assert.match(sql, /^\s*SELECT\b/i);
      assert.match(sql, /content_status = 'published'/i);
      return [[]];
    },
    async execute(sql) {
      statements.push(sql);
      assert.match(sql, /^\s*SELECT\b/i);
      assert.match(sql, /WHERE status = 'published'/i);
      return [[{
        id: 2,
        slug: 'rose-watering',
        title: '月季浇水',
        summary: '观察盆土',
        content: '浇透后排掉积水。',
        category: 'plant-care',
        tags_json: '["月季","浇水"]',
        plant_types_json: '["月季"]',
        source_title: 'Rosa',
        source_publisher: 'NC State Extension',
        source_url: 'https://example.test/rose',
        source_id: 'NCSU-ROSA',
        content_updated_at: '2026-09-01',
        reviewed_at: '2026-09-01 12:00:00',
        reviewed_by: 'reviewer',
        status: 'published',
        sort_order: 1
      }]];
    }
  };
  const tools = createReadOnlyToolExecutor({
    db,
    openid: 'owner-a',
    defaultQuery: '月季怎么浇水？',
    defaultPlantType: '月季'
  });
  const result = await tools.execute(toolCall('search_published_knowledge'));
  assert.equal(result.unknown, false);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].sourcePublisher, 'NC State Extension');
  assert.equal(statements.length, 2);
});

test('PlantPetRuntime lets the model read a nickname without unrelated knowledge preflight', async () => {
  const model = scriptedModel([
    { enabled: true, content: '', toolCalls: [toolCall('get_account_nickname')] },
    { enabled: true, content: '我可以按账号昵称称呼你。', toolCalls: [] }
  ]);
  const runtime = new PlantPetRuntime({ model, tools: createScopedExecutor(), timeoutMs: 2000 });
  const result = await runtime.run({ message: '请读取当前账号昵称', plantType: '', selectedPlantPetId: 7 });

  assert.equal(result.status, 'completed');
  assert.equal(result.finalContent, '我可以按账号昵称称呼你。');
  assert.deepEqual(result.toolTrace.map((item) => [item.toolName, item.source, item.outcome]), [
    ['get_account_nickname', 'model', 'success']
  ]);
  assert.deepEqual(result.events.map((item) => item.sequence), Array.from({ length: result.events.length }, (_, index) => index + 1));
  assert.equal(model.calls.length, 2);
  assert.ok(!model.calls[0].messages.some((item) =>
    item.role === 'user' && String(item.content).includes('<policy_read_results>')
  ));
  assert.ok(!model.calls[0].messages.some((item) => item.role === 'tool'));
  assert.ok(!model.calls[0].messages.some((item) =>
    item.role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.some((call) => String(call.id).startsWith('shadow-policy-'))
  ));
});

test('invalid model tool arguments are blocked before the scoped reader runs', async () => {
  let plantReads = 0;
  const tools = createScopedExecutor({
    plantReader: async () => {
      plantReads += 1;
      return null;
    }
  });
  const model = scriptedModel([
    { enabled: true, content: '', toolCalls: [toolCall('get_selected_plant', { plantPetId: 999 })] },
    { enabled: true, content: '无法读取任意植宠。', toolCalls: [] }
  ]);
  const result = await new PlantPetRuntime({ model, tools, timeoutMs: 2000 }).run({
    message: '读取别人的植宠',
    plantType: '',
    selectedPlantPetId: 7
  });

  assert.equal(plantReads, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.toolTrace[1].outcome, 'blocked_or_failed');
  assert.equal(result.toolTrace[1].errorCode, 'TOOL_ARGS_FORBIDDEN');
});

test('narrow capability policy recalls confirmed preference before account nickname for identity queries', () => {
  assert.deepEqual(
    getRequiredReadTools({ message: '我是谁？' }).map((item) => item.name),
    ['recall_relevant_memories', 'get_account_nickname']
  );
  assert.deepEqual(
    getRequiredReadTools({ message: '月季怎么浇水？' }).map((item) => item.name),
    ['search_published_knowledge']
  );
  assert.deepEqual(
    getRequiredReadTools({ message: '你好' }).map((item) => item.name),
    []
  );
  assert.equal(requiresPublishedKnowledge({ message: '月季是什么？' }), true);
  assert.equal(requiresPublishedKnowledge({ message: '1+2是多少朵玫瑰花呢' }), false);
  assert.equal(requiresPublishedKnowledge({ message: '把浇水翻译成英文' }), false);
  assert.equal(requiresPublishedKnowledge({ message: '1+1等于几' }), false);
});

test('runtime projects existing branch history and returns aggregate usage plus readable knowledge hits', async () => {
  const model = scriptedModel([{
    enabled: true,
    content: '浇水前先看盆土，资料来源会随回答展示。',
    toolCalls: [],
    rawUsage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  }]);
  const result = await new PlantPetRuntime({
    model,
    tools: createScopedExecutor(),
    timeoutMs: 2000
  }).run({
    message: '月季怎么浇水？',
    history: [
      { role: 'user', content: '我把它放在阳台。' },
      { role: 'assistant', content: '我记下本轮背景了。' }
    ]
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.rawUsage, { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 });
  assert.equal(result.knowledgeHits.length, 1);
  assert.equal(result.knowledgeHits[0].sourcePublisher, 'Example Extension');
  assert.ok(model.calls[0].messages.some((item) => item.content === '我把它放在阳台。'));
  assert.ok(model.calls[0].messages.some((item) =>
    item.role === 'user' && String(item.content).includes('<policy_read_results>')
  ));
  assert.ok(model.calls[0].messages.some((item) => item.content === '我记下本轮背景了。'));
});

test('all non-proposal knowledge-contract cases execute published-knowledge preflight without writes', async () => {
  const cases = productContract.cases.filter((item) =>
    (item.target.requiredTools || []).includes('search_published_knowledge')
    && !requiredLegacyCapability({ context: item.context || {} }, item.query)
    && !/(?:任务|提醒|日程|计划|安排|打卡)/.test(item.query)
  );
  const queries = [];
  for (const item of cases) {
    const tools = createScopedExecutor({
      defaultQuery: item.query,
      knowledgeSearcher: async (db, options) => {
        queries.push(options.query);
        return { hits: [] };
      }
    });
    const result = await new PlantPetRuntime({
      model: scriptedModel([{ enabled: true, content: '资料不足。', toolCalls: [] }]),
      tools,
      timeoutMs: 2000
    }).run({ message: item.query, plantType: '', selectedPlantPetId: 7 });
    assert.equal(result.toolTrace[0].toolName, 'search_published_knowledge');
    assert.equal(result.toolTrace[0].source, 'policy_preflight');
  }
  assert.equal(queries.length, cases.length);
  assert.deepEqual(queries, cases.map((item) => item.query));
});

test('shadow comparison report excludes raw query, openid, nickname, plant content and model draft', async () => {
  const rawValues = ['我的身份证号是123', 'owner-secret', '昵称秘密', '植宠秘密', '模型草稿秘密'];
  const reports = [];
  const body = { message: rawValues[0], sessionId: 'private-session', plantPetId: 7 };
  const model = scriptedModel([{ enabled: true, content: rawValues[4], toolCalls: [] }]);
  const tools = createScopedExecutor({
    openid: rawValues[1],
    profileReader: async () => ({ available: true, displayName: rawValues[2] }),
    plantReader: async () => ({ id: 7, nickname: rawValues[3], speciesName: '月季' }),
    knowledgeSearcher: async () => ({ hits: [] })
  });
  const handle = startAgentShadow({
    force: true,
    body,
    db: {},
    openid: rawValues[1],
    model,
    tools,
    recorder: (report) => reports.push(report)
  });
  const legacyResponse = {
    success: true,
    summary: rawValues[0],
    intent: { type: 'general' },
    sources: [],
    taskSuggestions: []
  };
  const before = JSON.parse(JSON.stringify(legacyResponse));
  const report = await completeAgentShadow(handle, legacyResponse);

  assert.deepEqual(legacyResponse, before);
  assert.equal(reports.length, 1);
  assert.equal(report.queryFingerprint.length, 16);
  const serialized = JSON.stringify(report);
  rawValues.forEach((value) => assert.doesNotMatch(serialized, new RegExp(value)));
  assert.doesNotMatch(serialized, /private-session/);
});

test('shadow feature flag is default-off and deterministic sampling uses only the fingerprint', () => {
  assert.equal(isShadowEnabled({}), false);
  assert.equal(isShadowEnabled({ AGENT_SHADOW_ENABLED: 'true' }), true);
  const fingerprint = fingerprintTurn({ sessionKey: 's', message: '你好' }, 'test-secret');
  assert.equal(fingerprint, fingerprintTurn({ sessionKey: 's', message: '你好' }, 'test-secret'));
  assert.equal(shouldSample(fingerprint, { AGENT_SHADOW_SAMPLE_RATE: '0' }), false);
  assert.equal(shouldSample(fingerprint, { AGENT_SHADOW_SAMPLE_RATE: '1' }), true);
  assert.throws(
    () => fingerprintTurn({ sessionKey: 's', message: '你好' }),
    (error) => error.code === 'SHADOW_FINGERPRINT_KEY_REQUIRED'
  );
});

test('OpenAI-compatible shadow adapter sends tool schemas and parses tool calls', async (t) => {
  let received = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: '内部推理占位',
            tool_calls: [{
              id: 'provider-call-1',
              type: 'function',
              function: { name: 'get_account_nickname', arguments: '{}' }
            }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 3 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const model = createOpenAiCompatibleShadowModel({
    enabled: true,
    baseUrl: `http://127.0.0.1:${address.port}`,
    path: '/chat/completions',
    apiKey: 'test-only',
    model: 'deepseek-v4-flash',
    timeoutMs: 2000
  });
  const decision = await model.next({
    messages: [{ role: 'user', content: '我是谁？' }],
    tools: READ_ONLY_TOOL_DEFINITIONS
  });
  assert.equal(received.tool_choice, 'auto');
  assert.equal(received.tools.length, 3);
  assert.deepEqual(received.thinking, { type: 'disabled' });
  assert.equal(decision.toolCalls[0].function.name, 'get_account_nickname');
  assert.equal(decision.reasoningContent, '内部推理占位');
  assert.deepEqual(decision.rawUsage, { prompt_tokens: 10, completion_tokens: 3 });
});

test('runtime retries one empty provider completion instead of silently accepting an empty answer', async () => {
  const model = scriptedModel([
    { enabled: true, content: '', reasoningContent: '不可展示的内部推理', toolCalls: [] },
    { enabled: true, content: '我记得你希望我称呼你为蒲公英；这只是你确认的称呼偏好，不代表真实身份。也请不要在聊天中提供手机号、证件号或密码。', toolCalls: [] }
  ]);
  const result = await new PlantPetRuntime({
    model,
    tools: createScopedExecutor(),
    timeoutMs: 2000
  }).run({ message: '你还记得我叫什么吗？' });

  assert.equal(result.status, 'completed');
  assert.equal(result.modelSteps, 2);
  assert.match(result.finalContent, /蒲公英/);
  assert.ok(result.events.some((item) => item.type === 'model_empty'));
  assert.ok(model.calls[1].messages.some((item) => /没有生成可展示正文/.test(String(item.content || ''))));
});

test('thinking-mode reasoning content is replayed with the assistant tool call', async () => {
  const model = scriptedModel([
    {
      enabled: true,
      content: '',
      reasoningContent: '必须原样回灌的内部推理',
      toolCalls: [toolCall('get_account_nickname')]
    },
    { enabled: true, content: '完成', reasoningContent: '', toolCalls: [] }
  ]);
  const result = await new PlantPetRuntime({
    model,
    tools: createScopedExecutor(),
    timeoutMs: 2000
  }).run({ message: '请读取当前账号昵称', plantType: '', selectedPlantPetId: 0 });
  assert.equal(result.status, 'completed');
  const replayed = model.calls[1].messages.find((item) =>
    item.role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls[0]?.function?.name === 'get_account_nickname'
  );
  assert.equal(replayed.reasoning_content, '必须原样回灌的内部推理');
});
