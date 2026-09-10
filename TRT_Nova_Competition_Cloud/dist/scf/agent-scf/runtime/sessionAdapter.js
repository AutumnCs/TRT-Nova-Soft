const {
  MAX_RECENT_MESSAGES,
  getOwnedConversation,
  listRecentMessages,
  listConversationEvents,
  parseJson
} = require('../lib/agent-store');

const DEFAULT_MODEL_TURNS = 6;

function normalizeSessionMessage(row = {}) {
  return {
    id: Number(row.id) || 0,
    role: row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : '',
    content: String(row.content || ''),
    response: row.response !== undefined
      ? row.response
      : parseJson(row.response_json, null),
    createdAt: row.createdAt || row.created_at || null
  };
}

function normalizeConversationEvent(row = {}) {
  return {
    id: Number(row.id) || 0,
    type: row.type || row.event_type || '',
    eventKey: row.eventKey || row.event_key || '',
    actor: row.actor || 'system',
    targetMessageId: Number(row.targetMessageId ?? row.target_message_id) || null,
    payload: row.payload !== undefined ? row.payload : parseJson(row.payload_json, {}),
    createdAt: row.createdAt || row.created_at || null
  };
}

function buildMessageEvents(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeSessionMessage)
    .filter((message) => message.id && message.role)
    .map((message, sequence) => ({
      type: 'message',
      eventKey: `message:${message.id}`,
      actor: message.role,
      targetMessageId: message.id,
      payload: message,
      createdAt: message.createdAt,
      sequence
    }));
}

function collectSuppressedMessageIds(events = []) {
  const suppressed = new Set();
  (Array.isArray(events) ? events : []).map(normalizeConversationEvent).forEach((event) => {
    if (!['exchange_withdrawn', 'message_withdrawn', 'message_redacted'].includes(event.type)) return;
    if (event.targetMessageId) suppressed.add(event.targetMessageId);
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    [
      payload.userMessageId,
      payload.assistantMessageId,
      payload.sourceUserMessageId,
      payload.sourceAssistantMessageId
    ].forEach((id) => {
      const normalizedId = Number(id) || 0;
      if (normalizedId) suppressed.add(normalizedId);
    });
  });
  return suppressed;
}

function projectEffectiveMessages(messages = [], auditEvents = []) {
  const suppressed = collectSuppressedMessageIds(auditEvents);
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeSessionMessage)
    .filter((message) => message.id && message.role && !suppressed.has(message.id))
    .sort((left, right) => left.id - right.id);
}

function groupCompleteTurns(messages = [], auditEvents = []) {
  const effectiveMessages = projectEffectiveMessages(messages, auditEvents);
  const turns = [];
  let pendingUser = null;
  for (const message of effectiveMessages) {
    if (message.role === 'user') {
      pendingUser = message;
      continue;
    }
    if (message.role !== 'assistant' || !pendingUser) continue;
    turns.push({
      turnId: pendingUser.id,
      sourceUserMessageId: pendingUser.id,
      sourceAssistantMessageId: message.id,
      user: pendingUser,
      assistant: message
    });
    pendingUser = null;
  }
  return turns;
}

function projectModelMessages(messages = [], options = {}) {
  const maxTurns = Math.max(1, Math.min(
    Math.floor(MAX_RECENT_MESSAGES / 2),
    Number(options.maxTurns) || DEFAULT_MODEL_TURNS
  ));
  return groupCompleteTurns(messages, options.auditEvents)
    .slice(-maxTurns)
    .flatMap((turn) => [turn.user, turn.assistant])
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      response: message.response,
      createdAt: message.createdAt
    }));
}

function projectSession(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const auditEvents = Array.isArray(input.auditEvents) ? input.auditEvents : [];
  const effectiveMessages = projectEffectiveMessages(messages, auditEvents);
  const normalizedAuditEvents = auditEvents.map(normalizeConversationEvent);
  return {
    conversation: input.conversation || null,
    // ai_messages remains the readable session ledger. The extra events are
    // append-only audit records; this projection is deliberately not presented
    // as a pure event-sourced aggregate.
    events: [...buildMessageEvents(effectiveMessages), ...normalizedAuditEvents],
    uiMessages: effectiveMessages,
    modelMessages: projectModelMessages(effectiveMessages, {
      maxTurns: input.maxTurns,
      auditEvents: normalizedAuditEvents
    }),
    turns: groupCompleteTurns(effectiveMessages, normalizedAuditEvents)
  };
}

async function loadSessionProjection(db, input = {}) {
  const conversation = await getOwnedConversation(db, input.openid, input.sessionId);
  if (!conversation) return null;
  const messages = await listRecentMessages(db, input.openid, conversation.id);
  const auditEvents = Array.isArray(input.auditEvents)
    ? input.auditEvents
    : input.includeAuditEvents === false
      ? []
      : await listConversationEvents(db, input.openid, conversation.id);
  return projectSession({
    conversation,
    messages,
    auditEvents,
    maxTurns: input.maxTurns
  });
}

module.exports = {
  DEFAULT_MODEL_TURNS,
  normalizeSessionMessage,
  normalizeConversationEvent,
  buildMessageEvents,
  collectSuppressedMessageIds,
  projectEffectiveMessages,
  groupCompleteTurns,
  projectModelMessages,
  projectSession,
  loadSessionProjection
};
