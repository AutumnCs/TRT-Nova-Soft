const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOrCreateConversation,
  listRecentMessages,
  deleteConversationMediaForMessages,
  findCommittedExchangeByKey,
  forkConversationBeforeMessage,
  pruneMessages,
  withdrawLatestExchange,
  mapProposal,
  normalizeProposalExpiresAt,
  saveExchangeWithProposals
} = require('../lib/agent-store');
const {
  projectSession,
  projectModelMessages
} = require('../runtime/sessionAdapter');
const {
  listConfirmedPreferences,
  selectRelevantMemories
} = require('../runtime/memoryAdapter');
const { projectTurnContext } = require('../runtime/contextProjector');
const { loadPlantPetContext } = require('../agent/petContext');

test('读取已有会话不会刷新 updated_at', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT/.test(sql)) {
        return [[{
          id: 7,
          session_key: 'session_a',
          plant_pet_id: 3,
          title: '原会话',
          created_at: '2026-09-01 10:00:00',
          updated_at: '2026-09-01 10:00:00'
        }]];
      }
      return [{ affectedRows: 0 }];
    }
  };

  const conversation = await getOrCreateConversation(db, 'owner', 'session_a', 3);
  assert.equal(conversation.id, 7);
  assert.match(calls[0].sql, /INSERT IGNORE INTO ai_conversations/);
  assert.doesNotMatch(calls[0].sql, /ON DUPLICATE|updated_at\s*=/i);
  assert.match(calls[1].sql, /^\s*SELECT/);
});

test('列出最近消息是纯读操作，不会顺带裁剪历史', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[
        { id: 2, role: 'assistant', content: '你好', response_json: '{}', created_at: '2026-09-01 10:00:01' },
        { id: 1, role: 'user', content: '你好', response_json: null, created_at: '2026-09-01 10:00:00' }
      ]];
    }
  };

  const messages = await listRecentMessages(db, 'owner', 7);
  assert.deepEqual(messages.map((item) => item.id), [1, 2]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^\s*SELECT/);
  assert.doesNotMatch(calls[0].sql, /DELETE|UPDATE/i);
});

