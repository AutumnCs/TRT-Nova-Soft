const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDateInput,
  validateCreateInput,
  mapPlantPetRow,
  deletePlantPetForUser
} = require('../lib/plant-pets');
const { confirmCareTaskProposalForUser } = require('../lib/care-task-proposals');

test('PlantPet 允许未知品种以昵称建档', () => {
  const result = validateCreateInput({
    nickname: '窗边的小叶子',
    enteredAt: '2026-08-26',
    location: '客厅窗边'
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.plantLibraryId, null);
  assert.equal(result.value.speciesName, '');
  assert.equal(result.value.nickname, '窗边的小叶子');
});

test('PlantPet 拒绝空昵称和无效日期', () => {
  assert.equal(validateCreateInput({ nickname: '   ' }).ok, false);
  assert.deepEqual(normalizeDateInput('2026-02-30'), {
    ok: false,
    value: null,
    msg: '入室日期无效'
  });
  assert.equal(normalizeDateInput('2026/08/26').ok, false);
  assert.equal(validateCreateInput({ nickname: '小叶子', coverFileId: 'wxfile://tmp/cover.png' }).ok, false);
});

test('PlantPet 映射完整档案并优先使用自定义封面', () => {
  const pet = mapPlantPetRow({
    id: 9,
    openid: 'owner-a',
    plant_library_id: 2,
    nickname: '小月亮',
    library_plant_name: '月季',
    library_image_url: 'https://example.invalid/library.png',
    cover_url: 'https://example.invalid/custom.png',
    cover_file_id: 'local://12345678-1234-1234-1234-123456789abc',
    entered_at: '2026-08-12',
    location: '南阳台',
    care_notes: '午后注意遮阴',
    status: 'active'
  });

  assert.equal(pet.ownerOpenid, 'owner-a');
  assert.equal(pet.speciesName, '月季');
  assert.equal(pet.coverUrl, 'https://example.invalid/custom.png');
  assert.equal(pet.coverFileId, 'local://12345678-1234-1234-1234-123456789abc');
  assert.equal(pet.enteredAt, '2026-08-12');
  assert.equal(pet.isUnknownSpecies, false);
});

test('PlantPet 无品种时明确映射为未知品种', () => {
  const pet = mapPlantPetRow({ id: 1, openid: 'owner-a', nickname: '新朋友' });
  assert.equal(pet.speciesName, '未知品种');
  assert.equal(pet.isUnknownSpecies, true);
  assert.equal(pet.coverUrl, '');
});

function deletionDb(options = {}) {
  const conversations = [
    { id: 10, openid: 'owner-a', plant_pet_id: 9 },
    { id: 11, openid: 'owner-a', plant_pet_id: 9 }, // A branch of the same plant.
    { id: 20, openid: 'owner-a', plant_pet_id: 8 },
    { id: 30, openid: 'owner-b', plant_pet_id: 9 },
    { id: 40, openid: 'owner-a', plant_pet_id: null }
  ];
  const state = {
    conversations,
    links: conversations.map(c => ({ openid: c.openid, conversation_id: c.id, file_id: `cos://${c.id}` })),
    events: conversations.map(c => ({ openid: c.openid, conversation_id: c.id,
      event_key: `turn-${c.id}`, target_message_id: c.id * 10, payload_json: { text: 'original conversation' } })),
    proposals: conversations.map((c, index) => ({ openid: c.openid, conversation_id: c.id,
      plant_pet_id: c.id === 40 ? 9 : c.plant_pet_id, proposal_key: `proposal-${c.id}`,
      proposal_type: 'care_task', status: index % 2 ? 'confirmed' : 'pending', consumed_target_id: 200 + index,
      source_user_message_id: c.id * 10, payload_json: { title: 'original advice' } })),
    creationKeys: [{ openid: 'owner-a', idempotency_key: 'proposal-11', task_id: 201 }],
    globalPreference: { openid: 'owner-a', plant_pet_id: null, content: 'preferred nickname' }
  };
  const calls = []; let snapshot; let commits = 0; let rollbacks = 0; let releases = 0;
  const matchingConversation = (row, owner, plant) => state.conversations.some(c =>
    c.id === row.conversation_id && c.openid === row.openid && c.openid === owner && c.plant_pet_id === plant);
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() { commits++; },
    async rollback() { rollbacks++; Object.assign(state, snapshot); },
    release() { releases++; },
    async execute(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: compact, params });
      if (options.failSql && compact.startsWith(options.failSql)) throw new Error('injected deletion failure');
      if (compact.startsWith('SELECT id FROM plant_pets')) {
        return [params[0] === 9 && params[1] === 'owner-a' ? [{ id: 9 }] : []];
      }
      if (compact.startsWith('DELETE link FROM ai_message_media_links')) {
        assert.match(compact, /m\.openid = link\.openid/);
        assert.match(compact, /c\.openid = m\.openid/);
        assert.match(compact, /WHERE link\.openid = \? AND c\.plant_pet_id = \?/);
        state.links = state.links.filter(row => !matchingConversation(row, ...params));
      } else if (compact.startsWith('UPDATE ai_conversation_events ev')) {
        assert.match(compact, /c\.openid = ev\.openid/);
        assert.match(compact, /WHERE ev\.openid = \? AND c\.plant_pet_id = \?/);
        assert.match(compact, /JSON_OBJECT\('retired', TRUE, 'reason', 'plant_deleted'\)/);
        state.events.filter(row => matchingConversation(row, ...params)).forEach(row => {
          row.target_message_id = null; row.payload_json = { retired: true, reason: 'plant_deleted' };
        });
      } else if (compact.startsWith('UPDATE ai_action_proposals p')) {
        assert.match(compact, /c\.openid = p\.openid/);
        assert.match(compact, /WHERE p\.openid = \? AND \(p\.plant_pet_id = \? OR c\.plant_pet_id = \?\)/);
        assert.match(compact, /p\.status = 'expired'/);
        assert.match(compact, /p\.consumed_target_id = NULL/);
        assert.match(compact, /p\.source_user_message_id = NULL/);
        assert.match(compact, /JSON_OBJECT\('retired', TRUE, 'reason', 'plant_deleted'\)/);
        state.proposals.filter(row => row.openid === params[0] &&
          (row.plant_pet_id === params[1] || matchingConversation(row, params[0], params[2]))).forEach(row => {
          row.status = 'expired'; row.consumed_target_id = null; row.source_user_message_id = null;
          row.payload_json = { retired: true, reason: 'plant_deleted' };
        });
      } else if (compact.startsWith('SELECT facts_json FROM ai_context_memory')) return [[]];
      else if (compact.startsWith('DELETE FROM ai_conversations')) {
        state.conversations = state.conversations.filter(c => c.plant_pet_id !== params[0] || c.openid !== params[1]);
      } else if (compact.includes('FROM ai_action_proposals p')) {
        return [state.proposals.filter(row => row.openid === params[0] && row.proposal_key === params[1])];
      } else if (compact.startsWith('SELECT') || compact.startsWith('INSERT')) {
        throw new Error(`Unexpected SQL: ${compact}`);
      }
      return [{ affectedRows: 1 }];
    }
  };
  return { state, calls, db: { async getConnection() { return connection; } },
    counts: () => ({ commits, rollbacks, releases }) };
}

