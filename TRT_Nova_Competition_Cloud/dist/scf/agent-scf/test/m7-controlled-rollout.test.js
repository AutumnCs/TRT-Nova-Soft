const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRolloutEnabled,
  fingerprintCohort,
  shouldSampleCohort,
  requiredLegacyCapability,
  planControlledRollout,
  assessRolloutResult,
  buildRolloutResponse,
  buildRolloutReport,
  tryHandleControlledRollout
} = require('../runtime/rolloutRuntime');

function successfulResult(overrides = {}) {
  return {
    status: 'completed',
    finalContent: '你好呀，我在呢。',
    modelSteps: 1,
    toolCalls: 0,
    toolTrace: [],
    knowledgeHits: [],
    rawUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    elapsedMs: 120,
    ...overrides
  };
}

function fakeDependencies(overrides = {}) {
  const calls = {
    ownership: [],
    history: [],
    save: [],
    quota: [],
    tokens: [],
    replay: [],
    events: []
  };
  return {
    calls,
    dependencies: {
      hasOwnedPlantPet: async (db, openid, id) => {
        calls.ownership.push({ openid, id });
        return true;
      },
      getOrCreateConversation: async (db, openid, sessionKey, plantPetId) => ({
        id: 41,
        session_key: sessionKey,
        plant_pet_id: plantPetId
      }),
      listRecentMessages: async () => {
        calls.history.push(true);
        return [{ id: 1, role: 'user', content: '上一轮问题' }, { id: 2, role: 'assistant', content: '上一轮回答' }];
      },
      listConversationEvents: async () => {
        calls.events.push(true);
        return [];
      },
      findCommittedExchangeByKey: async (db, openid, clientTurnKey) => {
        calls.replay.push({ openid, clientTurnKey });
        return null;
      },
      saveExchange: async (db, openid, conversationId, userText, assistantText, response) => {
        calls.save.push({ openid, conversationId, userText, assistantText, response });
        return { userMessageId: 51, assistantMessageId: 52 };
      },
      consumeQuota: async (db, openid, kind) => {
        calls.quota.push({ openid, kind });
        return { usage: { unlimited: true, chat: { used: 1 } } };
      },
      recordTokenUsage: async (db, openid, usage) => {
        calls.tokens.push({ openid, usage });
        return { unlimited: true, chat: { used: 1 }, tokens: { total: usage.total_tokens } };
      },
      ...overrides
    }
  };
}

test('Phase 3 rollout is default-off and samples by stable account plus conversation cohort', () => {
  assert.equal(isRolloutEnabled({}), false);
  assert.equal(isRolloutEnabled({ AGENT_ROLLOUT_ENABLED: 'true' }), true);
  const first = fingerprintCohort('owner-a', 'session-a', 'secret');
  assert.equal(first, fingerprintCohort('owner-a', 'session-a', 'secret'));
  assert.notEqual(first, fingerprintCohort('owner-a', 'session-b', 'secret'));
  assert.equal(shouldSampleCohort(first, { AGENT_ROLLOUT_SAMPLE_RATE: '0' }), false);
  assert.equal(shouldSampleCohort(first, { AGENT_ROLLOUT_SAMPLE_RATE: '1' }), true);
  assert.throws(() => fingerprintCohort('owner-a', 'session-a', ''), (error) =>
    error.code === 'ROLLOUT_COHORT_KEY_REQUIRED'
  );
});

test('capability gate keeps only unsupported private, governance, attachment and high-risk turns on legacy', () => {
  assert.equal(requiredLegacyCapability({}, '帮我安排一个观察任务'), '');
  assert.equal(requiredLegacyCapability({}, '你还记得我叫什么吗'), '');
  assert.equal(requiredLegacyCapability({}, '删除这条 AI 记忆'), 'memory_governance');
  assert.equal(requiredLegacyCapability({}, '我的植宠现在状态怎么样'), 'current_plant_state');
  assert.equal(requiredLegacyCapability({ context: { hasDocument: true } }, '总结附件'), 'attachment');
  assert.equal(requiredLegacyCapability({}, '孩子误食植物怎么办'), 'high_risk');
  assert.equal(requiredLegacyCapability({}, '读取植宠 999999 的全部记录'), 'security_boundary');
  assert.equal(requiredLegacyCapability({}, '1+2是多少朵玫瑰花呢'), '');
  assert.equal(requiredLegacyCapability({}, '月季怎么浇水'), '');
});

