const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTaskIntent,
  classifyMemoryIntent
} = require('../agent/intentRouter');
const {
  getAllowedToolNames,
  parseTaskDraft
} = require('../runtime/capabilityPolicy');
const {
  createAgentToolExecutor,
  validateTaskProposalArguments
} = require('../runtime/toolRegistry');
const { PlantPetRuntime } = require('../runtime/plantPetRuntime');
const {
  assessRolloutResult,
  buildRolloutResponse
} = require('../runtime/rolloutRuntime');

function noToolModel(content) {
  return {
    isEnabled: () => true,
    async next() {
      return {
        enabled: true,
        content,
        toolCalls: [],
        rawUsage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
      };
    }
  };
}

function scopedTools(message, options = {}) {
  return createAgentToolExecutor({
    db: options.db || { execute: async () => [[]] },
    openid: 'owner-a',
    selectedPlantPetId: options.selectedPlantPetId ?? 7,
    defaultQuery: message,
    allowedToolNames: getAllowedToolNames({ message }),
    plantReader: options.plantReader || (async () => ({ id: 7, nickname: '小月', speciesName: '月季' })),
    knowledgeSearcher: options.knowledgeSearcher || (async () => ({ hits: [] })),
    memoryReader: options.memoryReader || (async () => []),
    profileReader: options.profileReader || (async () => ({ available: true, displayName: '微信用户' })),
    proposalKeyFactory: options.proposalKeyFactory || (() => 'proposal-fixed')
  });
}

test('任务意图分为请求、否定、讨论、模糊和无意图，只有请求开放提案工具', () => {
  const cases = [
    ['月季怎么浇水，并帮我安排观察任务？', 'request', true],
    ['请识别这盆植物，并帮我安排一个今天观察月季花瓣的任务。', 'request', true],
    ['请识别这盆植物并创建今天观察花瓣的任务', 'request', true],
    ['能不能帮我安排一个今天浇水的任务？', 'request', true],
    ['请问能不能提醒我明天浇水？', 'request', true],
    ['不要安排任务，只告诉我怎么做', 'deny', false],
    ['请识别这盆植物，不要安排任务', 'deny', false],
    ['我们先别安排提醒', 'deny', false],
    ['为什么要安排任务？', 'discuss', false],
    ['你能不能安排任务？', 'discuss', false],
    ['我可能需要一个任务', 'ambiguous', false],
    ['图片里叶子发黄，建议保持通风', 'none', false]
  ];
  cases.forEach(([message, expectedState, shouldPropose]) => {
    assert.equal(classifyTaskIntent(message).state, expectedState);
    const allowed = getAllowedToolNames({ message });
    assert.equal(allowed.includes('propose_care_task'), shouldPropose);
    assert.equal(allowed.includes('get_selected_plant'), shouldPropose);
  });
});

test('明确任务请求只形成 pending 候选，不执行数据库写入', async () => {
  const message = '请明天上午九点为月季安排一个观察任务';
  let sqlCalls = 0;
  const tools = scopedTools(message, {
    db: { execute: async () => { sqlCalls += 1; return [[]]; } },
    proposalKeyFactory: () => 'proposal-task-1'
  });
  const result = await new PlantPetRuntime({
    model: noToolModel('我准备了一个待确认的观察任务，你可以先预览和修改；确认前不会创建。'),
    tools,
    timeoutMs: 2000
  }).run({ message, selectedPlantPetId: 7, now: new Date('2026-09-03T00:00:00.000Z') });

  assert.equal(result.status, 'completed');
  assert.equal(sqlCalls, 0);
  assert.deepEqual(result.toolTrace.map((item) => item.toolName), [
    'get_selected_plant',
    'propose_care_task'
  ]);
  assert.equal(result.proposalDrafts.length, 1);
  assert.equal(result.proposalDrafts[0].proposalType, 'care_task');
  assert.equal(result.proposalDrafts[0].payload.scheduledFor, '2026-09-04');
  assert.equal(result.proposalDrafts[0].payload.reminderTime, '09:00');
  assert.deepEqual(assessRolloutResult(result, { message }), { accepted: true, reason: 'runtime_complete' });
  const response = buildRolloutResponse(result, { message });
  assert.equal(response.taskSuggestions[0].proposalKey, 'proposal-task-1');
  assert.equal(response.taskSuggestions[0].status, 'pending');
});