test('永久删除先核对JWT owner，未拥有的植宠不执行任何清理', async () => {
  const fake = deletionDb();
  const before = structuredClone(fake.state);
  const result = await deletePlantPetForUser(fake.db, 'owner-b', { plantPetId: 9, openid: 'owner-a' });
  assert.equal(result.success, false);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.state, before);
});

test('永久删除清理本植宠全部分支媒体links、脱敏事件和提案，同时保留幂等键及其他范围', async () => {
  const fake = deletionDb();
  const before = structuredClone(fake.state);
  const result = await deletePlantPetForUser(fake.db, 'owner-a', { plantPetId: 9 });
  assert.equal(result.success, true);
  assert.deepEqual(fake.counts(), { commits: 1, rollbacks: 0, releases: 1 });
  assert.deepEqual(fake.state.links.map(row => row.conversation_id), [20, 30, 40]);
  assert.deepEqual(fake.state.events.filter(row => [10, 11].includes(row.conversation_id)).map(row => row.payload_json),
    [{ retired: true, reason: 'plant_deleted' }, { retired: true, reason: 'plant_deleted' }]);
  assert.deepEqual(fake.state.events.map(row => row.event_key), before.events.map(row => row.event_key));
  assert.deepEqual(fake.state.proposals.map(row => row.proposal_key), before.proposals.map(row => row.proposal_key));
  for (const id of [10, 11, 40]) {
    const proposal = fake.state.proposals.find(row => row.conversation_id === id);
    assert.equal(proposal.status, 'expired');
    assert.equal(proposal.consumed_target_id, null);
    assert.equal(proposal.source_user_message_id, null);
    assert.deepEqual(proposal.payload_json, { retired: true, reason: 'plant_deleted' });
  }
  for (const id of [20, 30]) {
    assert.deepEqual(fake.state.events.find(row => row.conversation_id === id), before.events.find(row => row.conversation_id === id));
    assert.deepEqual(fake.state.proposals.find(row => row.conversation_id === id), before.proposals.find(row => row.conversation_id === id));
  }
  assert.deepEqual(fake.state.creationKeys, before.creationKeys);
  assert.deepEqual(fake.state.globalPreference, before.globalPreference);
  const sql = fake.calls.map(call => call.sql);
  assert.ok(sql.findIndex(q => q.startsWith('UPDATE ai_action_proposals p')) < sql.findIndex(q => q.startsWith('DELETE FROM todos')));
  assert.ok(sql.findIndex(q => q.startsWith('DELETE link')) < sql.findIndex(q => q.startsWith('DELETE aim')));
  assert.equal(sql.some(q => /^(DELETE|UPDATE|INSERT).*care_task_creation_keys/.test(q)), false);
});

