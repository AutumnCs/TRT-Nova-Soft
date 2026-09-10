const { withTransaction } = require('./care-tasks');

function parseJson(input, fallback = {}) {
  if (input && typeof input === 'object') return input;
  try { return JSON.parse(input || ''); } catch (error) { return fallback; }
}

function normalizeProposalKey(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) return '';
  return value;
}

function hasOnlyProposalKey(input = {}) {
  return Boolean(input)
    && typeof input === 'object'
    && !Array.isArray(input)
    && Object.keys(input).every((key) => key === 'proposalKey');
}

function publicStatus(status) {
  return status === 'dismissed' ? 'cancelled' : String(status || 'pending');
}

function mapActionProposal(row = {}) {
  const payload = parseJson(row.payload_json, {});
  return {
    proposalKey: row.proposal_key || '',
    proposalType: row.proposal_type || '',
    status: publicStatus(row.status),
    plantPetId: Number(row.plant_pet_id) || null,
    payload,
    expiresAt: row.expires_at || null,
    consumedTargetType: row.consumed_target_type || '',
    consumedTargetId: Number(row.consumed_target_id) || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function selectOwnedProposal(connection, openid, proposalKey, lock = false) {
  const [rows] = await connection.execute(
    `SELECT proposal_key, proposal_type, plant_pet_id, payload_json, status,
            consumed_target_type, consumed_target_id,
            DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_action_proposals
     WHERE openid = ? AND proposal_key = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [openid, proposalKey]
  );
  return rows[0] || null;
}

async function expireIfNeeded(connection, openid, row) {
  if (!row || row.status !== 'pending' || !row.expires_at) return row;
  const expiresAt = new Date(String(row.expires_at).replace(' ', 'T') + '+08:00').getTime();
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return row;
  const [updateResult] = await connection.execute(
    `UPDATE ai_action_proposals SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
    [openid, row.proposal_key]
  );
  if (Number(updateResult?.affectedRows) === 1) return { ...row, status: 'expired' };
  return await selectOwnedProposal(connection, openid, row.proposal_key, false) || row;
}

async function getActionProposalForUser(db, openid, input = {}, expectedType = '') {
  if (!hasOnlyProposalKey(input)) return { success: false, msg: '请求字段无效' };
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '候选标识无效' };
  let row = await selectOwnedProposal(db, openid, proposalKey, false);
  if (!row || (expectedType && row.proposal_type !== expectedType)) {
    return { success: false, msg: '候选不存在或无权访问' };
  }
  row = await expireIfNeeded(db, openid, row);
  return { success: true, proposal: mapActionProposal(row) };
}

function validateMemoryPayload(payload = {}) {
  const kind = String(payload.kind || '').trim();
  const value = String(payload.value || '').trim();
  const content = String(payload.content || '').trim();
  if (kind !== 'preferred_name' || !value || value.length > 32 || !content || content.length > 160) {
    return { ok: false, msg: '称呼候选内容无效' };
  }
  const combined = `${value} ${content}`;
  const compactDigits = value.replace(/\D/g, '');
  const sensitive = /(密码|口令|验证码|身份证|证件号|银行卡|信用卡|护照|手机号|电话号码|邮箱|住址|openid|token|密钥|私钥|bearer)/i.test(combined)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(combined)
    || /^1[3-9]\d{9}$/.test(compactDigits)
    || /(?:sk-|eyJ)[A-Za-z0-9._-]{12,}/.test(value)
    || /^[A-Za-z0-9_-]{24,}$/.test(value)
    || /\d{6,}/.test(value);
  if (sensitive) {
    return { ok: false, msg: '为保护隐私，不能保存这类敏感信息' };
  }
  return { ok: true, value: { kind, value, content: `用户希望被称呼为${value}` } };
}

async function confirmMemoryProposalForUser(db, openid, input = {}) {
  if (!hasOnlyProposalKey(input)) return { success: false, msg: '请求字段无效' };
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '候选标识无效' };
  return withTransaction(db, async (connection) => {
    let row = await selectOwnedProposal(connection, openid, proposalKey, true);
    if (!row || row.proposal_type !== 'memory_preference') {
      return { success: false, msg: '称呼候选不存在或无权访问' };
    }
    row = await expireIfNeeded(connection, openid, row);
    if (row.status === 'confirmed' && Number(row.consumed_target_id)) {
      return {
        success: true,
        idempotent: true,
        memoryId: Number(row.consumed_target_id),
        proposal: mapActionProposal(row)
      };
    }
    if (row.status !== 'pending') return { success: false, msg: row.status === 'expired' ? '称呼候选已过期' : '称呼候选已取消' };
    const validated = validateMemoryPayload(parseJson(row.payload_json, {}));
    if (!validated.ok) return { success: false, msg: validated.msg };
    const value = validated.value;
    const [insert] = await connection.execute(
      `INSERT INTO ai_memories
        (openid, plant_pet_id, memory_type, memory_key, content, source_type, source_id,
         source_time, user_confirmed, created_at, updated_at)
       VALUES (?, NULL, 'user_preference', 'user_preference:preferred_name', ?,
               'agent_proposal', ?, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id), content = VALUES(content), source_type = VALUES(source_type),
         source_id = VALUES(source_id), source_time = VALUES(source_time),
         user_confirmed = 1, updated_at = CURRENT_TIMESTAMP`,
      [openid, value.content, proposalKey]
    );
    const memoryId = Number(insert.insertId) || 0;
    const [proposalUpdate] = await connection.execute(
      `UPDATE ai_action_proposals
       SET status = 'confirmed', consumed_target_type = 'ai_memory', consumed_target_id = ?,
           confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
      [memoryId, openid, proposalKey]
    );
    if (Number(proposalUpdate?.affectedRows) !== 1) {
      throw new Error('称呼候选状态已变化，确认未完成');
    }
    const confirmed = await selectOwnedProposal(connection, openid, proposalKey, false);
    return { success: true, idempotent: false, memoryId, proposal: mapActionProposal(confirmed) };
  });
}

async function dismissActionProposalForUser(db, openid, input = {}, expectedType = '') {
  if (!hasOnlyProposalKey(input)) return { success: false, msg: '请求字段无效' };
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '候选标识无效' };
  return withTransaction(db, async (connection) => {
    let row = await selectOwnedProposal(connection, openid, proposalKey, true);
    if (!row || (expectedType && row.proposal_type !== expectedType)) {
      return { success: false, msg: '候选不存在或无权访问' };
    }
    row = await expireIfNeeded(connection, openid, row);
    if (row.status === 'dismissed') return { success: true, idempotent: true, proposal: mapActionProposal(row) };
    if (row.status !== 'pending') return { success: false, msg: row.status === 'confirmed' ? '已确认候选不能取消' : '候选已过期' };
    const [proposalUpdate] = await connection.execute(
      `UPDATE ai_action_proposals
       SET status = 'dismissed', dismissed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
      [openid, proposalKey]
    );
    if (Number(proposalUpdate?.affectedRows) !== 1) {
      return { success: false, msg: '候选状态已变化，请重新加载' };
    }
    return {
      success: true,
      idempotent: false,
      proposal: mapActionProposal({ ...row, status: 'dismissed' })
    };
  });
}

module.exports = {
  parseJson,
  normalizeProposalKey,
  hasOnlyProposalKey,
  publicStatus,
  mapActionProposal,
  selectOwnedProposal,
  getActionProposalForUser,
  validateMemoryPayload,
  confirmMemoryProposalForUser,
  dismissActionProposalForUser
};
