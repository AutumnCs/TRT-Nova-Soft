const test = require('node:test');
const assert = require('node:assert/strict');

const agentService = require('./AgentService');

test('文档分析把 clientTurnKey 原样传给 Agent SCF', async () => {
  const originalAdapter = agentService.scfApiAdapter;
  let received = null;
  agentService.scfApiAdapter = {
    async analyzePlantDocument(payload) {
      received = payload;
      return { success: true, summary: 'ok' };
    }
  };

  try {
    const result = await agentService.analyzeDocument({
      sessionId: 'session-doc-1',
      clientTurnKey: 'document-turn-1',
      mediaFileId: 'local://doc-1',
      plantPetId: 7,
      message: ' 请分析 '
    });
    assert.equal(result.summary, 'ok');
    assert.equal(received.clientTurnKey, 'document-turn-1');
    assert.equal(received.sessionId, 'session-doc-1');
    assert.equal(received.message, '请分析');
  } finally {
    agentService.scfApiAdapter = originalAdapter;
  }
});
