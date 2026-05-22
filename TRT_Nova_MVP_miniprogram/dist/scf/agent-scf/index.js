/**
 * agent-scf
 *
 * Minimal plant care chat backend for TRT Nova.
 * Current phase:
 * - POST /agent/chat
 * - Reads device latest/history from MySQL
 * - Returns rule-based diagnosis and suggestions
 *
 * Future phase:
 * - LLM orchestration
 * - RAG integration
 * - Action execution
 */

const { getDb } = require('./lib/db');
const { getBody, getMethod, getPath, json } = require('./lib/http');
const { resolveOpenid } = require('./lib/auth');
const { handleAgentChat } = require('./agent/chatHandler');

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

    if (method === 'POST' && path.endsWith('/agent/chat')) {
      return json(200, await handleAgentChat(db, openid, body));
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

    return json(500, {
      success: false,
      msg: err.message || 'Internal Server Error'
    });
  }
};

exports.main_handler = exports.main;
