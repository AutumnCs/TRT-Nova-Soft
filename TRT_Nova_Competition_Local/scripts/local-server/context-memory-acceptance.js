// Isolated local owner, real configured model, real MySQL, authenticated SCF entry.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST) || process.env.DB_NAME !== 'zhichong_v01_local') throw new Error('local database required');
if (!process.env.LLM_API_KEY && process.env.LLM_API_KEY_FILE) process.env.LLM_API_KEY = fs.readFileSync(path.resolve(root, process.env.LLM_API_KEY_FILE), 'utf8').trim();
process.env.AGENT_ROLLOUT_ENABLED = 'true';
process.env.AGENT_ROLLOUT_SAMPLE_RATE = '1';
const { signLocalJwt } = require('./local-auth');
const { main: agent } = require('../../dist/scf/agent-scf');
const { getDb } = require('../../dist/scf/agent-scf/lib/db');
const { saveExchange } = require('../../dist/scf/agent-scf/lib/agent-store');
const owner = 'context_acceptance_' + Date.now();
const token = signLocalJwt(owner, process.env.JWT_SECRET);
const evidence = { environment: 'local MySQL + configured real LLM; NOT physical device or cloud', owner, checks: [], replies: [] };
async function api(endpoint, body = {}, auth = token) {
  const started = Date.now();
  const result = await agent({ httpMethod: 'POST', path: endpoint, headers: { 'x-access-token': auth }, body: JSON.stringify(body) });
  const json = JSON.parse(result.body);
  assert.equal(result.statusCode, 200, json.msg);
  assert.notEqual(json.success, false, json.msg);
  if (endpoint === '/agent/chat') evidence.replies.push({ query: body.message, reply: json.summary, elapsedMs: Date.now() - started, memory: json.contextMemory, runtime: json.runtime });
  return json;
}
function pass(name) { evidence.checks.push(name); console.log('PASS: ' + name); }
const chat = (sessionId, message) => api('/agent/chat', { sessionId, message, clientTurnKey: owner + '_' + Date.now() });
async function run() {
  const db = await getDb();
  try {
    await db.execute('INSERT INTO users (openid, nick_name) VALUES (?, ?)', [owner, '测试用户']);
    let state = (await api('/agent/context-memory')).memory;
    assert.equal(state.enabled, false);
    await chat('current_only', '你可以叫我dola，先在这个对话里这样称呼就好。');
    let reply = await chat('current_only', '那么我是谁，你该怎么称呼我？');
    assert.match(reply.summary, /dola/i);
    assert.equal((await api('/agent/context-memory')).memory.facts.length, 0);
    pass('未开跨会话记忆，同一会话仍记得dola');
    state = (await api('/agent/context-memory', { action: 'enable', consent: true, version: state.version })).memory;
    reply = await chat('current_only', '以后叫我dola吧。我喜欢简短直接的回答。');
    assert.equal(reply.contextMemory.status, 'updated');
    assert.equal((reply.memorySuggestions || []).length, 0);
    state = (await api('/agent/context-memory')).memory;
    assert.ok(state.facts.some(f => f.key === 'preferred_name' && /dola/i.test(f.content) && !/dola吧/i.test(f.content)));
    pass('开启一次后自动整理昵称，无逐条候选卡且去掉语气词');
    reply = await chat('new_session', '你还记得我希望你怎么称呼我吗？');
    assert.match(reply.summary, /dola/i);
    pass('新对话使用自动跨会话摘要');
    await api('/agent/context-memory', { action: 'forget', version: state.version });
    reply = await chat('forgotten_session', '我希望你怎么称呼我？');
    assert.doesNotMatch(reply.summary, /dola/i);
    assert.equal((await api('/agent/context-memory')).memory.facts.length, 0);
    pass('清除后不从旧对话自动复活');
    const other = signLocalJwt(owner + '_other', process.env.JWT_SECRET);
    assert.equal((await api('/agent/context-memory', {}, other)).memory.facts.length, 0);
    const foreign = await api('/agent/session', { sessionId: 'current_only' }, other);
    assert.equal(foreign.messages.length, 0);
    pass('账号隔离');
    state = (await api('/agent/context-memory')).memory;
    await api('/agent/context-memory', { action: 'disable', version: state.version });
    const long = await api('/agent/session', { sessionId: 'long_session' });
    await saveExchange(db, owner, long.conversationId, '花园的小牌子上写着蓝鲸。以后讨论布置时请参考这件事。', '好，小牌子写着蓝鲸。', {});
    // 25 deterministic filler exchanges exercise storage and compaction; the final recall uses the real model.
    for (let i = 0; i < 25; i++) await saveExchange(db, owner, long.conversationId, '这是第' + i + '轮布置讨论，先不要做任何任务。', '好的，继续讨论。', {});
    const firstPage = await api('/agent/session', { sessionId: 'long_session' });
    const older = await api('/agent/session', { sessionId: 'long_session', beforeMessageId: firstPage.nextBeforeMessageId });
    assert.equal(firstPage.messages.length + older.messages.length, 52);
    assert.match(older.messages[0].content, /蓝鲸/);
    pass('超过20轮仍保留全部原话，历史分页可回读');
    reply = await chat('long_session', '最早花园的小牌子上写了什么？');
    assert.match(reply.summary, /蓝鲸/);
    assert.equal(reply.contextStatus.summaryIncomplete, false);
    const [summaries] = await db.execute('SELECT summary FROM ai_session_context WHERE openid = ? AND conversation_id = ?', [owner, long.conversationId]);
    assert.match(summaries[0].summary, /蓝鲸/);
    pass('长会话真实模型使用自动摘要回忆较早细节');
    const last = await api('/agent/session', { sessionId: 'long_session' });
    const fork = await api('/agent/conversation-fork', { sourceMessageId: last.messages.at(-2).id });
    assert.equal(fork.conversation.copiedMessageCount, 52);
    pass('重新编辑复制完整前缀，不再丢弃20轮之前的对话');
    await api('/agent/conversation-withdraw', { sessionId: 'long_session', userMessageId: last.messages.at(-2).id });
    const [invalidated] = await db.execute('SELECT summary, through_message_id FROM ai_session_context WHERE openid = ? AND conversation_id = ?', [owner, long.conversationId]);
    assert.equal(invalidated[0].summary, '');
    pass('撤回同步使摘要失效');
    const [tasks] = await db.execute('SELECT COUNT(*) AS n FROM ai_action_proposals WHERE openid = ?', [owner]);
    assert.equal(Number(tasks[0].n), 0);
    pass('称呼、记忆和回忆对话没有生成业务提案');
    state = (await api('/agent/context-memory')).memory;
    state = (await api('/agent/context-memory', { action: 'enable', consent: true, version: state.version })).memory;
    const sourceReply = await chat('source_session', '以后叫我栗子吧。');
    assert.equal(sourceReply.contextMemory.status, 'updated');
    const branch = await api('/agent/conversation-fork', { sourceMessageId: sourceReply.userMessageId });
    const branchReply = await chat(branch.conversation.sessionId, '你知道我的昵称偏好吗？不知道就直说。');
    assert.doesNotMatch(branchReply.summary, /栗子/);
    pass('重写分支不从跨会话摘要偷读原分支后半段');
    await api('/agent/conversation-withdraw', { sessionId: 'source_session', userMessageId: sourceReply.userMessageId });
    assert.ok(!(await api('/agent/context-memory')).memory.facts.some(f => /栗子/.test(f.content)));
    pass('撤回会物理移除来源为该消息的跨会话摘要');
    // Deterministic delayed-model boundary test against the REAL database.
    const { finishMemory } = require('../../dist/scf/agent-scf/lib/conversation-context');
    const llm = require('../../dist/scf/agent-scf/lib/llmClient');
    const original = llm.chatWithLlm;
    const memoryBefore = (await api('/agent/context-memory')).memory;
    const raw = await saveExchange(db, owner, long.conversationId, '我喜欢月季', '好的', {});
    const connection = await db.getConnection();
    try {
      let release;
      llm.chatWithLlm = () => new Promise(resolve => { release = resolve; });
      const pending = finishMemory({ db: connection, openid: owner, conversationId: long.conversationId, memory: memoryBefore, history: [] }, raw, '我喜欢月季');
      await new Promise(resolve => setImmediate(resolve));
      await api('/agent/context-memory', { action: 'forget', version: memoryBefore.version });
      release({ enabled: true, content: JSON.stringify({ facts: [{ key: 'gardening_rose', category: 'gardening_interest', content: '喜欢月季', quote: '我喜欢月季' }] }) });
      assert.equal((await pending).status, 'settings_changed');
      assert.equal((await api('/agent/context-memory')).memory.facts.length, 0);
      pass('延迟摘要在用户清除后不能写回（真实数据库，受控模型响应）');
      const afterForget = (await api('/agent/context-memory')).memory;
      llm.chatWithLlm = async () => { throw new Error('controlled summarizer outage'); };
      const failed = await finishMemory({ db: connection, openid: owner, conversationId: long.conversationId, memory: afterForget, history: [] }, raw, '我喜欢月季');
      assert.equal(failed.status, 'failed');
      assert.equal(failed.updated, false);
      assert.match(failed.message, /暂未更新/);
      const [retained] = await db.execute('SELECT id FROM ai_messages WHERE openid = ? AND id IN (?, ?)', [owner, raw.userMessageId, raw.assistantMessageId]);
      assert.equal(retained.length, 2);
      assert.equal((await api('/agent/context-memory')).memory.facts.length, 0);
      pass('摘要模型故障保留原对话，返回未更新提示且不伪造摘要（受控故障）');
    } finally { llm.chatWithLlm = original; connection.release(); }
  } finally { await db.end(); }
}
run().then(() => { evidence.status = 'PASS'; }).catch(error => {
  evidence.status = 'FAIL'; evidence.error = error.message; console.error(error.message); process.exitCode = 1;
}).finally(() => {
  const dir = process.env.M7_EVIDENCE_DIR || 'D:/植宠项目/验收记录/M7_2026-09-07/context-memory';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'real-model-context.json'), JSON.stringify(evidence, null, 2));
});