test('重新加载会话时以服务端 proposal 状态覆盖旧响应快照', async () => {
  const db = {
    async execute(sql) {
      if (/FROM ai_messages/.test(sql)) {
        return [[
          {
            id: 12,
            role: 'assistant',
            content: '我准备了一个称呼候选。',
            response_json: JSON.stringify({
              memorySuggestions: [{ proposalKey: 'proposal-memory-1', value: 'Dola', status: 'pending' }]
            }),
            created_at: '2026-09-03 10:00:01'
          },
          { id: 11, role: 'user', content: '以后叫我 Dola', response_json: null, created_at: '2026-09-03 10:00:00' }
        ]];
      }
      if (/FROM ai_action_proposals/.test(sql)) {
        return [[{
          id: 21,
          proposal_key: 'proposal-memory-1',
          conversation_id: 7,
          source_user_message_id: 11,
          source_assistant_message_id: 12,
          proposal_type: 'memory_preference',
          payload_json: JSON.stringify({ kind: 'preferred_name', value: 'Dola' }),
          status: 'dismissed',
          expires_at: '2026-09-04 10:00:00'
        }]];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };

  const messages = await listRecentMessages(db, 'owner', 7, { hydrateProposals: true });
  assert.equal(messages[1].response.memorySuggestions[0].status, 'cancelled');
  assert.equal(messages[1].response.memorySuggestions[0].proposalStatus, 'cancelled');
  assert.equal(messages[1].response.actionProposals[0].status, 'cancelled');
});

test('重写分支在事务中复制完整且按时间顺序排列的前缀', async () => {
  const calls = [];
  const lifecycle = [];
  let generatedSessionKey = '';
  let nextCopiedMessageId = 100;
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT m\.id, m\.conversation_id/.test(sql)) {
        return [[{ id: 90, conversation_id: 5, role: 'user', plant_pet_id: 3, title: '养护问题' }]];
      }
      if (/INSERT INTO ai_conversations/.test(sql)) {
        generatedSessionKey = params[1];
        return [{ insertId: 22 }];
      }
      if (/FROM ai_conversations WHERE/.test(sql)) {
        return [[{
          id: 22,
          session_key: generatedSessionKey,
          plant_pet_id: 3,
          title: '养护问题 · 重写',
          created_at: '2026-09-03 10:00:00',
          updated_at: '2026-09-03 10:00:00'
        }]];
      }
      if (/FROM \(\s*SELECT id, role, content/s.test(sql)) {
        return [[
          { id: 1, role: 'user', content: '第一问', response_json: null, created_at: '2026-09-03 09:00:00' },
          { id: 2, role: 'assistant', content: '第一答', response_json: '{}', created_at: '2026-09-03 09:00:01' }
        ]];
      }
      if (/INSERT INTO ai_messages/.test(sql)) return [{ insertId: nextCopiedMessageId++ }];
      return [{ insertId: 1, affectedRows: 1 }];
    }
  };
  const db = { async getConnection() { return connection; } };

  const result = await forkConversationBeforeMessage(db, 'owner', { sourceMessageId: 90 });
  assert.equal(result.copiedMessageCount, 2);
  assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
  const prefixRead = calls.find((item) => /FROM \(\s*SELECT id, role, content/s.test(item.sql));
  assert.ok(prefixRead);
  assert.match(prefixRead.sql, /ORDER BY id DESC/);
  assert.doesNotMatch(prefixRead.sql, /LIMIT 40/);
  assert.match(prefixRead.sql, /ORDER BY recent\.id ASC/);
  assert.deepEqual(prefixRead.params, [5, 'owner', 90]);
  const copies = calls.filter((item) => /INSERT INTO ai_messages/.test(item.sql));
  assert.deepEqual(copies.map((item) => item.params[3]), ['第一问', '第一答']);
  const mediaCopies = calls.filter((item) => /INSERT IGNORE INTO ai_message_media_links/.test(item.sql));
  assert.deepEqual(mediaCopies.map((item) => item.params), [[100, 'owner', 1], [101, 'owner', 2]]);
});

test('重写分支任一步失败都会回滚', async () => {
  const lifecycle = [];
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      if (/SELECT m\.id, m\.conversation_id/.test(sql)) {
        return [[{ id: 90, conversation_id: 5, role: 'user', plant_pet_id: 3, title: '原会话' }]];
      }
      if (/INSERT INTO ai_conversations/.test(sql)) return [{ insertId: 22 }];
      if (/FROM ai_conversations WHERE/.test(sql)) {
        return [[{ id: 22, session_key: params[1], plant_pet_id: 3, title: '新会话' }]];
      }
      if (/FROM \(\s*SELECT id, role, content/s.test(sql)) {
        return [[{ role: 'user', content: '待复制', response_json: null, created_at: '2026-09-03' }]];
      }
      if (/INSERT INTO ai_messages/.test(sql)) throw new Error('copy failed');
      return [[]];
    }
  };

  await assert.rejects(
    forkConversationBeforeMessage({ async getConnection() { return connection; } }, 'owner', { sourceMessageId: 90 }),
    /copy failed/
  );
  assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
});

test('媒体清理先解除消息链接，仅在没有其他消息引用时删除文件', async () => {
  const calls = [];
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT DISTINCT file_id FROM ai_message_media_links/.test(sql)) {
        return [[{ file_id: 'local://shared-image' }]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  await deleteConversationMediaForMessages(db, 'owner', [{ id: 11 }]);
  assert.match(calls[1].sql, /DELETE FROM ai_message_media_links/);
  assert.deepEqual(calls[1].params, ['owner', '11']);
  assert.match(calls[2].sql, /NOT EXISTS/);
  assert.match(calls[2].sql, /file_id IN/);
  assert.deepEqual(calls[2].params, ['owner', '11', 'local://shared-image']);
});

test('有效分支投影排除已撤回消息且不会截成半轮', () => {
  const messages = [
    { id: 1, role: 'user', content: '第一问' },
    { id: 2, role: 'assistant', content: '第一答' },
    { id: 3, role: 'user', content: '应撤回' },
    { id: 4, role: 'assistant', content: '应撤回答案' },
    { id: 5, role: 'user', content: '第三问' },
    { id: 6, role: 'assistant', content: '第三答' },
    { id: 7, role: 'user', content: '尚未完成' }
  ];
  const auditEvents = [{
    event_type: 'exchange_withdrawn',
    target_message_id: 3,
    payload_json: JSON.stringify({ sourceUserMessageId: 3, sourceAssistantMessageId: 4 })
  }];

  const projection = projectSession({ messages, auditEvents, maxTurns: 2 });
  assert.deepEqual(projection.uiMessages.map((item) => item.id), [1, 2, 5, 6, 7]);
  assert.deepEqual(projection.modelMessages.map((item) => item.id), [1, 2, 5, 6]);
  assert.deepEqual(projection.turns.map((turn) => turn.turnId), [1, 5]);
  assert.deepEqual(projectModelMessages(messages, { auditEvents, maxTurns: 1 }).map((item) => item.id), [5, 6]);
});

test('长期记忆只召回当前账号作用域内已确认且相关的用户偏好', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: 1,
        plant_pet_id: null,
        memory_type: 'user_preference',
        memory_key: 'preferred_name',
        content: '请叫我 Dola',
        user_confirmed: 1
      }]];
    }
  };
  const rows = await listConfirmedPreferences(db, 'owner', 7);
  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /memory_type = 'user_preference'/);
  assert.match(calls[0].sql, /user_confirmed = 1/);
  assert.match(calls[0].sql, /plant_pet_id = \? OR plant_pet_id IS NULL/);
  assert.deepEqual(calls[0].params, ['owner', 7]);

  const selected = selectRelevantMemories([
    rows[0],
    { id: 2, type: 'user_preference', key: 'preferred_name', content: '请叫我错误名字', userConfirmed: false },
    { id: 3, type: 'plant_fact', content: '月季在阳台', userConfirmed: true },
    { id: 4, type: 'user_preference', key: 'habit', content: '我习惯周末检查盆土', user_confirmed: '0' }
  ], '我是谁？', 8);
  assert.deepEqual(selected.map((item) => item.id), [1]);
  assert.deepEqual(selectRelevantMemories(rows, '你还记得我吗？', 8).map((item) => item.id), [1]);
  assert.deepEqual(selectRelevantMemories(rows, '哥德巴赫猜想是什么？', 8), []);
});

