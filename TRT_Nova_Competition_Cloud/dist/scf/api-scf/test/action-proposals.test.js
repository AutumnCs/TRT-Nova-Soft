const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  normalizeProposalKey,
  mapActionProposal,
  validateMemoryPayload,
  getActionProposalForUser,
  confirmMemoryProposalForUser,
  dismissActionProposalForUser
} = require('../lib/action-proposals');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createJwt(openid, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ openid, exp: Math.floor(Date.now() / 1000) + 600 });
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function createMemoryProposalDb(overrides = {}) {
  const state = {
    proposal: {
      proposal_key: 'memory-owner-a-001',
      openid: 'owner-a',
      proposal_type: 'memory_preference',
      plant_pet_id: null,
      payload_json: JSON.stringify({
        kind: 'preferred_name',
        value: 'Dola',
        content: '用户希望被称呼为 Dola'
      }),
      status: 'pending',
      expires_at: '2099-09-11 09:00:00',
      consumed_target_type: null,
      consumed_target_id: null,
      created_at: '2026-09-03 10:00:00',
      updated_at: '2026-09-03 10:00:00',
      ...overrides.proposal
    },
    memories: [],
    nextMemoryId: 501,
    commits: 0,
    rollbacks: 0,
    releases: 0,
    insertAttempts: 0,
    updateAttempts: 0,
    failOn: overrides.failOn || '',
    zeroOn: overrides.zeroOn || '',
    simulateExpiryRace: Boolean(overrides.simulateExpiryRace)
  };

  let transactionSnapshot = null;
  const connection = {
    async beginTransaction() {
      transactionSnapshot = clone({
        proposal: state.proposal,
        memories: state.memories,
        nextMemoryId: state.nextMemoryId
      });
    },
    async commit() {
      state.commits += 1;
      transactionSnapshot = null;
    },
    async rollback() {
      state.rollbacks += 1;
      if (transactionSnapshot) {
        state.proposal = transactionSnapshot.proposal;
        state.memories = transactionSnapshot.memories;
        state.nextMemoryId = transactionSnapshot.nextMemoryId;
      }
      transactionSnapshot = null;
    },
    release() {
      state.releases += 1;
    },
    async execute(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();

      if (compact.startsWith('SELECT proposal_key, proposal_type')) {
        const [openid, proposalKey] = params;
        if (state.proposal.openid !== openid || state.proposal.proposal_key !== proposalKey) return [[]];
        return [[{ ...state.proposal }]];
      }

      if (compact.startsWith("UPDATE ai_action_proposals SET status = 'expired'")) {
        if (state.simulateExpiryRace) {
          state.proposal.status = 'confirmed';
          state.proposal.consumed_target_type = 'ai_memory';
          state.proposal.consumed_target_id = 777;
          return [{ affectedRows: 0 }];
        }
        if (state.proposal.status !== 'pending') return [{ affectedRows: 0 }];
        state.proposal.status = 'expired';
        return [{ affectedRows: 1 }];
      }

      if (compact.startsWith('INSERT INTO ai_memories')) {
        state.insertAttempts += 1;
        if (state.failOn === 'memory-insert') throw new Error('simulated memory insert failure');
        const [openid, content, proposalKey] = params;
        let memory = state.memories.find((item) => (
          item.openid === openid && item.memory_key === 'user_preference:preferred_name'
        ));
        if (!memory) {
          memory = {
            id: state.nextMemoryId++,
            openid,
            memory_type: 'user_preference',
            memory_key: 'user_preference:preferred_name'
          };
          state.memories.push(memory);
        }
        memory.content = content;
        memory.source_type = 'agent_proposal';
        memory.source_id = proposalKey;
        memory.user_confirmed = 1;
        return [{ insertId: memory.id, affectedRows: 1 }];
      }

      if (compact.includes("SET status = 'confirmed'")) {
        state.updateAttempts += 1;
        if (state.failOn === 'proposal-confirm') throw new Error('simulated proposal update failure');
        if (state.zeroOn === 'proposal-confirm') return [{ affectedRows: 0 }];
        if (state.proposal.status !== 'pending') return [{ affectedRows: 0 }];
        state.proposal.status = 'confirmed';
        state.proposal.consumed_target_type = 'ai_memory';
        state.proposal.consumed_target_id = Number(params[0]);
        return [{ affectedRows: 1 }];
      }

      if (compact.includes("SET status = 'dismissed'")) {
        if (state.failOn === 'proposal-dismiss') throw new Error('simulated proposal dismiss failure');
        if (state.zeroOn === 'proposal-dismiss') return [{ affectedRows: 0 }];
        if (state.proposal.status !== 'pending') return [{ affectedRows: 0 }];
        state.proposal.status = 'dismissed';
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unexpected SQL in memory proposal test: ${compact}`);
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

test('proposal key 必须完整合法，不能截断后别名命中', () => {
  assert.equal(normalizeProposalKey(' memory-owner-a-001 '), 'memory-owner-a-001');
  assert.equal(normalizeProposalKey(''), '');
  assert.equal(normalizeProposalKey('bad key'), '');
  assert.equal(normalizeProposalKey("x' OR 1=1 --"), '');
  assert.equal(normalizeProposalKey('x'.repeat(129)), '');
});

test('返回对象映射 cancelled 且不暴露 owner 与内部行字段', () => {
  const mapped = mapActionProposal({
    proposal_key: 'memory-owner-a-001',
    openid: 'owner-a',
    proposal_type: 'memory_preference',
    payload_json: '{"kind":"preferred_name","value":"Dola"}',
    status: 'dismissed',
    consumed_target_type: 'ai_memory',
    consumed_target_id: 501,
    internal_secret: 'must-not-leak'
  });
  assert.deepEqual(Object.keys(mapped).sort(), [
    'consumedTargetId',
    'consumedTargetType',
    'createdAt',
    'expiresAt',
    'payload',
    'plantPetId',
    'proposalKey',
    'proposalType',
    'status',
    'updatedAt'
  ]);
  assert.equal(mapped.status, 'cancelled');
  assert.equal(mapped.consumedTargetId, 501);
  assert.equal(Object.hasOwn(mapped, 'openid'), false);
  assert.equal(Object.hasOwn(mapped, 'internal_secret'), false);
});

test('称呼候选拒绝关键词、邮箱、分隔手机号、长数字与凭证样式', () => {
  const valid = validateMemoryPayload({
    kind: 'preferred_name',
    value: 'Dola',
    content: '用户希望被称呼为 Dola'
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.content, '用户希望被称呼为Dola');

  for (const value of [
    '我的密码',
    'test@example.com',
    '138 0013 8000',
    '420106199901011234',
    'sk-abcdefghijklmnopqrstuvwx'
  ]) {
    const result = validateMemoryPayload({
      kind: 'preferred_name',
      value,
      content: `用户希望被称呼为${value}`
    });
    assert.equal(result.ok, false, `敏感称呼未阻断: ${value}`);
    assert.match(result.msg, /隐私|敏感/);
  }
});

test('查询按认证 owner 和 proposalKey 双重隔离，且类型不符不可见', async () => {
  const { db } = createMemoryProposalDb();
  const owned = await getActionProposalForUser(db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(owned.success, true);
  assert.equal(owned.proposal.status, 'pending');

  const foreign = await getActionProposalForUser(db, 'owner-b', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(foreign.success, false);
  assert.match(foreign.msg, /不存在或无权访问/);

  const wrongType = await getActionProposalForUser(db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'care_task');
  assert.equal(wrongType.success, false);
});

test('查询过期候选落 expired；并发确认胜出时重新读取 confirmed', async () => {
  const expired = createMemoryProposalDb({ proposal: { expires_at: '2000-01-01 00:00:00' } });
  const expiredResult = await getActionProposalForUser(expired.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(expiredResult.success, true);
  assert.equal(expiredResult.proposal.status, 'expired');

  const raced = createMemoryProposalDb({
    proposal: { expires_at: '2000-01-01 00:00:00' },
    simulateExpiryRace: true
  });
  const racedResult = await getActionProposalForUser(raced.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(racedResult.success, true);
  assert.equal(racedResult.proposal.status, 'confirmed');
  assert.equal(racedResult.proposal.consumedTargetId, 777);
});

test('pending→confirmed 只写已确认偏好，重复确认返回同一 memoryId', async () => {
  const { db, state } = createMemoryProposalDb();
  const first = await confirmMemoryProposalForUser(db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  });
  const second = await confirmMemoryProposalForUser(db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  });

  assert.equal(first.success, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.memoryId, 501);
  assert.equal(first.proposal.status, 'confirmed');
  assert.equal(second.success, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.memoryId, first.memoryId);
  assert.equal(state.memories.length, 1);
  assert.deepEqual(state.memories[0], {
    id: 501,
    openid: 'owner-a',
    memory_type: 'user_preference',
    memory_key: 'user_preference:preferred_name',
    content: '用户希望被称呼为Dola',
    source_type: 'agent_proposal',
    source_id: 'memory-owner-a-001',
    user_confirmed: 1
  });
  assert.equal(state.insertAttempts, 1);
  assert.equal(state.commits, 2);
  assert.equal(state.rollbacks, 0);
  assert.equal(state.releases, 2);
});

test('跨 owner、expired、dismissed 均不能确认且不写 memory', async () => {
  const foreign = createMemoryProposalDb();
  const foreignResult = await confirmMemoryProposalForUser(foreign.db, 'owner-b', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(foreignResult.success, false);
  assert.equal(foreign.state.memories.length, 0);

  const expired = createMemoryProposalDb({ proposal: { status: 'expired' } });
  const expiredResult = await confirmMemoryProposalForUser(expired.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(expiredResult.success, false);
  assert.match(expiredResult.msg, /过期/);
  assert.equal(expired.state.memories.length, 0);

  const dismissed = createMemoryProposalDb({ proposal: { status: 'dismissed' } });
  const dismissedResult = await confirmMemoryProposalForUser(dismissed.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(dismissedResult.success, false);
  assert.match(dismissedResult.msg, /取消/);
  assert.equal(dismissed.state.memories.length, 0);
});

test('dismiss pending 映射 cancelled，重复取消幂等；confirmed 不可取消', async () => {
  const pending = createMemoryProposalDb();
  const first = await dismissActionProposalForUser(pending.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  const second = await dismissActionProposalForUser(pending.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(first.success, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.proposal.status, 'cancelled');
  assert.equal(second.success, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.proposal.status, 'cancelled');

  const confirmed = createMemoryProposalDb({
    proposal: {
      status: 'confirmed',
      consumed_target_type: 'ai_memory',
      consumed_target_id: 501
    }
  });
  const result = await dismissActionProposalForUser(confirmed.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(result.success, false);
  assert.match(result.msg, /已确认.*不能取消/);
});

test('三个入口严格拒绝未知字段和客户端 owner/status/payload 注入', async () => {
  for (const operation of [
    (db, input) => getActionProposalForUser(db, 'owner-a', input, 'memory_preference'),
    (db, input) => confirmMemoryProposalForUser(db, 'owner-a', input),
    (db, input) => dismissActionProposalForUser(db, 'owner-a', input, 'memory_preference')
  ]) {
    const { db, state } = createMemoryProposalDb();
    const result = await operation(db, {
      proposalKey: 'memory-owner-a-001',
      openid: 'owner-b',
      status: 'confirmed',
      payload: { value: '被注入的称呼' },
      consumedTargetId: 999
    });
    assert.equal(result.success, false);
    assert.match(result.msg, /字段无效/);
    assert.equal(state.proposal.status, 'pending');
    assert.equal(state.memories.length, 0);
  }
});

test('确认事务任一步异常都会回滚 memory 与 proposal 状态并释放连接', async () => {
  const { db, state } = createMemoryProposalDb({ failOn: 'proposal-confirm' });
  await assert.rejects(
    confirmMemoryProposalForUser(db, 'owner-a', { proposalKey: 'memory-owner-a-001' }),
    /simulated proposal update failure/
  );
  assert.equal(state.proposal.status, 'pending');
  assert.equal(state.proposal.consumed_target_id, null);
  assert.equal(state.memories.length, 0);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});

test('确认状态 UPDATE 未命中时不能虚报成功，并回滚已写 memory', async () => {
  const confirm = createMemoryProposalDb({ zeroOn: 'proposal-confirm' });
  await assert.rejects(
    confirmMemoryProposalForUser(confirm.db, 'owner-a', { proposalKey: 'memory-owner-a-001' }),
    /状态已变化/
  );
  assert.equal(confirm.state.proposal.status, 'pending');
  assert.equal(confirm.state.memories.length, 0);
  assert.equal(confirm.state.commits, 0);
  assert.equal(confirm.state.rollbacks, 1);
});

test('取消状态 UPDATE 未命中时不能虚报 cancelled', async () => {
  const dismiss = createMemoryProposalDb({ zeroOn: 'proposal-dismiss' });
  const result = await dismissActionProposalForUser(dismiss.db, 'owner-a', {
    proposalKey: 'memory-owner-a-001'
  }, 'memory_preference');
  assert.equal(result.success, false);
  assert.match(result.msg, /状态已变化/);
  assert.equal(dismiss.state.proposal.status, 'pending');
  assert.equal(dismiss.state.commits, 1);
  assert.equal(dismiss.state.rollbacks, 0);
});

test('三条 API 路由使用 JWT owner，完成查询、确认幂等与取消状态机', async (t) => {
  const { db, state } = createMemoryProposalDb();
  const mysqlPath = require.resolve('mysql2/promise');
  const indexPath = require.resolve('../index');
  const previousMysqlCache = require.cache[mysqlPath];
  const previousEnv = {
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    ALLOW_LEGACY_OPENID_FALLBACK: process.env.ALLOW_LEGACY_OPENID_FALLBACK
  };
  const jwtSecret = 'unit-test-memory-proposal-secret';

  require.cache[mysqlPath] = {
    id: mysqlPath,
    filename: mysqlPath,
    loaded: true,
    exports: { createPool: () => db },
    children: [],
    paths: []
  };
  delete require.cache[indexPath];
  Object.assign(process.env, {
    DB_HOST: 'unit-test-db',
    DB_NAME: 'unit-test-db',
    DB_USER: 'unit-test-user',
    DB_PASSWORD: 'unit-test-password',
    JWT_SECRET: jwtSecret,
    ALLOW_LEGACY_OPENID_FALLBACK: '0'
  });

  t.after(() => {
    delete require.cache[indexPath];
    if (previousMysqlCache) require.cache[mysqlPath] = previousMysqlCache;
    else delete require.cache[mysqlPath];
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const api = require('../index');
  const token = createJwt('owner-a', jwtSecret);
  const invoke = async (path, body, accessToken = token) => {
    const response = await api.main({
      httpMethod: 'POST',
      path,
      headers: { 'x-access-token': accessToken },
      body: JSON.stringify(body)
    });
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body);
  };

  const queried = await invoke('/ai/memory-proposal', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(queried.success, true);
  assert.equal(queried.proposal.status, 'pending');

  const foreign = await invoke('/ai/memory-proposal', {
    proposalKey: 'memory-owner-a-001'
  }, createJwt('owner-b', jwtSecret));
  assert.equal(foreign.success, false);
  assert.match(foreign.msg, /不存在或无权访问/);

  const injected = await invoke('/ai/memory-proposal-confirm', {
    proposalKey: 'memory-owner-a-001',
    openid: 'owner-b',
    status: 'confirmed'
  });
  assert.equal(injected.success, false);
  assert.match(injected.msg, /字段无效/);
  assert.equal(state.proposal.status, 'pending');

  const confirmed = await invoke('/ai/memory-proposal-confirm', {
    proposalKey: 'memory-owner-a-001'
  });
  const repeated = await invoke('/ai/memory-proposal-confirm', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(confirmed.success, true);
  assert.equal(confirmed.idempotent, false);
  assert.equal(repeated.success, true);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.memoryId, confirmed.memoryId);

  const confirmedCannotDismiss = await invoke('/ai/memory-proposal-dismiss', {
    proposalKey: 'memory-owner-a-001'
  });
  assert.equal(confirmedCannotDismiss.success, false);
  assert.match(confirmedCannotDismiss.msg, /已确认.*不能取消/);

  state.proposal.proposal_key = 'memory-owner-a-002';
  state.proposal.status = 'pending';
  state.proposal.consumed_target_type = null;
  state.proposal.consumed_target_id = null;
  const dismissed = await invoke('/ai/memory-proposal-dismiss', {
    proposalKey: 'memory-owner-a-002'
  });
  assert.equal(dismissed.success, true);
  assert.equal(dismissed.proposal.status, 'cancelled');
});
