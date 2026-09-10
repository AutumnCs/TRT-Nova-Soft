const {
  TASK_TYPES,
  RECURRENCE_TYPES,
  validateTaskInput,
  insertCareTaskRecord,
  getCareTaskForUser,
  withTransaction
} = require('./care-tasks');

const CARE_TASK_PROPOSAL_TYPES = new Set(['care_task', 'propose_care_task']);
const CONFIRM_EDITABLE_FIELDS = new Set([
  'proposalKey',
  'plantPetId',
  'taskType',
  'title',
  'description',
  'scheduledFor',
  'reminderTime',
  'recurrenceType',
  'recurrenceInterval'
]);

const PROPOSAL_SELECT = `
  SELECT p.id, p.proposal_key, p.openid, p.conversation_id,
         p.source_user_message_id, p.source_assistant_message_id,
         p.plant_pet_id, p.proposal_type, p.payload_json, p.status,
         p.consumed_target_type, p.consumed_target_id,
         DATE_FORMAT(p.expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
         DATE_FORMAT(p.confirmed_at, '%Y-%m-%d %H:%i:%s') AS confirmed_at,
         DATE_FORMAT(p.dismissed_at, '%Y-%m-%d %H:%i:%s') AS dismissed_at,
         DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         pp.nickname AS plant_pet_name, pp.status AS plant_pet_status
  FROM ai_action_proposals p
  INNER JOIN ai_conversations c
    ON c.id = p.conversation_id AND c.openid = p.openid
  LEFT JOIN plant_pets pp
    ON pp.id = p.plant_pet_id AND pp.openid = p.openid
`;

function hasOwn(input, key) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function normalizeProposalKey(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) return '';
  return value;
}

function parsePayloadJson(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string' || !input.trim()) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function normalizeTaskProposalStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'dismissed' || value === 'cancelled') return 'cancelled';
  if (value === 'pending' || value === 'confirmed' || value === 'expired') return value;
  return 'unavailable';
}

function extractTaskPayload(input = {}) {
  const payload = parsePayloadJson(input);
  const source = payload.task && typeof payload.task === 'object' && !Array.isArray(payload.task)
    ? payload.task
    : payload;
  const reminderTime = hasOwn(source, 'reminderTime')
    ? source.reminderTime
    : (hasOwn(source, 'reminder_time') ? source.reminder_time : '09:00');
  return {
    taskType: source.taskType || source.task_type || source.action || 'inspection',
    title: source.title || '',
    description: source.description || source.descriptionText || source.description_text || '',
    scheduledFor: source.scheduledFor || source.scheduled_for || source.date || '',
    reminderTime,
    recurrenceType: source.recurrenceType || source.recurrence_type || 'none',
    recurrenceInterval: Number(source.recurrenceInterval || source.recurrence_interval) || 1
  };
}

function mapCareTaskProposalRow(row = {}) {
  const status = normalizeTaskProposalStatus(row.status);
  const plantPetId = Number(row.plant_pet_id || row.plantPetId) || 0;
  return {
    proposalKey: row.proposal_key || row.proposalKey || '',
    proposalType: row.proposal_type || row.proposalType || '',
    conversationId: Number(row.conversation_id || row.conversationId) || 0,
    plantPetId,
    plantPetName: row.plant_pet_name || row.plantPetName || '',
    payload: {
      ...extractTaskPayload(row.payload_json ?? row.payload),
      plantPetId
    },
    status,
    expiresAt: row.expires_at || row.expiresAt || '',
    consumedTaskId: Number(row.consumed_target_id || row.consumedTaskId) || 0,
    canConfirm: status === 'pending'
  };
}

function validateConfirmFields(input = {}) {
  const unknown = Object.keys(input).filter((key) => !CONFIRM_EDITABLE_FIELDS.has(key));
  if (unknown.length) return { ok: false, msg: '任务候选确认字段无效' };
  return { ok: true };
}

function buildConfirmedTaskInput(row = {}, input = {}) {
  const fields = validateConfirmFields(input);
  if (!fields.ok) return fields;

  const plantPetId = Number(row.plant_pet_id || row.plantPetId) || 0;
  if (!plantPetId) return { ok: false, msg: '任务候选没有关联有效植宠' };
  if (hasOwn(input, 'plantPetId') && Number(input.plantPetId) !== plantPetId) {
    return { ok: false, msg: 'AI 任务候选不能更换植宠' };
  }

  const base = extractTaskPayload(row.payload_json ?? row.payload);
  const taskInput = {
    ...base,
    plantPetId,
    source: 'ai',
    confirmed: true
  };
  for (const key of ['taskType', 'title', 'description', 'scheduledFor', 'reminderTime', 'recurrenceType', 'recurrenceInterval']) {
    if (hasOwn(input, key)) taskInput[key] = input[key];
  }

  const validated = validateTaskInput(taskInput);
  if (!validated.ok) return validated;
  if (!TASK_TYPES.has(validated.value.taskType) || !RECURRENCE_TYPES.has(validated.value.recurrenceType)) {
    return { ok: false, msg: '任务候选字段无效' };
  }
  return validated;
}

async function expireProposalIfNeeded(db, openid, proposalKey) {
  await db.execute(
    `UPDATE ai_action_proposals
     SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE openid = ? AND proposal_key = ? AND status = 'pending'
       AND expires_at <= CURRENT_TIMESTAMP`,
    [openid, proposalKey]
  );
}