test('上下文投影显式区分 Session、Agent State、Memory 与 Domain State', () => {
  const projection = projectTurnContext({
    query: '你记得我叫什么吗？',
    messages: [
      { id: 1, role: 'user', content: '你好' },
      { id: 2, role: 'assistant', content: '你好呀' }
    ],
    agentState: { route: 'memory_recall' },
    accountProfile: { nickname: '微信昵称' },
    selectedPlant: { id: 7, nickname: '小月亮' },
    domainState: { pendingTasks: [{ id: 9, title: '观察盆土' }] },
    memories: [
      { id: 11, type: 'user_preference', key: 'preferred_name', content: '请叫我 Dola', userConfirmed: true },
      { id: 12, type: 'business_event', content: '昨天浇水', userConfirmed: true }
    ],
    knowledge: [{ id: 20, title: '月季养护' }]
  });

  assert.deepEqual(projection.history.map((item) => item.id), [1, 2]);
  assert.equal(projection.layers.session, true);
  assert.equal(projection.layers.agentState, true);
  assert.equal(projection.layers.longTermMemory, true);
  assert.equal(projection.layers.domainState, true);
  assert.match(projection.contextText, /<domain_state>/);
  assert.match(projection.contextText, /<confirmed_memories>/);
  assert.match(projection.contextText, /Dola/);
  assert.doesNotMatch(projection.contextText, /昨天浇水/);

  const publicProjection = projectTurnContext({
    query: '你记得我叫什么吗？',
    messages: projection.history,
    privateContextAllowed: false,
    accountProfile: { nickname: '不应暴露' },
    domainState: { secret: true },
    memories: [{ type: 'user_preference', key: 'preferred_name', content: '请叫我 Dola', userConfirmed: true }],
    knowledge: [{ title: '公开知识' }]
  });
  assert.equal(publicProjection.blocks.some((block) => block.layer === 'domain_state'), false);
  assert.equal(publicProjection.blocks.some((block) => block.layer === 'long_term_memory'), false);
  assert.match(publicProjection.contextText, /公开知识/);
  assert.doesNotMatch(publicProjection.contextText, /Dola|不应暴露|secret/);
});

test('读取植宠上下文只读取业务事实，不再同步写入长期记忆', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/FROM plant_pets pp/.test(sql)) {
        return [[{ id: 7, nickname: '小月亮', library_name: '月季', status: 'active' }]];
      }
      return [[]];
    }
  };

  const context = await loadPlantPetContext(db, 'owner', 7);
  assert.equal(context.pet.nickname, '小月亮');
  assert.equal(calls.length, 5);
  assert.equal(calls.every((item) => /^\s*SELECT/i.test(item.sql)), true);
  assert.equal(calls.some((item) => /ai_memories/i.test(item.sql)), false);
});

