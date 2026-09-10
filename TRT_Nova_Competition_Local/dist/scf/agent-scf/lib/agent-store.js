const crypto = require('crypto');

const MAX_RECENT_MESSAGES = 40;
const MAX_CONVERSATIONS_PER_PLANT = 30;

function normalizeSessionKey(input) {
  const value = String(input || 'assistant_global').trim().replace(/[^a-z0-9_.:-]/gi, '_');
  return (value || 'assistant_global').slice(0, 128);
}

function parseJson(input, fallback) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  try { return JSON.parse(input); } catch (err) { return fallback; }
}

function normalizeConversationTitle(input, fallback = '新对话') {
  const value = String(input || '')
    .replace(/\[[^\]]{1,80}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return fallback;
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

function mapConversation(row = {}) {
  return {
    id: Number(row.id) || 0,
    sessionId: row.session_key || '',
    plantPetId: Number(row.plant_pet_id) || null,
    title: normalizeConversationTitle(row.title, '新对话'),
    messageCount: Number(row.message_count) || 0,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapMemory(row = {}) {
  return {
    id: Number(row.id) || 0,
    plantPetId: Number(row.plant_pet_id) || null,
    type: row.memory_type || '',
    key: row.memory_key || '',
    content: row.content || '',
    sourceType: row.source_type || '',
    sourceId: row.source_id || '',
    sourceTime: row.source_time || null,
    userConfirmed: row.user_confirmed === true || Number(row.user_confirmed) === 1,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function getOrCreateConversation(db, openid, sessionId, plantPetId = null) {
  const sessionKey = normalizeSessionKey(sessionId);
  const normalizedPlantPetId = Number(plantPetId) || null;
  await db.execute(
    `INSERT IGNORE INTO ai_conversations (openid, session_key, plant_pet_id, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    [openid, sessionKey, normalizedPlantPetId]
  );
  const [rows] = await db.execute(
    `SELECT id, session_key, plant_pet_id, title,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_conversations WHERE openid = ? AND session_key = ? LIMIT 1`,
    [openid, sessionKey]
  );
  const conversation = rows[0] || null;
  if (conversation && (Number(conversation.plant_pet_id) || 0) !== (normalizedPlantPetId || 0)) {
    const error = new Error('会话与当前植宠不匹配');
    error.statusCode = 409;
    throw error;
  }
  return conversation;
}

async function getOwnedConversation(db, openid, sessionId) {
  const sessionKey = normalizeSessionKey(sessionId);
  const [rows] = await db.execute(
    `SELECT id, session_key, plant_pet_id, title,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_conversations WHERE openid = ? AND session_key = ? LIMIT 1`,
    [openid, sessionKey]
  );
  return rows[0] || null;
}

function createSessionKey(plantPetId = null) {
  const scope = Number(plantPetId) || 'global';
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : crypto.randomBytes(5).toString('hex');
  return normalizeSessionKey(`assistant_plant_${scope}_${Date.now().toString(36)}_${suffix}`);
}

async function createConversation(db, openid, plantPetId = null, title = '新对话') {
  const sessionKey = createSessionKey(plantPetId);
  await db.execute(
    `INSERT INTO ai_conversations
      (openid, session_key, plant_pet_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [openid, sessionKey, Number(plantPetId) || null, normalizeConversationTitle(title)]
  );
  return getOwnedConversation(db, openid, sessionKey);
}

async function listConversations(db, openid, plantPetId = null) {
  const normalizedPlantPetId = Number(plantPetId) || 0;
  const scopeClause = normalizedPlantPetId ? 'c.plant_pet_id = ?' : 'c.plant_pet_id IS NULL';
  const params = normalizedPlantPetId ? [openid, normalizedPlantPetId] : [openid];
  const [rows] = await db.execute(
    `SELECT c.id, c.session_key, c.plant_pet_id, c.title,
            COUNT(m.id) AS message_count,
            DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(c.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_conversations c
     LEFT JOIN ai_messages m ON m.conversation_id = c.id AND m.openid = c.openid
     WHERE c.openid = ? AND ${scopeClause}
     GROUP BY c.id, c.session_key, c.plant_pet_id, c.title, c.created_at, c.updated_at
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${MAX_CONVERSATIONS_PER_PLANT}`,
    params
  );
  return rows.map(mapConversation);
}

async function updateConversationTitleFromMessage(db, openid, conversationId, message) {
  const title = normalizeConversationTitle(message);
  await db.execute(
    `UPDATE ai_conversations
     SET title = CASE
       WHEN title IS NULL OR title = '' OR title IN ('新对话', 'NOVA Conversation') THEN ?
       ELSE title END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND openid = ?`,
    [title, Number(conversationId) || 0, openid]
  );
  return title;
}

async function deleteConversationMediaForMessages(db, openid, rows = []) {
  const messageIds = (Array.isArray(rows) ? rows : [])
    .map((row) => String(Number(row.id) || ''))
    .filter(Boolean);
  if (!messageIds.length) return 0;
  const messagePlaceholders = messageIds.map(() => '?').join(', ');
  const [linkedResult] = await db.execute(
    `SELECT DISTINCT file_id FROM ai_message_media_links
     WHERE openid = ? AND message_id IN (${messagePlaceholders})`,
    [openid, ...messageIds]
  );
  const linkedRows = Array.isArray(linkedResult) ? linkedResult : [];
  const linkedFileIds = linkedRows.map((row) => String(row.file_id || '').trim()).filter(Boolean);
  await db.execute(
    `DELETE FROM ai_message_media_links
     WHERE openid = ? AND message_id IN (${messagePlaceholders})`,
    [openid, ...messageIds]
  );
  const fileClause = linkedFileIds.length
    ? ` OR file_id IN (${linkedFileIds.map(() => '?').join(', ')})`
    : '';
  const [result] = await db.execute(
    `DELETE FROM media_objects
     WHERE openid = ?
       AND ((reference_type = 'ai_message' AND reference_key IN (${messagePlaceholders}))${fileClause})
       AND NOT EXISTS (
         SELECT 1 FROM ai_message_media_links AS link
         WHERE link.openid = media_objects.openid AND link.file_id = media_objects.file_id
       )`,
    [openid, ...messageIds, ...linkedFileIds]
  );
  return Number(result?.affectedRows) || 0;
}

async function retireConversationArtifactsForMessages(db, openid, rows = []) {
  const messageIds = (Array.isArray(rows) ? rows : [])
    .map((row) => Number(row.id) || 0)
    .filter(Boolean);
  if (!messageIds.length) return;
  const placeholders = messageIds.map(() => '?').join(', ');

  // Proposals may outlive their source message (for example an already
  // confirmed task), but they must not keep dangling message references. A
  // pending proposal is no longer actionable once its source turn is pruned.
  await db.execute(
    `UPDATE ai_action_proposals
     SET source_user_message_id = CASE
           WHEN source_user_message_id IN (${placeholders}) THEN NULL
           ELSE source_user_message_id END,
         source_assistant_message_id = CASE
           WHEN source_assistant_message_id IN (${placeholders}) THEN NULL
           ELSE source_assistant_message_id END,
         status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
     WHERE openid = ?
       AND (source_user_message_id IN (${placeholders})
         OR source_assistant_message_id IN (${placeholders}))`,
    [
      ...messageIds,
      ...messageIds,
      openid,
      ...messageIds,
      ...messageIds
    ]
  );

  // Keep event_key as an idempotency tombstone, while removing copied answer
  // text and message references. A late retry receives 410 instead of
  // resurrecting content that the retention policy already removed.
  await db.execute(
    `UPDATE ai_conversation_events
     SET target_message_id = NULL,
         payload_json = JSON_OBJECT('retired', TRUE, 'reason', 'message_retention')
     WHERE openid = ? AND target_message_id IN (${placeholders})`,
    [openid, ...messageIds]
  );
}

function collectExchangeMediaFileIds(options = {}) {
  const fileIds = new Set(
    (Array.isArray(options.mediaFileIds) ? options.mediaFileIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const attachmentFileId = String(options.userResponse?.attachment?.mediaFileId || '').trim();
  if (attachmentFileId) fileIds.add(attachmentFileId);
  return Array.from(fileIds).slice(0, 8);
}

async function linkMessageMedia(db, openid, messageId, fileIds = []) {
  const normalizedMessageId = Number(messageId) || 0;
  const normalizedFileIds = Array.from(new Set(
    (Array.isArray(fileIds) ? fileIds : [fileIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )).slice(0, 8);
  if (!normalizedMessageId || !normalizedFileIds.length) return 0;
  const values = normalizedFileIds.map(() => '(?, ?, ?, CURRENT_TIMESTAMP)').join(', ');
  const params = normalizedFileIds.flatMap((fileId) => [normalizedMessageId, openid, fileId]);
  const [result] = await db.execute(
    `INSERT IGNORE INTO ai_message_media_links (message_id, openid, file_id, created_at)
     VALUES ${values}`,
    params
  );
  return Number(result?.affectedRows) || 0;
}

async function copyMessageMediaLinks(db, openid, sourceMessageId, targetMessageId) {
  const sourceId = Number(sourceMessageId) || 0;
  const targetId = Number(targetMessageId) || 0;
  if (!sourceId || !targetId) return 0;
  const [result] = await db.execute(
    `INSERT IGNORE INTO ai_message_media_links (message_id, openid, file_id, created_at)
     SELECT ?, openid, file_id, CURRENT_TIMESTAMP
     FROM ai_message_media_links
     WHERE openid = ? AND message_id = ?`,
    [targetId, openid, sourceId]
  );
  return Number(result?.affectedRows) || 0;
}

async function pruneMessages(db, openid, conversationId) {
  // Compatibility hook only. Pagination and model context limits are NOT a retention policy.
  // Raw exchanges and their media survive until an explicit user deletion.
  return 0;
}

async function listRecentMessages(db, openid, conversationId, options = {}) {
  const beforeMessageId = Math.max(0, Number(options.beforeMessageId) || 0);
  const [rows] = await db.execute(
    `SELECT id, role, content, response_json,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ai_messages
     WHERE conversation_id = ? AND openid = ? ${beforeMessageId ? 'AND id < ?' : ''}
     ORDER BY id DESC LIMIT ${MAX_RECENT_MESSAGES}`,
    [conversationId, openid, ...(beforeMessageId ? [beforeMessageId] : [])]
  );
  const messages = rows.reverse().map((row) => ({
    id: Number(row.id) || 0,
    role: row.role || '',
    content: row.content || '',
    response: parseJson(row.response_json, null),
    createdAt: row.created_at || null
  }));
  if (options.hydrateProposals !== true) return messages;

  const sourceUserMessageIds = messages
    .filter((message) => message.role === 'user' && message.id)
    .map((message) => message.id);
  const proposalRows = await listProposalsForMessages(
    db,
    openid,
    conversationId,
    sourceUserMessageIds
  );
  const proposalsByUserMessage = new Map();
  proposalRows.forEach((proposal) => {
    const rowsForMessage = proposalsByUserMessage.get(proposal.sourceUserMessageId) || [];
    rowsForMessage.push(proposal);
    proposalsByUserMessage.set(proposal.sourceUserMessageId, rowsForMessage);
  });
  let activeUserMessageId = 0;
  return messages.map((message) => {
    if (message.role === 'user') {
      activeUserMessageId = message.id;
      return message;
    }
    if (message.role !== 'assistant' || !message.response || !activeUserMessageId) return message;
    return {
      ...message,
      response: hydrateProposalStatus(
        message.response,
        proposalsByUserMessage.get(activeUserMessageId) || []
      )
    };
  });
}

async function saveExchange(db, openid, conversationId, userText, assistantText, response = {}, options = {}) {
  if (options.clientTurnKey || Object.prototype.hasOwnProperty.call(options, 'proposals')) {
    return saveExchangeWithProposals(
      db,
      openid,
      conversationId,
      userText,
      assistantText,
      response,
      options
    );
  }
  const userResponse = options.userResponse && typeof options.userResponse === 'object'
    ? JSON.stringify(options.userResponse)
    : null;
  const [insertResult] = await db.execute(
    `INSERT INTO ai_messages (conversation_id, openid, role, content, response_json, created_at)
     VALUES (?, ?, 'user', ?, ?, CURRENT_TIMESTAMP),
            (?, ?, 'assistant', ?, ?, CURRENT_TIMESTAMP)`,
    [conversationId, openid, userText, userResponse, conversationId, openid, assistantText, JSON.stringify(response)]
  );
  await updateConversationTitleFromMessage(db, openid, conversationId, userText);
  await pruneMessages(db, openid, conversationId);
  const userMessageId = Number(insertResult?.insertId) || 0;
  await linkMessageMedia(db, openid, userMessageId, collectExchangeMediaFileIds(options));
  return {
    userMessageId,
    assistantMessageId: userMessageId ? userMessageId + 1 : 0
  };
}

function normalizeClientTurnKey(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.length > 128) {
    const error = new Error('clientTurnKey 长度不能超过 128 个字符');
    error.code = 'INVALID_CLIENT_TURN_KEY';
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function createProposalKey(input = {}) {
  const fingerprint = [
    input.openid,
    input.conversationId,
    input.sourceUserMessageId,
    input.proposalType,
    input.index,
    input.clientTurnKey
  ].map((value) => String(value ?? '')).join('\n');
  return `proposal_${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 48)}`;
}

function mapProposal(row = {}) {
  const storedStatus = row.status || 'pending';
  return {
    id: Number(row.id) || 0,
    proposalKey: row.proposal_key || row.proposalKey || '',
    conversationId: Number(row.conversation_id ?? row.conversationId) || 0,
    sourceUserMessageId: Number(row.source_user_message_id ?? row.sourceUserMessageId) || 0,
    sourceAssistantMessageId: Number(row.source_assistant_message_id ?? row.sourceAssistantMessageId) || 0,
    plantPetId: Number(row.plant_pet_id ?? row.plantPetId) || null,
    proposalType: row.proposal_type || row.proposalType || '',
    payload: row.payload !== undefined ? row.payload : parseJson(row.payload_json, {}),
    status: storedStatus === 'dismissed' ? 'cancelled' : storedStatus,
    expiresAt: row.expires_at || row.expiresAt || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null
  };
}

function normalizeProposalExpiresAt(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  // MySQL DATETIME has no timezone marker. ISO T/Z values are intentionally
  // not passed through: those use the database-side 24 hour default below.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return value;
}

async function appendConversationEvent(db, openid, conversationId, input = {}) {
  const eventType = String(input.eventType || '').trim().slice(0, 32);
  if (!eventType) {
    const error = new Error('eventType 不能为空');
    error.code = 'INVALID_CONVERSATION_EVENT';
    throw error;
  }
  const eventKey = input.eventKey === undefined || input.eventKey === null
    ? null
    : normalizeClientTurnKey(input.eventKey) || null;
  const actor = ['user', 'assistant', 'system'].includes(input.actor) ? input.actor : 'system';
  const targetMessageId = Number(input.targetMessageId) || null;
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const [result] = await db.execute(
    `INSERT INTO ai_conversation_events
      (openid, conversation_id, event_type, event_key, actor, target_message_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      openid,
      Number(conversationId) || 0,
      eventType,
      eventKey,
      actor,
      targetMessageId,
      JSON.stringify(payload)
    ]
  );
  return Number(result?.insertId) || 0;
}

async function listConversationEvents(db, openid, conversationId, limit = 200) {
  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const [rows] = await db.execute(
    `SELECT recent.id, recent.event_type, recent.event_key, recent.actor,
            recent.target_message_id, recent.payload_json, recent.created_at
     FROM (
       SELECT id, event_type, event_key, actor, target_message_id, payload_json,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM ai_conversation_events
       WHERE openid = ? AND conversation_id = ?
       ORDER BY id DESC LIMIT ${boundedLimit}
     ) AS recent
     ORDER BY recent.id ASC`,
    [openid, Number(conversationId) || 0]
  );
  return rows.map((row) => ({
    id: Number(row.id) || 0,
    type: row.event_type || '',
    eventKey: row.event_key || '',
    actor: row.actor || 'system',
    targetMessageId: Number(row.target_message_id) || null,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at || null
  }));
}

async function listProposalsForExchange(db, openid, conversationId, sourceUserMessageId) {
  const [rows] = await db.execute(
    `SELECT id, proposal_key, conversation_id, source_user_message_id,
            source_assistant_message_id, plant_pet_id, proposal_type, payload_json,
            status,
            DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_action_proposals
     WHERE openid = ? AND conversation_id = ? AND source_user_message_id = ?
     ORDER BY id ASC`,
    [openid, Number(conversationId) || 0, Number(sourceUserMessageId) || 0]
  );
  return rows.map(mapProposal);
}

async function listProposalsForMessages(db, openid, conversationId, sourceUserMessageIds = []) {
  const ids = [...new Set((Array.isArray(sourceUserMessageIds) ? sourceUserMessageIds : [])
    .map((id) => Number(id) || 0)
    .filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT id, proposal_key, conversation_id, source_user_message_id,
            source_assistant_message_id, plant_pet_id, proposal_type, payload_json,
            CASE
              WHEN status = 'pending' AND expires_at <= CURRENT_TIMESTAMP THEN 'expired'
              ELSE status
            END AS status,
            DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expires_at,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_action_proposals
     WHERE openid = ? AND conversation_id = ?
       AND source_user_message_id IN (${placeholders})
     ORDER BY id ASC`,
    [openid, Number(conversationId) || 0, ...ids]
  );
  return (Array.isArray(rows) ? rows : []).map(mapProposal);
}

async function persistProposals(db, input = {}) {
  const proposals = Array.isArray(input.proposals) ? input.proposals : [];
  for (let index = 0; index < proposals.length; index += 1) {
    const proposal = proposals[index] && typeof proposals[index] === 'object' ? proposals[index] : {};
    const proposalType = String(
      proposal.proposalType || proposal.type || (proposal.taskType ? 'care_task' : '')
    ).trim().slice(0, 32);
    if (!proposalType) continue;
    const proposalKey = String(proposal.proposalKey || createProposalKey({
      openid: input.openid,
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      proposalType,
      index,
      clientTurnKey: input.clientTurnKey
    })).slice(0, 128);
    const proposalPayload = proposal.payload && typeof proposal.payload === 'object'
      ? proposal.payload
      : proposal;
    const payload = {
      ...proposalPayload,
      sourceUserMessageId: Number(input.sourceUserMessageId) || 0,
      sourceAssistantMessageId: Number(input.sourceAssistantMessageId) || 0
    };
    await db.execute(
      `INSERT INTO ai_action_proposals
        (proposal_key, openid, conversation_id, source_user_message_id,
         source_assistant_message_id, plant_pet_id, proposal_type, payload_json,
         status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending',
               COALESCE(?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)),
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        proposalKey,
        input.openid,
        Number(input.conversationId) || 0,
        Number(input.sourceUserMessageId) || 0,
        Number(input.sourceAssistantMessageId) || 0,
        Number(proposal.plantPetId ?? input.plantPetId) || null,
        proposalType,
        JSON.stringify(payload),
        normalizeProposalExpiresAt(proposal.expiresAt || input.expiresAt)
      ]
    );
  }
  return listProposalsForExchange(
    db,
    input.openid,
    input.conversationId,
    input.sourceUserMessageId
  );
}

function hydrateProposalStatus(response = {}, proposals = []) {
  const source = response && typeof response === 'object' ? response : {};
  const rows = Array.isArray(proposals) ? proposals.map(mapProposal) : [];
  const hydrated = { ...source };
  if (Array.isArray(source.taskSuggestions)) {
    hydrated.taskSuggestions = source.taskSuggestions.map((suggestion, index) => {
      const proposal = rows.find((item) => item.proposalKey === suggestion?.proposalKey)
        || rows.filter((item) => item.proposalType === 'care_task')[index];
      if (!proposal) return { ...suggestion };
      return {
        ...suggestion,
        proposalId: proposal.id,
        proposalKey: proposal.proposalKey,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        proposalStatus: proposal.status,
        proposalExpiresAt: proposal.expiresAt
      };
    });
  }
  if (Array.isArray(source.memorySuggestions)) {
    hydrated.memorySuggestions = source.memorySuggestions.map((suggestion, index) => {
      const proposal = rows.find((item) => item.proposalKey === suggestion?.proposalKey)
        || rows.filter((item) => item.proposalType === 'memory_preference')[index];
      if (!proposal) return { ...suggestion };
      return {
        ...suggestion,
        proposalId: proposal.id,
        proposalKey: proposal.proposalKey,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        proposalStatus: proposal.status,
        proposalExpiresAt: proposal.expiresAt
      };
    });
  }
  hydrated.actionProposals = rows.map((proposal) => ({
    id: proposal.id,
    proposalKey: proposal.proposalKey,
    proposalType: proposal.proposalType,
    status: proposal.status,
    expiresAt: proposal.expiresAt
  }));
  return hydrated;
}

function createClientTurnUnavailableError(reason = 'withdrawn') {
  const retiredByRetention = reason === 'message_retention';
  const error = new Error(retiredByRetention
    ? '该请求对应的会话内容已按保留策略清理，请重新发送'
    : '该请求对应的会话轮次已经撤回，请重新发送');
  error.code = retiredByRetention ? 'CLIENT_TURN_KEY_RETIRED' : 'CLIENT_TURN_KEY_WITHDRAWN';
  error.statusCode = 410;
  return error;
}

async function findCommittedExchangeByKey(db, openid, eventKey) {
  const normalizedEventKey = normalizeClientTurnKey(eventKey);
  if (!normalizedEventKey) return null;
  const [eventRows] = await db.execute(
    `SELECT id, conversation_id, target_message_id, payload_json,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ai_conversation_events
     WHERE openid = ? AND event_key = ? AND event_type = 'turn_committed'
     LIMIT 1`,
    [openid, normalizedEventKey]
  );
  const event = eventRows[0];
  if (!event) return null;
  const payload = parseJson(event.payload_json, {});
  if (payload.retired) throw createClientTurnUnavailableError(payload.reason);
  const userMessageId = Number(payload.sourceUserMessageId || event.target_message_id) || 0;
  const assistantMessageId = Number(payload.sourceAssistantMessageId) || 0;
  if (!userMessageId || !assistantMessageId) throw createClientTurnUnavailableError('message_retention');
  const [withdrawnRows] = await db.execute(
    `SELECT id FROM ai_conversation_events
     WHERE openid = ? AND conversation_id = ? AND event_type = 'exchange_withdrawn'
       AND id > ? AND target_message_id = ?
     LIMIT 1`,
    [openid, Number(event.conversation_id) || 0, Number(event.id) || 0, userMessageId]
  );
  if (withdrawnRows.length) throw createClientTurnUnavailableError('withdrawn');
  let messageRows = [];
  [messageRows] = await db.execute(
    `SELECT id, role, content, response_json,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM ai_messages
     WHERE openid = ? AND conversation_id = ? AND id IN (?, ?)
     ORDER BY id ASC`,
    [openid, Number(event.conversation_id) || 0, userMessageId, assistantMessageId]
  );
  const user = messageRows.find((row) => row.role === 'user' && Number(row.id) === userMessageId);
  const assistant = messageRows.find((row) => row.role === 'assistant');
  if (!user || !assistant || Number(assistant.id) !== assistantMessageId) {
    throw createClientTurnUnavailableError('message_retention');
  }
  const proposals = userMessageId
    ? await listProposalsForExchange(db, openid, event.conversation_id, userMessageId)
    : [];
  const storedResponse = parseJson(assistant.response_json, payload.response || {});
  return {
    eventId: Number(event.id) || 0,
    conversationId: Number(event.conversation_id) || 0,
    userMessageId,
    assistantMessageId,
    assistantText: assistant.content || '',
    response: hydrateProposalStatus(storedResponse, proposals),
    proposals,
    idempotent: true,
    createdAt: event.created_at || null
  };
}

async function saveExchangeWithProposals(
  db,
  openid,
  conversationId,
  userText,
  assistantText,
  response = {},
  options = {}
) {
  const clientTurnKey = normalizeClientTurnKey(options.clientTurnKey);
  const ownsConnection = typeof db.getConnection === 'function';
  const transactionManagedExternally = options.transactionManagedExternally === true;
  if (transactionManagedExternally && ownsConnection) {
    const error = new Error('外部事务模式必须传入同一个事务连接');
    error.code = 'INVALID_TRANSACTION_MODE';
    throw error;
  }
  const connection = ownsConnection ? await db.getConnection() : db;
  if (!transactionManagedExternally && (typeof connection.beginTransaction !== 'function'
      || typeof connection.commit !== 'function'
      || typeof connection.rollback !== 'function')) {
    const error = new Error('原子会话写入需要数据库事务连接');
    error.code = 'TRANSACTION_REQUIRED';
    if (ownsConnection && typeof connection.release === 'function') connection.release();
    throw error;
  }
  try {
    if (!transactionManagedExternally) await connection.beginTransaction();
    if (clientTurnKey) {
      const existing = await findCommittedExchangeByKey(connection, openid, clientTurnKey);
      if (existing) {
        if (existing.conversationId !== (Number(conversationId) || 0)) {
          const error = new Error('clientTurnKey 已用于其他会话');
          error.code = 'CLIENT_TURN_KEY_CONFLICT';
          error.statusCode = 409;
          throw error;
        }
        if (!transactionManagedExternally) await connection.commit();
        return existing;
      }
    }

    const [ownedRows] = await connection.execute(
      'SELECT id FROM ai_conversations WHERE id = ? AND openid = ? LIMIT 1 FOR UPDATE',
      [Number(conversationId) || 0, openid]
    );
    const activeContext = require('./conversation-context').getTurnContext();
    if (activeContext) {
      const [projections] = await connection.execute(
        'SELECT revision FROM ai_session_context WHERE conversation_id = ? AND openid = ? FOR UPDATE',
        [conversationId, openid]
      );
      if (!projections.length || Number(projections[0].revision) !== activeContext.revision) {
        const error = new Error('对话在回复期间发生变化，请重新发送');
        error.statusCode = 409;
        throw error;
      }
    }
    if (!ownedRows.length) {
      const error = new Error('会话不存在或不属于当前用户');
      error.code = 'CONVERSATION_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    const userResponse = options.userResponse && typeof options.userResponse === 'object'
      ? JSON.stringify(options.userResponse)
      : null;
    const [userInsert] = await connection.execute(
      `INSERT INTO ai_messages
        (conversation_id, openid, role, content, response_json, created_at)
       VALUES (?, ?, 'user', ?, ?, CURRENT_TIMESTAMP)`,
      [Number(conversationId) || 0, openid, userText, userResponse]
    );
    const userMessageId = Number(userInsert?.insertId) || 0;
    await linkMessageMedia(connection, openid, userMessageId, collectExchangeMediaFileIds(options));
    const [assistantInsert] = await connection.execute(
      `INSERT INTO ai_messages
        (conversation_id, openid, role, content, response_json, created_at)
       VALUES (?, ?, 'assistant', ?, ?, CURRENT_TIMESTAMP)`,
      [Number(conversationId) || 0, openid, assistantText, JSON.stringify(response)]
    );
    const assistantMessageId = Number(assistantInsert?.insertId) || 0;
    const proposals = await persistProposals(connection, {
      openid,
      conversationId,
      sourceUserMessageId: userMessageId,
      sourceAssistantMessageId: assistantMessageId,
      plantPetId: options.plantPetId,
      clientTurnKey,
      expiresAt: options.proposalExpiresAt,
      proposals: options.proposals
    });
    const hydratedResponse = hydrateProposalStatus(response, proposals);
    await connection.execute(
      `UPDATE ai_messages SET response_json = ?
       WHERE id = ? AND conversation_id = ? AND openid = ? AND role = 'assistant'`,
      [JSON.stringify(hydratedResponse), assistantMessageId, Number(conversationId) || 0, openid]
    );
    await updateConversationTitleFromMessage(connection, openid, conversationId, userText);
    const eventId = await appendConversationEvent(connection, openid, conversationId, {
      eventType: 'turn_committed',
      eventKey: clientTurnKey || null,
      actor: 'assistant',
      targetMessageId: userMessageId,
      payload: {
        sourceUserMessageId: userMessageId,
        sourceAssistantMessageId: assistantMessageId,
        assistantText,
        response: hydratedResponse,
        proposalKeys: proposals.map((proposal) => proposal.proposalKey)
      }
    });
    await pruneMessages(connection, openid, conversationId);
    if (!transactionManagedExternally) await connection.commit();
    return {
      eventId,
      conversationId: Number(conversationId) || 0,
      userMessageId,
      assistantMessageId,
      assistantText,
      response: hydratedResponse,
      proposals,
      idempotent: false
    };
  } catch (err) {
    if (!transactionManagedExternally) await connection.rollback();
    if (!transactionManagedExternally
        && clientTurnKey
        && (err?.code === 'ER_DUP_ENTRY' || Number(err?.errno) === 1062)) {
      const replay = await findCommittedExchangeByKey(connection, openid, clientTurnKey);
      if (replay) return replay;
    }
    throw err;
  } finally {
    if (ownsConnection && typeof connection.release === 'function') connection.release();
  }
}

async function forkConversationBeforeMessage(db, openid, input = {}) {
  const sourceMessageId = Number(input.sourceMessageId) || 0;
  if (!sourceMessageId) return null;
  const execute = async (connection) => {
    const [sourceRows] = await connection.execute(
      `SELECT m.id, m.conversation_id, m.role, c.plant_pet_id, c.title
       FROM ai_messages m
       INNER JOIN ai_conversations c ON c.id = m.conversation_id AND c.openid = m.openid
       WHERE m.id = ? AND m.openid = ? LIMIT 1 FOR UPDATE`,
      [sourceMessageId, openid]
    );
    const source = sourceRows[0];
    if (!source || source.role !== 'user') return null;
    const newConversation = await createConversation(
      connection,
      openid,
      Number(source.plant_pet_id) || null,
      `${normalizeConversationTitle(source.title)} · 重写`
    );
    const [prefixRows] = await connection.execute(
      `SELECT recent.id, recent.role, recent.content, recent.response_json, recent.created_at
       FROM (
         SELECT id, role, content, response_json, created_at
         FROM ai_messages
         WHERE conversation_id = ? AND openid = ? AND id < ?
         ORDER BY id DESC
       ) AS recent
       ORDER BY recent.id ASC`,
      [source.conversation_id, openid, sourceMessageId]
    );
    for (const row of prefixRows) {
      const [copyResult] = await connection.execute(
        `INSERT INTO ai_messages
          (conversation_id, openid, role, content, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newConversation.id, openid, row.role, row.content, row.response_json || null, row.created_at]
      );
      await copyMessageMediaLinks(connection, openid, row.id, Number(copyResult?.insertId) || 0);
    }
    await appendConversationEvent(connection, openid, newConversation.id, {
      eventType: 'conversation_forked',
      actor: 'user',
      targetMessageId: sourceMessageId,
      payload: {
        sourceConversationId: Number(source.conversation_id) || 0,
        sourceMessageId,
        copiedMessageCount: prefixRows.length
      }
    });
    return {
      ...mapConversation(newConversation),
      copiedMessageCount: prefixRows.length
    };
  };

  const ownsConnection = typeof db.getConnection === 'function';
  const connection = ownsConnection ? await db.getConnection() : db;
  if (typeof connection.beginTransaction !== 'function'
      || typeof connection.commit !== 'function'
      || typeof connection.rollback !== 'function') {
    const error = new Error('分支复制需要数据库事务连接');
    error.code = 'TRANSACTION_REQUIRED';
    if (ownsConnection && typeof connection.release === 'function') connection.release();
    throw error;
  }
  try {
    await connection.beginTransaction();
    const result = await execute(connection);
    if (!result) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    if (ownsConnection && typeof connection.release === 'function') connection.release();
  }
}

async function withdrawLatestExchange(db, openid, input = {}) {
  const conversation = await getOwnedConversation(db, openid, input.sessionId);
  if (!conversation) return null;
  const requestedUserMessageId = Number(input.userMessageId) || 0;
  const execute = async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, role FROM ai_messages
       WHERE conversation_id = ? AND openid = ?
       ORDER BY id DESC LIMIT 2 FOR UPDATE`,
      [conversation.id, openid]
    );
    const assistant = rows[0];
    const user = rows[1];
    if (!assistant || !user || assistant.role !== 'assistant' || user.role !== 'user') return null;
    if (requestedUserMessageId && Number(user.id) !== requestedUserMessageId) return null;
    await connection.execute(
      `UPDATE ai_action_proposals
       SET status = 'dismissed', dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE openid = ? AND conversation_id = ? AND status = 'pending'
         AND (source_user_message_id = ? OR source_assistant_message_id = ?)`,
      [openid, conversation.id, Number(user.id), Number(assistant.id)]
    );
    await appendConversationEvent(connection, openid, conversation.id, {
      eventType: 'exchange_withdrawn',
      actor: 'user',
      targetMessageId: Number(user.id),
      payload: {
        sourceUserMessageId: Number(user.id),
        sourceAssistantMessageId: Number(assistant.id),
        sessionId: conversation.session_key
      }
    });
    await deleteConversationMediaForMessages(connection, openid, [assistant, user]);
    // Invalidate projections in the same transaction as the deletion. In-flight
    // summaries with an older revision cannot bring withdrawn content back.
    await connection.execute(
      'UPDATE ai_session_context SET summary = ?, through_message_id = 0, revision = revision + 1 WHERE conversation_id = ? AND openid = ?',
      ['', conversation.id, openid]
    );
    await connection.execute(
      'UPDATE ai_context_memory SET policy_version = policy_version + 1, revision = revision + 1 WHERE openid = ?', [openid]
    );
    await connection.execute(
      'DELETE FROM ai_messages WHERE conversation_id = ? AND openid = ? AND id IN (?, ?)',
      [conversation.id, openid, Number(user.id), Number(assistant.id)]
    );
    const [contextRows] = await connection.execute('SELECT facts_json FROM ai_context_memory WHERE openid = ? FOR UPDATE', [openid]);
    if (Array.isArray(contextRows) && contextRows.length) {
      const facts = parseJson(contextRows[0].facts_json, []);
      await connection.execute('UPDATE ai_context_memory SET facts_json = ?, summary_text = NULL WHERE openid = ?',
        [JSON.stringify(facts.filter(f => Number(f.sourceMessageId) !== Number(user.id))), openid]);
    }
    await connection.execute(
      `DELETE FROM ai_memories
       WHERE openid = ? AND memory_type = 'ai_summary' AND memory_key = ?`,
      [openid, `ai_summary:${normalizeSessionKey(conversation.session_key)}`]
    );
    await connection.execute(
      'UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND openid = ?',
      [conversation.id, openid]
    );
    return {
      conversationId: Number(conversation.id) || 0,
      sessionId: conversation.session_key,
      userMessageId: Number(user.id) || 0,
      assistantMessageId: Number(assistant.id) || 0
    };
  };
  if (typeof db.getConnection !== 'function') return execute(db);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await execute(connection);
    if (!result) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function markVisionExchangeSaved(db, openid, assistantMessageId, diagnosisId) {
  const normalizedMessageId = Number(assistantMessageId) || 0;
  const normalizedDiagnosisId = Number(diagnosisId) || 0;
  if (!normalizedMessageId || !normalizedDiagnosisId) return false;
  const [diagnosisRows] = await db.execute(
    'SELECT media_file_id FROM plant_diagnoses WHERE id = ? AND openid = ? LIMIT 1',
    [normalizedDiagnosisId, openid]
  );
  const mediaFileId = diagnosisRows[0]?.media_file_id || '';
  if (!mediaFileId) return false;
  const [messageRows] = await db.execute(
    `SELECT response_json FROM ai_messages
     WHERE id = ? AND openid = ? AND role = 'assistant' LIMIT 1`,
    [normalizedMessageId, openid]
  );
  const response = parseJson(messageRows[0]?.response_json, null);
  if (!response || response.kind !== 'vision_analysis') return false;
  response.attachment = {
    ...(response.attachment || {}),
    type: 'image',
    originalPersisted: true,
    mediaFileId: response.attachment?.mediaFileId || mediaFileId,
    diagnosisMediaFileId: mediaFileId,
    diagnosisId: normalizedDiagnosisId
  };
  const [updateResult] = await db.execute(
    `UPDATE ai_messages SET response_json = ?
     WHERE id = ? AND openid = ? AND role = 'assistant'`,
    [JSON.stringify(response), normalizedMessageId, openid]
  );
  return Number(updateResult?.affectedRows) === 1;
}

async function listMemories(db, openid, plantPetId = null) {
  const clauses = ['openid = ?'];
  const params = [openid];
  if (Number(plantPetId)) {
    clauses.push('(plant_pet_id = ? OR plant_pet_id IS NULL)');
    params.push(Number(plantPetId));
  }
  const [rows] = await db.execute(
    `SELECT id, plant_pet_id, memory_type, memory_key, content, source_type, source_id,
            DATE_FORMAT(source_time, '%Y-%m-%d %H:%i:%s') AS source_time,
            user_confirmed,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_memories WHERE ${clauses.join(' AND ')}
     ORDER BY user_confirmed DESC, updated_at DESC, id DESC LIMIT 80`,
    params
  );
  return rows.map(mapMemory);
}

async function upsertDerivedMemory(db, openid, input = {}) {
  const memoryKey = String(input.key || '').trim().slice(0, 128);
  const content = String(input.content || '').trim().slice(0, 1000);
  if (!memoryKey || !content) return;
  await db.execute(
    `INSERT INTO ai_memories
      (openid, plant_pet_id, memory_type, memory_key, content, source_type, source_id,
       source_time, user_confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       plant_pet_id = VALUES(plant_pet_id),
       content = IF(user_confirmed = 1, content, VALUES(content)),
       source_type = VALUES(source_type), source_id = VALUES(source_id),
       source_time = VALUES(source_time), updated_at = CURRENT_TIMESTAMP`,
    [
      openid,
      Number(input.plantPetId) || null,
      String(input.type || 'business_event').slice(0, 32),
      memoryKey,
      content,
      String(input.sourceType || 'system').slice(0, 32),
      String(input.sourceId || '').slice(0, 128) || null,
      input.sourceTime || null
    ]
  );
}

async function saveAiSummaryMemory(db, openid, sessionKey, plantPetId, content, sourceId = '') {
  return upsertDerivedMemory(db, openid, {
    plantPetId,
    type: 'ai_summary',
    key: `ai_summary:${normalizeSessionKey(sessionKey)}`,
    content: String(content || '').trim().slice(0, 500),
    sourceType: 'assistant_message',
    sourceId
  });
}

module.exports = {
  MAX_RECENT_MESSAGES,
  MAX_CONVERSATIONS_PER_PLANT,
  normalizeSessionKey,
  normalizeConversationTitle,
  parseJson,
  mapMemory,
  mapConversation,
  getOrCreateConversation,
  getOwnedConversation,
  createConversation,
  listConversations,
  updateConversationTitleFromMessage,
  deleteConversationMediaForMessages,
  collectExchangeMediaFileIds,
  linkMessageMedia,
  copyMessageMediaLinks,
  pruneMessages,
  listRecentMessages,
  saveExchange,
  normalizeClientTurnKey,
  createProposalKey,
  mapProposal,
  normalizeProposalExpiresAt,
  appendConversationEvent,
  listConversationEvents,
  listProposalsForExchange,
  listProposalsForMessages,
  persistProposals,
  hydrateProposalStatus,
  findCommittedExchangeByKey,
  saveExchangeWithProposals,
  forkConversationBeforeMessage,
  withdrawLatestExchange,
  markVisionExchangeSaved,
  listMemories,
  upsertDerivedMemory,
  saveAiSummaryMemory
};