test('已退休的pending或confirmed任务候选均不能重放已删除任务', async () => {
  const fake = deletionDb();
  await deletePlantPetForUser(fake.db, 'owner-a', { plantPetId: 9 });
  for (const proposalKey of ['proposal-10', 'proposal-11', 'proposal-40']) {
    const result = await confirmCareTaskProposalForUser(fake.db, 'owner-a', { proposalKey });
    assert.equal(result.success, false);
    assert.match(result.msg, /已过期/);
  }
  assert.equal(fake.calls.some(call => /SELECT task_id FROM care_task_creation_keys|INSERT INTO todos/.test(call.sql)), false);
});

test('保留的事件幂等键拒绝读取或重放已删除植宠的对话正文', async () => {
  const { findCommittedExchangeByKey } = require('../../agent-scf/lib/agent-store');
  const fake = deletionDb();
  await deletePlantPetForUser(fake.db, 'owner-a', { plantPetId: 9 });
  let reads = 0;
  const db = { async execute(sql, params) {
    assert.match(sql, /FROM ai_conversation_events/);
    reads++;
    return [fake.state.events.filter(row => row.openid === params[0] && row.event_key === params[1])];
  } };
  await assert.rejects(findCommittedExchangeByKey(db, 'owner-a', 'turn-10'), error => error.statusCode === 410);
  assert.equal(reads, 1);
});

test('删除后段失败时，媒体links、事件、提案及其他数据随同事务回滚', async () => {
  const fake = deletionDb({ failSql: 'DELETE FROM plant_pets' });
  const before = structuredClone(fake.state);
  await assert.rejects(deletePlantPetForUser(fake.db, 'owner-a', { plantPetId: 9 }), /injected deletion failure/);
  assert.deepEqual(fake.counts(), { commits: 0, rollbacks: 1, releases: 1 });
  assert.deepEqual(fake.state, before);
});