test('原子交换同时写入消息、pending proposal 与 turn_committed 事件', async () => {
  const calls = [];
  const lifecycle = [];
  let storedProposal = null;
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM ai_conversation_events/.test(sql)) return [[]];
      if (/SELECT id FROM ai_conversations/.test(sql)) return [[{ id: 7 }]];
      if (/INSERT INTO ai_messages/.test(sql) && /'user'/.test(sql)) return [{ insertId: 101 }];
      if (/INSERT INTO ai_messages/.test(sql) && /'assistant'/.test(sql)) return [{ insertId: 102 }];
      if (/INSERT INTO ai_action_proposals/.test(sql)) {
        storedProposal = {
          id: 201,
          proposal_key: params[0],
          conversation_id: params[2],
          source_user_message_id: params[3],
          source_assistant_message_id: params[4],
          plant_pet_id: params[5],
          proposal_type: params[6],
          payload_json: params[7],
          status: 'pending',
          expires_at: '2026-09-04 10:00:00'
        };
        return [{ insertId: 201 }];
      }
      if (/FROM ai_action_proposals/.test(sql)) return [[storedProposal]];
      if (/INSERT INTO ai_conversation_events/.test(sql)) return [{ insertId: 301 }];
      return [{ affectedRows: 1 }];
    }
  };

  const result = await saveExchangeWithProposals(
    { async getConnection() { return connection; } },
    'owner',
    7,
    '明天提醒我浇水',
    '我先准备一个待确认任务。',
    { summary: '待确认', taskSuggestions: [{ taskType: 'watering', title: '浇水' }] },
    {
      clientTurnKey: 'turn-uuid-1',
      plantPetId: 3,
      proposals: [{
        proposalType: 'care_task',
        plantPetId: 3,
        payload: { taskType: 'watering', title: '浇水' }
      }]
    }
  );

  assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
  assert.equal(result.userMessageId, 101);
  assert.equal(result.assistantMessageId, 102);
  assert.equal(result.idempotent, false);
  assert.equal(result.proposals[0].status, 'pending');
  assert.equal(result.response.taskSuggestions[0].status, 'pending');
  assert.equal(result.response.taskSuggestions[0].proposalStatus, 'pending');
  const proposalInsert = calls.find((item) => /INSERT INTO ai_action_proposals/.test(item.sql));
  assert.deepEqual(proposalInsert.params.slice(1, 7), ['owner', 7, 101, 102, 3, 'care_task']);
  assert.match(proposalInsert.params[7], /"sourceUserMessageId":101/);
  assert.match(proposalInsert.params[7], /"sourceAssistantMessageId":102/);
  assert.match(proposalInsert.params[7], /"taskType":"watering"/);
  assert.equal(proposalInsert.params[8], null);
  const eventInsert = calls.find((item) => /INSERT INTO ai_conversation_events/.test(item.sql));
  assert.equal(eventInsert.params[3], 'turn-uuid-1');
  assert.equal(eventInsert.params[5], 101);
  assert.match(eventInsert.params[6], /"sourceAssistantMessageId":102/);
  assert.ok(calls.indexOf(proposalInsert) < calls.indexOf(eventInsert));
});

test('重复 clientTurnKey 直接返回原轮次，不重复写消息或提案', async () => {
  const calls = [];
  const lifecycle = [];
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/event_type = 'exchange_withdrawn'/.test(sql)) return [[]];
      if (/FROM ai_conversation_events/.test(sql)) {
        return [[{
          id: 301,
          conversation_id: 7,
          target_message_id: 101,
          payload_json: JSON.stringify({
            sourceUserMessageId: 101,
            sourceAssistantMessageId: 102,
            assistantText: '原回答',
            response: { summary: '原回答' }
          })
        }]];
      }
      if (/FROM ai_messages/.test(sql)) {
        return [[
          { id: 101, role: 'user', content: '原问题', response_json: null },
          { id: 102, role: 'assistant', content: '原回答', response_json: JSON.stringify({ summary: '原回答' }) }
        ]];
      }
      if (/FROM ai_action_proposals/.test(sql)) return [[]];
      throw new Error(`unexpected write: ${sql}`);
    }
  };

  const result = await saveExchangeWithProposals(
    { async getConnection() { return connection; } },
    'owner',
    7,
    '重复问题',
    '重复回答',
    { summary: '重复回答' },
    { clientTurnKey: 'turn-uuid-1', proposals: [] }
  );
  assert.equal(result.idempotent, true);
  assert.equal(result.assistantText, '原回答');
  assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
  assert.equal(calls.some((item) => /^\s*INSERT|^\s*UPDATE/.test(item.sql)), false);
});