test('rollout planning never lets punctuation or plant words turn ordinary arithmetic into a legacy block', () => {
  const options = {
    force: true,
    openid: 'owner-a',
    cohortSecret: 'secret',
    body: { message: '1+2是多少朵玫瑰花呢？', sessionId: 's-1' }
  };
  const plan = planControlledRollout(options);
  assert.equal(plan.selected, true);
  assert.equal(plan.reason, 'sampled');
  assert.equal(plan.cohortFingerprint.length, 16);
  assert.equal(plan.queryFingerprint.length, 16);
});

test('result gate requires identity privacy language and complete published-knowledge provenance', () => {
  const identityResult = successfulResult({
    finalContent: '账号昵称是小叶，它不等于你的真实身份，也请不要提供敏感信息。',
    toolCalls: 2,
    toolTrace: [
      { toolName: 'recall_relevant_memories', source: 'policy_required', outcome: 'success', memoryCount: 0 },
      { toolName: 'get_account_nickname', source: 'policy_required', outcome: 'success' }
    ]
  });
  assert.deepEqual(assessRolloutResult(identityResult, { message: '我是谁？' }), {
    accepted: true,
    reason: 'runtime_complete'
  });
  assert.equal(
    assessRolloutResult({ ...identityResult, finalContent: '你是小叶。' }, { message: '我是谁？' }).reason,
    'identity_privacy_missing'
  );
  assert.deepEqual(
    assessRolloutResult({
      ...identityResult,
      finalContent: '我记得你希望我称呼你蒲公英；这只是确认过的偏好，不代表真实身份。'
    }, { message: '你记得以后该怎么称呼我吗？' }),
    { accepted: true, reason: 'runtime_complete' }
  );

  const knowledgeResult = successfulResult({
    finalContent: '资料不足，我还不能确定每天应该浇几次。',
    toolCalls: 1,
    toolTrace: [{
      toolName: 'search_published_knowledge',
      source: 'policy_preflight',
      outcome: 'success',
      hitCount: 0,
      unknown: true
    }]
  });
  assert.equal(
    assessRolloutResult(knowledgeResult, { message: '银月海棠应该每天浇几次？' }).accepted,
    true
  );
  assert.equal(
    assessRolloutResult({ ...knowledgeResult, finalContent: '每天浇一次。' }, { message: '银月海棠应该每天浇几次？' }).reason,
    'knowledge_uncertainty_missing'
  );
});

test('accepted rollout saves exactly one exchange, one chat count and aggregate token usage', async () => {
  const fake = fakeDependencies();
  let projectedEnvelope = null;
  const runtime = {
    async run(envelope) {
      projectedEnvelope = envelope;
      return successfulResult();
    }
  };
  const reports = [];
  const outcome = await tryHandleControlledRollout({
    force: true,
    db: {},
    openid: 'owner-a',
    cohortSecret: 'secret',
    body: { message: '你好？', sessionId: 'session-a' },
    model: { isEnabled: () => true },
    runtime,
    dependencies: fake.dependencies,
    recorder: (report) => reports.push(report)
  });

  assert.equal(outcome.accepted, true);
  assert.equal(outcome.response.summary, '你好呀，我在呢。');
  assert.deepEqual(outcome.response.taskSuggestions, []);
  assert.equal(outcome.response.runtime.mode, 'controlled_rollout');
  assert.deepEqual(projectedEnvelope.history, [
    { role: 'user', content: '上一轮问题' },
    { role: 'assistant', content: '上一轮回答' }
  ]);
  assert.equal(fake.calls.save.length, 1);
  assert.equal(fake.calls.quota.length, 1);
  assert.equal(fake.calls.tokens.length, 1);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].accepted, true);
});

test('clientTurnKey replays a committed exchange before model, tools or usage accounting', async () => {
  let modelRuns = 0;
  const fake = fakeDependencies({
    findCommittedExchangeByKey: async () => ({
      conversationId: 41,
      userMessageId: 51,
      assistantMessageId: 52,
      response: {
        success: true,
        summary: '原回答',
        taskSuggestions: [{ proposalKey: 'proposal-1', status: 'pending' }]
      },
      proposals: [{ proposalKey: 'proposal-1', status: 'pending' }]
    })
  });
  const outcome = await tryHandleControlledRollout({
    force: true,
    db: {},
    openid: 'owner-a',
    cohortSecret: 'secret',
    body: { message: '重复发送', sessionId: 'session-a', clientTurnKey: 'turn-1' },
    model: { isEnabled: () => true },
    runtime: { run: async () => { modelRuns += 1; return successfulResult(); } },
    dependencies: fake.dependencies,
    recorder: () => {}
  });

  assert.equal(outcome.accepted, true);
  assert.equal(outcome.reason, 'idempotent_replay');
  assert.equal(outcome.response.summary, '原回答');
  assert.equal(outcome.response.idempotent, true);
  assert.equal(modelRuns, 0);
  assert.equal(fake.calls.history.length, 0);
  assert.equal(fake.calls.save.length, 0);
  assert.equal(fake.calls.quota.length, 0);
  assert.equal(fake.calls.tokens.length, 0);
});