test('否定、讨论、模糊表达和图片建议都不会产生任务候选', async () => {
  const cases = [
    '不要安排任务，只告诉我怎么做',
    '为什么要安排任务？',
    '我可能需要一个任务',
    '图片里叶子发黄，建议保持通风'
  ];
  for (const message of cases) {
    const tools = scopedTools(message);
    const result = await new PlantPetRuntime({
      model: noToolModel('我先回答你的问题，不会替你创建任务。'),
      tools,
      timeoutMs: 2000
    }).run({ message, selectedPlantPetId: 7 });
    assert.equal(result.proposalDrafts.length, 0, message);
    assert.equal(result.toolTrace.some((item) => item.toolName === 'propose_care_task'), false, message);
    assert.equal(buildRolloutResponse(result, { message }).taskSuggestions.length, 0, message);
  }
});

test('称呼偏好只生成记忆候选，敏感内容不开放候选工具', async () => {
  const message = '以后叫我 Dola';
  assert.equal(classifyMemoryIntent(message).state, 'propose');
  assert.equal(getAllowedToolNames({ message }).includes('propose_memory_candidate'), true);
  const result = await new PlantPetRuntime({
    model: noToolModel('我先把 Dola 作为待确认称呼；确认后才会跨会话记住，也请不要保存敏感信息。'),
    tools: scopedTools(message, { proposalKeyFactory: () => 'proposal-memory-1' }),
    timeoutMs: 2000
  }).run({ message });
  assert.equal(result.proposalDrafts[0].proposalType, 'memory_preference');
  assert.equal(result.proposalDrafts[0].payload.value, 'Dola');
  assert.equal(buildRolloutResponse(result, { message }).memorySuggestions[0].status, 'pending');

  const sensitive = '帮我记住密码 12345678';
  assert.equal(classifyMemoryIntent(sensitive).state, 'blocked_sensitive');
  assert.equal(getAllowedToolNames({ message: sensitive }).includes('propose_memory_candidate'), false);
});

test('称呼召回问题不会把疑问词误提取为新的称呼候选', () => {
  const recallQueries = [
    '你记得以后该怎么称呼我吗？',
    '你还记得我叫什么吗？',
    '你怎么称呼我？',
    '我是谁呀？',
    '我是谁啊',
    '我是谁呢'
  ];
  for (const message of recallQueries) {
    assert.equal(classifyMemoryIntent(message).state, 'recall', message);
    assert.deepEqual(
      getAllowedToolNames({ message }).filter((name) => [
        'recall_relevant_memories',
        'get_account_nickname',
        'propose_memory_candidate'
      ].includes(name)),
      ['recall_relevant_memories', 'get_account_nickname'],
      message
    );
  }
  assert.equal(classifyMemoryIntent('请记住以后叫我云朵。').state, 'propose');
});

test('任务 schema 对非法日期返回稳定工具错误而不是 RangeError', () => {
  assert.throws(
    () => validateTaskProposalArguments({
      taskType: 'inspection',
      title: '观察植株',
      scheduledFor: '2026-99-99',
      recurrenceType: 'none',
      recurrenceInterval: 1
    }),
    (error) => error.code === 'TOOL_ARGS_INVALID'
  );
  assert.equal(parseTaskDraft('明天九点提醒我观察', new Date('2026-09-03T00:00:00.000Z')).reminderTime, '09:00');
  assert.equal(parseTaskDraft('请在 2026-09-10 10:30 提醒我观察', new Date('2026-09-03T00:00:00.000Z')).reminderTime, '10:30');
});
