/**
 * agent-scf
 *
 * Current M6 plant-care assistant backend for TRT Nova.
 * - Authenticated bounded sessions, Chat, published-only RAG and structured memory
 * - Vision analysis plus ownership-checked linking after an explicit diagnosis save
 * - Read-only task candidates; no autonomous business action execution
 */

const { getDb } = require('./lib/db');
const { getBody, getMethod, getPath, json } = require('./lib/http');
const { resolveOpenid } = require('./lib/auth');
const { handleAgentChat } = require('./agent/chatHandler');
const { handleVisionAnalyze } = require('./agent/visionHandler');
const { handleDocumentAnalyze } = require('./agent/documentHandler');
const {
  getOrCreateConversation,
  createConversation,
  listConversations,
  forkConversationBeforeMessage,
  withdrawLatestExchange,
  listRecentMessages,
  listMemories,
  markVisionExchangeSaved
} = require('./lib/agent-store');
const { getDailyUsage } = require('./lib/quota');
const { loadPlantPetContext } = require('./agent/petContext');
const { runContextualTurn, readMemory, changeMemory } = require('./lib/conversation-context');

function resolveErrorStatus(err) {
  if (Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 600) return Number(err.statusCode);
  const message = String(err?.message || '');
  if (/token|bearer|openid/i.test(message)) return 401;
  return 500;
}

async function loadAgentSession(db, openid, body = {}) {
  const plantPetId = Number(body.plantPetId) || 0;
  const sessionId = body.sessionId || `assistant_${plantPetId || 'global'}`;
  const context = await loadPlantPetContext(db, openid, plantPetId);
  if (plantPetId && !context.pet) {
    const error = new Error('植宠不存在或无权访问');
    error.statusCode = 404;
    throw error;
  }
  const conversation = await getOrCreateConversation(db, openid, sessionId, plantPetId || null);
  const [messages, memories, quota] = await Promise.all([
    listRecentMessages(db, openid, conversation.id, { hydrateProposals: true, beforeMessageId: body.beforeMessageId }),
    listMemories(db, openid, plantPetId || null),
    getDailyUsage(db, openid)
  ]);
  return {
    success: true,
    sessionId: conversation.session_key,
    conversationId: Number(conversation.id) || 0,
    plantPet: context.pet,
    messages,
    hasMore: messages.length === 40,
    nextBeforeMessageId: Number(messages[0]?.id) || 0,
    memories,
    quota
  };
}

async function markVisionSaved(db, openid, body = {}) {
  const saved = await markVisionExchangeSaved(db, openid, body.assistantMessageId, body.diagnosisId);
  if (!saved) {
    const error = new Error('图片会话不存在，或观察记录不属于当前账号');
    error.statusCode = 404;
    throw error;
  }
  return { success: true };
}

async function assertPlantPetScope(db, openid, plantPetId) {
  const id = Number(plantPetId) || 0;
  if (!id) return;
  const [rows] = await db.execute(
    'SELECT id FROM plant_pets WHERE id = ? AND openid = ? LIMIT 1',
    [id, openid]
  );
  if (!rows.length) {
    const error = new Error('植宠不存在或无权访问');
    error.statusCode = 404;
    throw error;
  }
}

async function listAgentConversations(db, openid, body = {}) {
  const plantPetId = Number(body.plantPetId) || 0;
  await assertPlantPetScope(db, openid, plantPetId);
  return {
    success: true,
    conversations: await listConversations(db, openid, plantPetId || null)
  };
}

async function createAgentConversation(db, openid, body = {}) {
  const plantPetId = Number(body.plantPetId) || 0;
  await assertPlantPetScope(db, openid, plantPetId);
  const conversation = await createConversation(db, openid, plantPetId || null, body.title || '新对话');
  return {
    success: true,
    conversation: {
      id: Number(conversation.id) || 0,
      sessionId: conversation.session_key,
      plantPetId: Number(conversation.plant_pet_id) || null,
      title: conversation.title || '新对话',
      messageCount: 0,
      createdAt: conversation.created_at || null,
      updatedAt: conversation.updated_at || null
    }
  };
}

async function forkAgentConversation(db, openid, body = {}) {
  const conversation = await forkConversationBeforeMessage(db, openid, body);
  if (!conversation) {
    const error = new Error('要重新编写的消息不存在或无权访问');
    error.statusCode = 404;
    throw error;
  }
  return { success: true, conversation };
}

async function withdrawAgentExchange(db, openid, body = {}) {
  const result = await withdrawLatestExchange(db, openid, body);
  if (!result) {
    const error = new Error('只能撤回当前会话最后一轮，或该消息已不存在');
    error.statusCode = 409;
    throw error;
  }
  return { success: true, ...result };
}

exports.main = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const body = getBody(event);

  try {
    if (method === 'GET' && path.endsWith('/health')) {
      return json(200, {
        success: true,
        service: 'agent-scf',
        now: Date.now()
      });
    }

    const db = await getDb();
    const openid = resolveOpenid(event, body);

    if (method === 'POST' && path.endsWith('/agent/context-memory')) {
      return json(200, { success: true, memory: body.action
        ? await changeMemory(db, openid, body) : await readMemory(db, openid) });
    }

    if (method === 'POST' && path.endsWith('/agent/chat')) {
      return json(200, await runContextualTurn(db, openid, body, handleAgentChat));
    }

    if (method === 'POST' && path.endsWith('/agent/session')) {
      return json(200, await loadAgentSession(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/agent/conversations')) {
      return json(200, await listAgentConversations(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/agent/conversation-create')) {
      return json(200, await createAgentConversation(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/agent/conversation-fork')) {
      return json(200, await forkAgentConversation(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/agent/conversation-withdraw')) {
      return json(200, await withdrawAgentExchange(db, openid, body));
    }

    if (method === 'POST' && path.endsWith('/vision/analyze')) {
      return json(200, await runContextualTurn(db, openid, body, handleVisionAnalyze));
    }

    if (method === 'POST' && path.endsWith('/document/analyze')) {
      return json(200, await runContextualTurn(db, openid, body, handleDocumentAnalyze));
    }

    if (method === 'POST' && path.endsWith('/vision/mark-saved')) {
      return json(200, await markVisionSaved(db, openid, body));
    }

    return json(404, {
      success: false,
      msg: '接口不存在'
    });
  } catch (err) {
    console.error('agent-scf error:', {
      message: err.message,
      stack: err.stack,
      path
    });

    return json(resolveErrorStatus(err), {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.main_handler = exports.main;

exports.loadAgentSession = loadAgentSession;
exports.markVisionSaved = markVisionSaved;
exports.listAgentConversations = listAgentConversations;
exports.createAgentConversation = createAgentConversation;
exports.forkAgentConversation = forkAgentConversation;
exports.withdrawAgentExchange = withdrawAgentExchange;
exports.resolveErrorStatus = resolveErrorStatus;