async function loadProposalRow(db, openid, proposalKey, options = {}) {
  await expireProposalIfNeeded(db, openid, proposalKey);
  const [rows] = await db.execute(
    `${PROPOSAL_SELECT}
     WHERE p.openid = ? AND p.proposal_key = ?
     LIMIT 1${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [openid, proposalKey]
  );
  const row = rows[0] || null;
  if (!row || !CARE_TASK_PROPOSAL_TYPES.has(String(row.proposal_type || '').toLowerCase())) return null;
  return row;
}

function proposalNotFound() {
  return { success: false, msg: '任务候选不存在或无权访问' };
}

async function getCareTaskProposalForUser(db, openid, input = {}) {
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '任务候选标识无效' };
  const row = await loadProposalRow(db, openid, proposalKey);
  if (!row) return proposalNotFound();
  return { success: true, proposal: mapCareTaskProposalRow(row) };
}

async function cancelCareTaskProposalForUser(db, openid, input = {}) {
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '任务候选标识无效' };

  const outcome = await withTransaction(db, async (connection) => {
    const row = await loadProposalRow(connection, openid, proposalKey, { forUpdate: true });
    if (!row) return proposalNotFound();
    const status = normalizeTaskProposalStatus(row.status);
    if (status === 'cancelled') return { success: true };
    if (status === 'confirmed') return { success: false, msg: '任务候选已确认，不能取消' };
    if (status === 'expired') return { success: false, msg: '任务候选已过期' };
    if (status !== 'pending') return { success: false, msg: '任务候选当前不可取消' };

    const [result] = await connection.execute(
      `UPDATE ai_action_proposals
       SET status = 'dismissed', dismissed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
      [openid, proposalKey]
    );
    if (Number(result.affectedRows) !== 1) return { success: false, msg: '任务候选状态已变化，请重新加载' };
    return { success: true };
  });
  if (!outcome.success) return outcome;
  return getCareTaskProposalForUser(db, openid, { proposalKey });
}

async function findCreationTaskId(db, openid, proposalKey, forUpdate = false) {
  const [rows] = await db.execute(
    `SELECT task_id FROM care_task_creation_keys
     WHERE openid = ? AND idempotency_key = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [openid, proposalKey]
  );
  return Number(rows[0]?.task_id) || 0;
}

async function confirmCareTaskProposalForUser(db, openid, input = {}) {
  const proposalKey = normalizeProposalKey(input.proposalKey);
  if (!proposalKey) return { success: false, msg: '任务候选标识无效' };

  const outcome = await withTransaction(db, async (connection) => {
    const row = await loadProposalRow(connection, openid, proposalKey, { forUpdate: true });
    if (!row) return proposalNotFound();
    const status = normalizeTaskProposalStatus(row.status);

    if (status === 'cancelled') return { success: false, msg: '任务候选已取消' };
    if (status === 'expired') return { success: false, msg: '任务候选已过期' };
    if (status !== 'pending' && status !== 'confirmed') {
      return { success: false, msg: '任务候选当前不可确认' };
    }

    let taskId = Number(row.consumed_target_id) || 0;
    if (!taskId) taskId = await findCreationTaskId(connection, openid, proposalKey, true);
    if (status === 'confirmed') {
      if (!taskId) return { success: false, msg: '已确认任务记录不完整，请联系管理员' };
      return { success: true, taskId, idempotent: true };
    }

    const confirmed = buildConfirmedTaskInput(row, input);
    if (!confirmed.ok) return { success: false, msg: confirmed.msg };

    const [plantRows] = await connection.execute(
      `SELECT id FROM plant_pets
       WHERE id = ? AND openid = ? AND status = 'active'
       LIMIT 1 FOR UPDATE`,
      [confirmed.value.plantPetId, openid]
    );
    if (!plantRows.length) return { success: false, msg: '植宠不存在、已归档或无权访问' };

    if (taskId) {
      await connection.execute(
        `UPDATE ai_action_proposals
         SET status = 'confirmed', consumed_target_type = 'care_task', consumed_target_id = ?,
             confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
        [taskId, openid, proposalKey]
      );
      return { success: true, taskId, idempotent: true };
    }

    taskId = await insertCareTaskRecord(connection, openid, confirmed.value);
    if (!taskId) throw new Error('任务创建失败：未返回任务标识');

    await connection.execute(
      `INSERT INTO care_task_creation_keys
        (openid, idempotency_key, task_id, source, created_at)
       VALUES (?, ?, ?, 'ai_proposal', CURRENT_TIMESTAMP)`,
      [openid, proposalKey, taskId]
    );
    const [updated] = await connection.execute(
      `UPDATE ai_action_proposals
       SET status = 'confirmed', consumed_target_type = 'care_task', consumed_target_id = ?,
           confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE openid = ? AND proposal_key = ? AND status = 'pending'`,
      [taskId, openid, proposalKey]
    );
    if (Number(updated.affectedRows) !== 1) throw new Error('任务候选状态已变化');
    return { success: true, taskId, idempotent: false };
  });

  if (!outcome.success) return outcome;
  const task = await getCareTaskForUser(db, openid, { taskId: outcome.taskId });
  if (!task.success) return task;
  return {
    success: true,
    task: task.task,
    proposal: {
      proposalKey,
      status: 'confirmed',
      consumedTaskId: outcome.taskId,
      idempotent: Boolean(outcome.idempotent)
    }
  };
}

module.exports = {
  CARE_TASK_PROPOSAL_TYPES,
  CONFIRM_EDITABLE_FIELDS,
  PROPOSAL_SELECT,
  normalizeProposalKey,
  parsePayloadJson,
  normalizeTaskProposalStatus,
  extractTaskPayload,
  mapCareTaskProposalRow,
  validateConfirmFields,
  buildConfirmedTaskInput,
  getCareTaskProposalForUser,
  cancelCareTaskProposalForUser,
  confirmCareTaskProposalForUser
};