test('撤回后同一 clientTurnKey 成为 410 tombstone，不会从事件 payload 幽灵重放', async () => {
  const calls = [];
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/event_key = \?/.test(sql) && params[1] === 'turn-withdrawn') {
        return [[{
          id: 301,
          conversation_id: 7,
          target_message_id: 101,
          payload_json: JSON.stringify({
            sourceUserMessageId: 101,
            sourceAssistantMessageId: 102,
            assistantText: '已被撤回的回答',
            response: { summary: '已被撤回的回答' }
          })
        }]];
      }
      if (/event_type = 'exchange_withdrawn'/.test(sql)) return [[{ id: 302 }]];
      if (/event_key = \?/.test(sql)) return [[]];
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  await assert.rejects(
    findCommittedExchangeByKey(db, 'owner', 'turn-withdrawn'),
    (error) => error?.code === 'CLIENT_TURN_KEY_WITHDRAWN' && error?.statusCode === 410
  );
  assert.equal(await findCommittedExchangeByKey(db, 'owner', 'turn-new-key'), null);
  assert.equal(calls.some((item) => /FROM ai_messages/.test(item.sql)), false);
});

test('分页上限不再触发原文、提案来源或媒体的自动裁剪', async () => {
  const calls = [];
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, conversation_id FROM ai_messages/.test(sql)) {
        return [[{ id: 11, conversation_id: 7 }, { id: 12, conversation_id: 7 }]];
      }
      if (/SELECT DISTINCT file_id/.test(sql)) return [[{ file_id: 'local://image-1' }]];
      if (/ORDER BY id DESC LIMIT 40/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  };

  await pruneMessages(db, 'owner', 7);
  const proposalRetire = calls.find((item) => /UPDATE ai_action_proposals/.test(item.sql));
  const eventRetire = calls.find((item) => /UPDATE ai_conversation_events/.test(item.sql));
  const messageDelete = calls.find((item) => /DELETE FROM ai_messages/.test(item.sql));
  const mediaDelete = calls.find((item) => /DELETE FROM media_objects/.test(item.sql));
  assert.equal(proposalRetire, undefined);
  assert.equal(eventRetire, undefined);
  assert.equal(mediaDelete, undefined);
  assert.equal(messageDelete, undefined);
});

test('撤回交换会在同一事务取消 pending proposal 并追加审计事件', async () => {
  const calls = [];
  const lifecycle = [];
  const connection = {
    async beginTransaction() { lifecycle.push('begin'); },
    async commit() { lifecycle.push('commit'); },
    async rollback() { lifecycle.push('rollback'); },
    release() { lifecycle.push('release'); },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, role FROM ai_messages/.test(sql)) {
        return [[{ id: 12, role: 'assistant' }, { id: 11, role: 'user' }]];
      }
      if (/INSERT INTO ai_conversation_events/.test(sql)) return [{ insertId: 401 }];
      return [{ affectedRows: 1 }];
    }
  };
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params });
      return [[{
        id: 7,
        session_key: 'session_a',
        plant_pet_id: 3,
        title: '原会话'
      }]];
    },
    async getConnection() { return connection; }
  };

  const result = await withdrawLatestExchange(db, 'owner', {
    sessionId: 'session_a',
    userMessageId: 11
  });
  assert.equal(result.userMessageId, 11);
  assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
  const cancel = calls.find((item) => /UPDATE ai_action_proposals/.test(item.sql));
  const audit = calls.find((item) => /INSERT INTO ai_conversation_events/.test(item.sql));
  const deletion = calls.find((item) => /DELETE FROM ai_messages/.test(item.sql));
  assert.ok(cancel);
  assert.match(cancel.sql, /status = 'pending'/);
  assert.deepEqual(cancel.params, ['owner', 7, 11, 12]);
  assert.ok(audit);
  assert.equal(audit.params[2], 'exchange_withdrawn');
  assert.equal(audit.params[5], 11);
  assert.ok(calls.indexOf(cancel) < calls.indexOf(audit));
  assert.ok(calls.indexOf(audit) < calls.indexOf(deletion));
});

test('proposal 状态与过期时间使用稳定的数据库契约', () => {
  assert.equal(mapProposal({ status: 'dismissed' }).status, 'cancelled');
  assert.equal(normalizeProposalExpiresAt('2026-09-04T10:00:00.000Z'), null);
  assert.equal(normalizeProposalExpiresAt('2026-09-04 10:00:00'), '2026-09-04 10:00:00');
});