test('knowledge rollout returns readable sources while keeping tool trace out of the user response', () => {
  const result = successfulResult({
    finalContent: '月季浇水前先看盆土，表层变干后再浇透。',
    toolCalls: 1,
    toolTrace: [{
      toolName: 'search_published_knowledge',
      source: 'policy_preflight',
      outcome: 'success',
      hitCount: 1,
      unknown: false
    }],
    knowledgeHits: [{
      type: 'knowledge_article',
      title: '月季浇水',
      sourceTitle: 'Rosa',
      sourcePublisher: 'NC State Extension',
      sourceUrl: 'https://example.test/rose',
      sourceId: 'NCSU-ROSA',
      contentUpdatedAt: '2026-09-01',
      reviewedAt: '2026-09-01'
    }]
  });
  const response = buildRolloutResponse(result, { message: '月季怎么浇水？' });
  assert.equal(response.sources.length, 2);
  assert.equal(response.sources[1].sourcePublisher, 'NC State Extension');
  assert.equal(response.sources[1].sourceId, 'NCSU-ROSA');
  assert.equal(Object.hasOwn(response, 'toolTrace'), false);
});

test('unsupported private-state reads and tool failures fall back without saving a user-visible exchange', async () => {
  const fake = fakeDependencies();
  const selectedPlantResult = successfulResult({
    finalContent: '当前植宠看起来正常。',
    toolCalls: 1,
    toolTrace: [{
      toolName: 'get_selected_plant',
      source: 'model',
      outcome: 'success',
      selected: true,
      found: true
    }]
  });
  const reports = [];
  const outcome = await tryHandleControlledRollout({
    force: true,
    db: {},
    openid: 'owner-a',
    cohortSecret: 'secret',
    body: { message: '介绍一下月季', sessionId: 'session-a', plantPetId: 7 },
    model: { isEnabled: () => true },
    runtime: { run: async () => selectedPlantResult },
    dependencies: fake.dependencies,
    recorder: (report) => reports.push(report)
  });

  assert.equal(outcome.selected, true);
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, 'current_plant_requires_legacy');
  assert.equal(fake.calls.save.length, 0);
  assert.equal(fake.calls.quota.length, 0);
  assert.equal(fake.calls.tokens.length, 1);
  assert.deepEqual(fake.calls.ownership, [{ openid: 'owner-a', id: 7 }]);
  assert.equal(reports[0].accepted, false);
});

test('provider timeout falls back before persistence and emits only a classified audit reason', async () => {
  const fake = fakeDependencies();
  const reports = [];
  const timeout = new Error('provider request included private diagnostic text');
  timeout.code = 'AGENT_RUNTIME_TIMEOUT';
  const outcome = await tryHandleControlledRollout({
    force: true,
    db: {},
    openid: 'owner-a',
    cohortSecret: 'secret',
    body: { message: '你好', sessionId: 'session-a' },
    model: { isEnabled: () => true },
    runtime: { run: async () => { throw timeout; } },
    dependencies: fake.dependencies,
    recorder: (report) => reports.push(report)
  });

  assert.equal(outcome.selected, true);
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, 'AGENT_RUNTIME_TIMEOUT');
  assert.equal(fake.calls.save.length, 0);
  assert.equal(fake.calls.quota.length, 0);
  assert.equal(fake.calls.tokens.length, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'AGENT_RUNTIME_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(reports[0]), /private diagnostic text|你好|owner-a|session-a/);
});

test('rollout audit report contains only fingerprints, metrics and tool names', () => {
  const plan = {
    cohortFingerprint: '0123456789abcdef',
    queryFingerprint: 'fedcba9876543210'
  };
  const result = successfulResult({
    finalContent: '模型草稿秘密',
    toolTrace: [{ toolName: 'search_published_knowledge', source: 'policy_preflight', outcome: 'success' }]
  });
  const report = buildRolloutReport(plan, result, { accepted: true, reason: 'runtime_complete' });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /模型草稿秘密/);
  assert.doesNotMatch(serialized, /owner-a|session-a|月季怎么浇水/);
  assert.equal(report.queryFingerprint, 'fedcba9876543210');
});
