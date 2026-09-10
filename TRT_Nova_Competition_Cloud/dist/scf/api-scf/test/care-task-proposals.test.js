const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProposalKey,
  mapCareTaskProposalRow,
  buildConfirmedTaskInput,
  getCareTaskProposalForUser,
  cancelCareTaskProposalForUser,
  confirmCareTaskProposalForUser
} = require('../lib/care-task-proposals');

function createProposalDb(overrides = {}) {
  const state = {
    proposal: {
      id: 11,
      proposal_key: 'proposal-owner-a-001',
      openid: 'owner-a',
      conversation_id: 7,
      source_user_message_id: 101,
      source_assistant_message_id: 102,
      plant_pet_id: 9,
      plant_pet_name: '小月亮',
      plant_pet_status: 'active',
      proposal_type: 'care_task',
      payload_json: JSON.stringify({
        taskType: 'inspection',
        title: '观察新叶',
        description: '查看叶背',
        scheduledFor: '2026-09-10',
        reminderTime: '09:00',
        recurrenceType: 'none',
        recurrenceInterval: 1
      }),
      status: 'pending',
      expires_at: '2026-09-11 09:00:00',
      consumed_target_id: null,
      ...overrides.proposal
    },
    plantActive: overrides.plantActive !== false,
    tasks: [],
    creationKeys: new Map(),
    commits: 0,
    rollbacks: 0
  };

  const connection = {
    async beginTransaction() {},
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    async execute(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();

      if (compact.startsWith("UPDATE ai_action_proposals SET status = 'expired'")) {
        return [{ affectedRows: 0 }];
      }
      if (compact.includes('FROM ai_action_proposals p')) {
        const [openid, proposalKey] = params;
        if (state.proposal.openid !== openid || state.proposal.proposal_key !== proposalKey) return [[]];
        return [[{ ...state.proposal }]];
      }
      if (compact.startsWith('SELECT task_id FROM care_task_creation_keys')) {
        const taskId = state.creationKeys.get(`${params[0]}:${params[1]}`) || 0;
        return [taskId ? [{ task_id: taskId }] : []];
      }
      if (compact.startsWith('SELECT id FROM plant_pets')) {
        const [plantPetId, openid] = params;
        const owned = state.plantActive && Number(plantPetId) === 9 && openid === 'owner-a';
        return [owned ? [{ id: 9 }] : []];
      }
      if (compact.startsWith('INSERT INTO todos')) {
        const taskId = 80 + state.tasks.length + 1;
        state.tasks.push({
          id: taskId,
          openid: params[0],
          plant_pet_id: params[1],
          task_type: params[2],
          title: params[3],
          description_text: params[4],
          scheduled_for: params[5],
          reminder_time: params[6],
          recurrence_type: params[7],
          recurrence_interval: params[8],
          source: params[9],
          status: 'pending',
          plant_pet_name: '小月亮',
          plant_pet_status: 'active'
        });
        return [{ insertId: taskId, affectedRows: 1 }];
      }
      if (compact.startsWith('INSERT INTO care_task_creation_keys')) {
        state.creationKeys.set(`${params[0]}:${params[1]}`, Number(params[2]));
        return [{ affectedRows: 1 }];
      }
      if (compact.includes("SET status = 'confirmed'")) {
        if (state.proposal.status !== 'pending') return [{ affectedRows: 0 }];
        state.proposal.status = 'confirmed';
        state.proposal.consumed_target_type = 'care_task';
        state.proposal.consumed_target_id = Number(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (compact.includes("SET status = 'dismissed'")) {
        if (state.proposal.status !== 'pending') return [{ affectedRows: 0 }];
        state.proposal.status = 'dismissed';
        return [{ affectedRows: 1 }];
      }
      if (compact.includes('FROM todos t')) {
        const [openid, taskId] = params;
        return [[...state.tasks.filter((task) => task.openid === openid && task.id === Number(taskId))]];
      }
      throw new Error(`Unexpected SQL in proposal test: ${compact}`);
    }
  };

  return {
    state,
    db: {
      async getConnection() { return connection; },
      execute: connection.execute.bind(connection)
    }
  };
}

test('proposal key 和返回对象只暴露任务候选所需字段', () => {
  assert.equal(normalizeProposalKey(' proposal-owner-a-001 '), 'proposal-owner-a-001');
  assert.equal(normalizeProposalKey('bad key'), '');
  const proposal = mapCareTaskProposalRow({
    proposal_key: 'proposal-owner-a-001',
    proposal_type: 'care_task',
    plant_pet_id: 9,
    plant_pet_name: '小月亮',
    payload_json: '{"taskType":"watering","title":"检查盆土","scheduledFor":"2026-09-10"}',
    status: 'dismissed',
    expires_at: '2026-09-11 09:00:00'
  });
  assert.equal(proposal.status, 'cancelled');
  assert.equal(proposal.payload.plantPetId, 9);
  assert.equal(proposal.payload.taskType, 'watering');
  assert.equal(proposal.canConfirm, false);
});

test('确认字段允许编辑任务内容但禁止换植宠和注入权限字段', () => {
  const row = createProposalDb().state.proposal;
  const valid = buildConfirmedTaskInput(row, {
    proposalKey: row.proposal_key,
    plantPetId: 9,
    title: '检查新叶和叶背',
    reminderTime: null
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.plantPetId, 9);
  assert.equal(valid.value.title, '检查新叶和叶背');
  assert.equal(valid.value.reminderTime, null);
  assert.equal(valid.value.source, 'ai');

  assert.match(buildConfirmedTaskInput(row, { proposalKey: row.proposal_key, plantPetId: 10 }).msg, /不能更换植宠/);
  assert.match(buildConfirmedTaskInput(row, { proposalKey: row.proposal_key, openid: 'owner-b' }).msg, /字段无效/);
});

test('proposal 查询按 JWT owner 和 key 双重限定', async () => {
  const { db } = createProposalDb();
  const owned = await getCareTaskProposalForUser(db, 'owner-a', { proposalKey: 'proposal-owner-a-001' });
  assert.equal(owned.success, true);
  assert.equal(owned.proposal.status, 'pending');
  assert.equal(owned.proposal.plantPetId, 9);

  const foreign = await getCareTaskProposalForUser(db, 'owner-b', { proposalKey: 'proposal-owner-a-001' });
  assert.equal(foreign.success, false);
  assert.match(foreign.msg, /不存在或无权访问/);
});

test('proposal 确认写入一次，重复 POST 幂等返回同一任务', async () => {
  const { db, state } = createProposalDb();
  const input = {
    proposalKey: 'proposal-owner-a-001',
    plantPetId: 9,
    title: '检查新叶和叶背',
    scheduledFor: '2026-09-12',
    reminderTime: '10:45',
    recurrenceType: 'weekly',
    recurrenceInterval: 1
  };
  const first = await confirmCareTaskProposalForUser(db, 'owner-a', input);
  const second = await confirmCareTaskProposalForUser(db, 'owner-a', input);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(first.task.id, second.task.id);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, '检查新叶和叶背');
  assert.equal(state.tasks[0].scheduled_for, '2026-09-12');
  assert.equal(state.tasks[0].source, 'ai');
  assert.equal(second.proposal.idempotent, true);
});

test('过期、取消、跨 owner 和失效植宠都不能确认', async () => {
  const expired = createProposalDb({ proposal: { status: 'expired' } });
  assert.match(
    (await confirmCareTaskProposalForUser(expired.db, 'owner-a', { proposalKey: 'proposal-owner-a-001' })).msg,
    /过期/
  );

  const cancelled = createProposalDb();
  const cancelledResult = await cancelCareTaskProposalForUser(cancelled.db, 'owner-a', {
    proposalKey: 'proposal-owner-a-001'
  });
  assert.equal(cancelledResult.success, true);
  assert.equal(cancelledResult.proposal.status, 'cancelled');
  assert.equal(cancelled.state.tasks.length, 0);
  assert.equal((await cancelCareTaskProposalForUser(cancelled.db, 'owner-a', {
    proposalKey: 'proposal-owner-a-001'
  })).success, true);

  const foreign = createProposalDb();
  assert.equal((await confirmCareTaskProposalForUser(foreign.db, 'owner-b', {
    proposalKey: 'proposal-owner-a-001'
  })).success, false);
  assert.equal(foreign.state.tasks.length, 0);

  const archived = createProposalDb({ plantActive: false });
  const archivedResult = await confirmCareTaskProposalForUser(archived.db, 'owner-a', {
    proposalKey: 'proposal-owner-a-001'
  });
  assert.equal(archivedResult.success, false);
  assert.match(archivedResult.msg, /不存在、已归档或无权访问/);
  assert.equal(archived.state.tasks.length, 0);
});
