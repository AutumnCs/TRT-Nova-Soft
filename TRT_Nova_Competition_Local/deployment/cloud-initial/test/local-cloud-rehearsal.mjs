import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrateDatabase, projectRoot } from '../tools/migrate-database.mjs';
import { seedReviewedContent } from '../tools/seed-reviewed-content.mjs';
import { localProviders, documentFixtures } from './fixtures/local-cloud-providers.mjs';

// Run after building the candidate. Uses only a new, synthetic local database.
// Never reads .env.local, accesses acceptance data, calls cloud APIs or deploys.
const require = createRequire(import.meta.url);
const builtRoot = path.join(projectRoot, 'deployment/cloud-initial/build');
const names = ['auth-scf', 'api-scf', 'agent-scf', 'history-cleanup-scf'];
const results = [];
let databaseName;
async function step(name, run) {
  await run(); results.push({ name, status: 'PASS' }); console.log(`PASS ${name}`);
}
function installModule(packageRequire, name, exports) {
  const id = packageRequire.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
async function main() {
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(builtRoot, name, 'cloud-entry.js')), `Build ${name} first`);
    assert.match(fs.readFileSync(path.join(builtRoot, name, 'cloud-entry.js'), 'utf8'), /secrets\.initialize/,
      'Candidate is stale; rebuild before the rehearsal');
  }
  const mysql = require('mysql2/promise');
  const nativeCreatePool = mysql.createPool.bind(mysql);
  const mysqlPort = Number(process.env.NOVA_TEST_MYSQL_PORT) || 3306;
  const localConnection = { host: '127.0.0.1', port: mysqlPort, user: process.env.NOVA_TEST_MYSQL_USER || 'root',
    password: process.env.NOVA_TEST_MYSQL_PASSWORD || '', charset: 'utf8mb4' };
  const admin = await mysql.createConnection(localConnection);
  databaseName = `nova_cloud_test_${Date.now()}`;
  assert.match(databaseName, /^nova_cloud_test_\d+$/);
  let db; let providers; const pools = [];
  try {
    const [[exists]] = await admin.execute('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]);
    assert.equal(Number(exists.n), 0, 'Never reuse a pre-existing database');
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = nativeCreatePool({ ...localConnection, database: databaseName, connectionLimit: 6 });
    console.log(`ISOLATED_DATABASE ${databaseName}; preserved for inspection, never dropped automatically`);
    await step('migration: empty database bootstrap, current schema and incremental replay', async () => {
      const connection = await db.getConnection();
      try {
        await migrateDatabase(connection, { mode: 'bootstrap', confirmDatabase: databaseName });
        await connection.execute("INSERT INTO ai_context_memory (openid, enabled, facts_json, summary_text) VALUES ('migration-only', 1, JSON_ARRAY(), '保留的测试摘要')");
        await migrateDatabase(connection, { mode: 'incremental', confirmDatabase: databaseName });
        const [[retained]] = await connection.execute("SELECT summary_text FROM ai_context_memory WHERE openid = 'migration-only'");
        assert.equal(retained.summary_text, '保留的测试摘要');
        // Exercise upgrade from the older context/early COS candidate schema.
        await connection.query('ALTER TABLE ai_context_memory DROP COLUMN summary_text, DROP COLUMN revision');
        await connection.query('ALTER TABLE cloud_media_objects DROP COLUMN attempts');
        await migrateDatabase(connection, { mode: 'incremental', confirmDatabase: databaseName });
        await migrateDatabase(connection, { mode: 'verify', confirmDatabase: databaseName });
        await assert.rejects(migrateDatabase(connection, { mode: 'bootstrap', confirmDatabase: databaseName }), /BOOTSTRAP_REQUIRES_EMPTY/);
        await assert.rejects(migrateDatabase(connection, { mode: 'verify', confirmDatabase: 'zhichong_v01_local' }), /CONFIRMATION/);
      } finally { connection.release(); }
    });
    await step('reviewed knowledge bootstrap: explicit approval, dry-run rollback, safe import and overwrite refusal', async () => {
      const connection = await db.getConnection();
      try {
        await assert.rejects(seedReviewedContent(connection, { confirmDatabase: databaseName }), /ACK_REQUIRED/);
        const options = { confirmDatabase: databaseName, acknowledgeReviewed: true };
        const preview = await seedReviewedContent(connection, { ...options, dryRun: true });
        assert.equal(preview.articles, 10); assert.equal(preview.plants, 17);
        assert.equal(Number((await connection.execute('SELECT COUNT(*) AS n FROM knowledge_articles'))[0][0].n), 0);
        await seedReviewedContent(connection, options);
        await assert.rejects(seedReviewedContent(connection, options), /REQUIRES_EMPTY_REVIEWED_LIBRARY/);
      } finally { connection.release(); }
    });
    const secrets = { DB_USER: 'rehearsal_user', DB_PASSWORD: 'rehearsal_database_password',
      JWT_SECRET: 'rehearsal-only-jwt-key-that-is-at-least-32-characters',
      WECHAT_SECRET: 'rehearsal-wechat-secret', LLM_API_KEY: 'rehearsal-llm-key' };
    for (const key of ['DB_SSL_CA', 'DEBUG_OPENID', 'LLM_API_KEY_FILE', 'QWEATHER_PRIVATE_KEY_FILE']) delete process.env[key];
    Object.assign(process.env, {
      DB_HOST: 'mysql.nova.invalid', DB_NAME: 'nova_staging_rehearsal', DB_PORT: '3306', DB_TLS_MODE: 'required',
      NOVA_REGION: 'ap-guangzhou', TENCENTCLOUD_REGION: 'ap-guangzhou', NOVA_SECRET_STRATEGY: 'runtime-ssm-sdk',
      NOVA_SECRET_REFS: JSON.stringify(Object.fromEntries(Object.keys(secrets).map(key => [key, `secret://nova/rehearsal#${key}`]))),
      TENCENTCLOUD_SECRETID: 'rehearsal-role-id', TENCENTCLOUD_SECRETKEY: 'rehearsal-role-key', TENCENTCLOUD_SESSIONTOKEN: 'rehearsal-role-session',
      WECHAT_APPID: 'wx1234567890abcdef', LOCAL_MEDIA_ENABLED: 'false', LOCAL_DEV_AUTH_ENABLED: 'false',
      ALLOW_LEGACY_OPENID_FALLBACK: 'false', MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'nova-rehearsal-1250000000',
      COS_REGION: 'ap-guangzhou', COS_PREFIX: 'nova-staging/rehearsal/', LLM_API_ENABLED: 'true',
      LLM_API_BASE_URL: 'https://model.nova.invalid', LLM_API_PATH: '/v1/chat/completions', LLM_MODEL: 'rehearsal-chat',
      VISION_MODEL: 'rehearsal-vision', AGENT_SHADOW_ENABLED: 'false', AGENT_ROLLOUT_ENABLED: 'true',
      AGENT_ROLLOUT_SAMPLE_RATE: '1', AGENT_ROLLOUT_COHORT_KEY: 'local-cloud-rehearsal',
      NOVA_HISTORY_CLEANUP_ENABLED: 'true', NOVA_DEVICE_COMMANDS_ENABLED: 'false', QWEATHER_ENABLED: 'false'
    });
    for (const key of Object.keys(secrets)) delete process.env[key];
    providers = localProviders({ secrets, mysqlPort });
    const entries = {}; const packageRequires = {}; let poolAssertions = 0;
    for (const name of names) {
      const packageRequire = createRequire(path.join(builtRoot, name, 'index.js'));
      packageRequires[name] = packageRequire;
      installModule(packageRequire, 'tencentcloud-sdk-nodejs-ssm', { ssm: { v20190923: { Client: providers.SsmClient } } });
      if (name !== 'auth-scf') installModule(packageRequire, 'cos-nodejs-sdk-v5', providers.CosClient);
      const packageMysql = packageRequire('mysql2/promise');
      packageMysql.createPool = options => {
        assert.equal(options.host, 'mysql.nova.invalid'); assert.equal(options.database, 'nova_staging_rehearsal');
        assert.equal(options.user, secrets.DB_USER); assert.equal(options.password, secrets.DB_PASSWORD);
        assert.equal(options.ssl.rejectUnauthorized, true); assert.equal(options.ssl.verifyIdentity, true);
        assert.ok(providers.calls.ssm > 0, 'Secrets must hydrate before a DB pool is created'); poolAssertions++;
        const pool = nativeCreatePool({ ...localConnection, database: databaseName, connectionLimit: 6 }); pools.push(pool); return pool;
      };
      entries[name] = packageRequire('./cloud-entry.js');
    }
    async function call(name, endpoint, body = {}, token = '', expectedStatus = 200, method = 'POST') {
      process.env.NOVA_FUNCTION_NAME = name;
      const response = await entries[name].main_handler({ path: endpoint, httpMethod: method,
        headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }, {});
      assert.equal(response.statusCode, expectedStatus, `${name} ${endpoint}: ${response.body}`);
      return JSON.parse(response.body);
    }
    const api = (endpoint, body, token, status) => call('api-scf', endpoint, body, token, status);
    const agent = (endpoint, body, token, status) => call('agent-scf', endpoint, body, token, status);
    let loginA; let loginB; let tokenA; let tokenB; let pet;
    await step('built auth: WeChat exchange boundary -> actual user upsert -> JWT; owner isolation', async () => {
      loginA = await call('auth-scf', '/auth/login', { code: 'owner-a' });
      loginB = await call('auth-scf', '/auth/login', { code: 'owner-b' });
      assert.equal(loginA.success, true); tokenA = loginA.accessToken; tokenB = loginB.accessToken;
      const denied = await api('/plant/pets', { openid: loginA.openid }, '', 401); assert.equal(denied.success, false);
      pet = (await api('/plant/pet-create', { nickname: '云候选测试月季', speciesName: '月季', openid: loginB.openid }, tokenA)).pet;
      assert.ok(pet.id);
      const [[row]] = await db.execute('SELECT openid FROM plant_pets WHERE id = ?', [pet.id]); assert.equal(row.openid, loginA.openid);
      assert.equal((await api('/plant/pet', { plantPetId: pet.id }, tokenB)).success, false);
      assert.equal((await api('/device/cmd', { action: 'fan.on' }, tokenA, 403)).code, 'CLOUD_DEVICE_COMMANDS_DISABLED');
    });
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    async function upload(purpose = 'conversation_image', extra = {}) {
      const result = await api('/media/upload', { purpose, dataBase64: imageBase64, originalName: 'pixel.png', ...extra }, tokenA);
      assert.equal(result.success, true, JSON.stringify(result)); assert.match(result.media.fileId, /^cos:\/\//); return result.media.fileId;
    }
    async function state(fileId) { return (await db.execute('SELECT * FROM cloud_media_objects WHERE file_id = ?', [fileId]))[0][0]; }
    const cloudMedia = packageRequires['api-scf']('./cloud-media');
    let photo; let document;
    await step('built knowledge API and RAG: current reviewed content, no draft leaks or false fallback', async () => {
      const articles = await api('/knowledge/articles', {}, tokenA);
      assert.equal(articles.articles.length, 10);
      assert.ok(articles.articles.every(item => item.status === 'published' && item.reviewedBy));
      const [[first]] = await db.execute('SELECT id, slug, content FROM knowledge_articles ORDER BY id LIMIT 1');
      await db.execute("UPDATE knowledge_articles SET status = 'draft', content = 'draft-only-regression-sentinel' WHERE id = ?", [first.id]);
      assert.equal((await api('/knowledge/articles', {}, tokenA)).articles.length, 9);
      const rag = packageRequires['agent-scf']('./rag/knowledgeSearch');
      const context = await rag.searchKnowledgeBundle(db, { query: '月季 浇水', plantType: '月季' });
      assert.ok(context.hits.length > 0); assert.ok(context.hits.every(item => item.sourceUrl));
      assert.ok(!JSON.stringify(context).includes('draft-only-regression-sentinel'));
      await db.execute("UPDATE knowledge_articles SET status = 'published', content = ? WHERE id = ?", [first.content, first.id]);
    });
    await step('cloud media: empty-garden upload, owner resolve, byte integrity, private COS, no database BLOB', async () => {
      photo = await upload();
      const [[row]] = await db.execute('SELECT provider, content_blob FROM media_objects WHERE file_id = ?', [photo]);
      assert.equal(row.provider, 'cos'); assert.equal(row.content_blob, null);
      const resolved = await api('/media/resolve', { fileIds: [photo] }, tokenA); assert.equal(resolved.media[0].contentBase64, imageBase64);
      const denied = await api('/media/resolve', { fileIds: [photo] }, tokenB); assert.equal(denied.media.length, 0); assert.deepEqual(denied.missingFileIds, [photo]);
      providers.faults.corruptRead = true;
      assert.equal((await api('/media/resolve', { fileIds: [photo] }, tokenA, 500)).success, false);
      providers.faults.corruptRead = false;
      const result = await api('/media/upload', { purpose: 'conversation_document', originalName: 'notes.txt',
        dataBase64: Buffer.from('Rose care notes: provide ventilation. Check soil before watering.').toString('base64') }, tokenA);
      assert.equal(result.success, true, JSON.stringify(result)); document = result.media.fileId;
    });
    const session = (await agent('/agent/conversation-create', {}, tokenA)).conversation.sessionId;
    let visionResult; let documentResult; let chatAfterDoc; let branch;
    await step('built Vision: persisted image, explicit no-task intent, replay cannot create a second exchange', async () => {
      const input = { sessionId: session, mediaFileId: photo, imageBase64, mimeType: 'image/png',
        message: '这是什么，只介绍，不安排任务', clientTurnKey: 'cloud-image-turn' };
      visionResult = await agent('/vision/analyze', input, tokenA);
      assert.equal(visionResult.success, true); assert.deepEqual(visionResult.taskSuggestions, []);
      const replay = await agent('/vision/analyze', input, tokenA); assert.equal(replay.idempotent, true);
      assert.equal(replay.userMessageId, visionResult.userMessageId);
      const [[tasks]] = await db.execute('SELECT COUNT(*) AS n FROM todos'); assert.equal(Number(tasks.n), 0);
      const loaded = await agent('/agent/session', { sessionId: session }, tokenA);
      assert.equal(loaded.messages.length, 2); assert.equal(JSON.stringify(loaded.messages).includes(photo), true);
    });
    await step('built document: COS bytes -> real text parser -> persisted exchange + session context', async () => {
      documentResult = await agent('/document/analyze', { sessionId: session, mediaFileId: document,
        message: '解释这份文档，不安排任务', clientTurnKey: 'cloud-document-turn' }, tokenA);
      assert.equal(documentResult.success, true); assert.equal(documentResult.attachment.mediaFileId, document);
      const payload = providers.calls.model.find(item => item.messages.some(m => String(m.content).includes('Rose care notes')));
      assert.ok(payload, 'Document text must reach the existing model client');
      assert.ok(payload.messages.some(item => item.role === 'user' && String(item.content).includes('这是什么，只介绍，不安排任务')),
        'Document request must include the earlier image exchange');
      const reloaded = await agent('/agent/session', { sessionId: session }, tokenA); assert.equal(reloaded.messages.length, 4);
      chatAfterDoc = await agent('/agent/chat', { sessionId: session, message: '继续聊植物', clientTurnKey: 'cloud-after-document' }, tokenA);
      assert.equal(chatAfterDoc.success, true);
    });
    await step('branches and withdrawal: shared attachments survive until the last message reference is removed', async () => {
      branch = (await agent('/agent/conversation-fork', { sourceMessageId: chatAfterDoc.userMessageId }, tokenA)).conversation;
      assert.equal(branch.copiedMessageCount, 4);
      for (const userMessageId of [chatAfterDoc.userMessageId, documentResult.userMessageId, visionResult.userMessageId]) {
        assert.equal((await agent('/agent/conversation-withdraw', { sessionId: session, userMessageId }, tokenA)).success, true);
      }
      assert.equal((await state(document)).state, 'ready'); assert.equal((await state(photo)).state, 'ready');
      assert.equal((await api('/media/resolve', { fileIds: [document] }, tokenA)).media.length, 1);
      const loaded = await agent('/agent/session', { sessionId: branch.sessionId }, tokenA);
      for (const userMessageId of loaded.messages.filter(m => m.role === 'user').map(m => m.id).reverse()) {
        assert.equal((await agent('/agent/conversation-withdraw', { sessionId: branch.sessionId, userMessageId }, tokenA)).success, true);
      }
      assert.equal((await state(document)).state, 'delete_pending');
      const cleanup = await cloudMedia.cleanup(db, 2); assert.equal(cleanup.deleted, 2);
      assert.equal(await state(document), undefined); assert.equal(await state(photo), undefined);
    });
    await step('PDF and DOCX: real parsers from built packages, long MIME field and permanent conversation references', async () => {
      for (const fixture of documentFixtures()) {
        const uploaded = await api('/media/upload', { purpose: 'conversation_document', originalName: fixture.name,
          dataBase64: fixture.bytes.toString('base64') }, tokenA);
        assert.equal(uploaded.success, true, JSON.stringify(uploaded));
        const result = await agent('/document/analyze', { sessionId: `formats-${fixture.name}`, mediaFileId: uploaded.media.fileId,
          message: '解释文档中的通风要求，不安排任务', clientTurnKey: `format-${fixture.name}` }, tokenA);
        assert.equal(result.success, true);
        const [[row]] = await db.execute('SELECT mime_type, content_blob, reference_type FROM media_objects WHERE file_id = ?', [uploaded.media.fileId]);
        assert.equal(row.content_blob, null); assert.equal(row.reference_type, 'ai_message');
        if (fixture.name.endsWith('.docx')) assert.equal(row.mime_type.length, 71);
      }
    });
    await step('storage transactions: ROLLBACK restores metadata and cancellation does not delete the COS object', async () => {
      const fileId = await upload(); const key = (await state(fileId)).object_key;
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction(); await connection.execute('DELETE FROM media_objects WHERE file_id = ?', [fileId]);
        const [[deleted]] = await connection.execute('SELECT state FROM cloud_media_objects WHERE file_id = ?', [fileId]); assert.equal(deleted.state, 'delete_pending');
        await connection.rollback();
      } finally { connection.release(); }
      assert.equal((await state(fileId)).state, 'ready'); assert.equal(providers.objects.has(key), true);
      assert.equal((await cloudMedia.cleanup(db, 2)).deleted, 0);
      const rejected = await api('/plant/pet-create', { nickname: '不允许偷图', coverFileId: fileId }, tokenB);
      assert.equal(rejected.success, false); assert.equal((await state(fileId)).state, 'ready');
      await api('/media/discard', { fileId }, tokenA);
      providers.faults.delete = true;
      assert.equal((await cloudMedia.cleanup(db, 2)).failed, 1);
      const queued = await state(fileId); assert.equal(Number(queued.attempts), 1); assert.ok(queued.cleanup_after > new Date());
      assert.equal(providers.objects.has(key), true);
      assert.equal((await cloudMedia.cleanup(db, 2)).deleted, 0);
      await db.execute('UPDATE cloud_media_objects SET cleanup_after = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE file_id = ?', [fileId]);
      assert.equal((await cloudMedia.cleanup(db, 2)).deleted, 1); assert.equal(providers.objects.has(key), false);
    });
    await step('indeterminate upload: lost PUT response preserves the cleanup ledger and waits for safe expiry', async () => {
      providers.faults.putAfterWrite = true;
      const rejected = await api('/media/upload', { purpose: 'conversation_image', dataBase64: imageBase64 }, tokenA, 503); assert.equal(rejected.success, false);
      const [pending] = await db.execute("SELECT * FROM cloud_media_objects WHERE state = 'delete_pending'");
      assert.equal(pending.length, 1); assert.ok(pending[0].cleanup_after > new Date());
      assert.equal((await cloudMedia.cleanup(db, 2)).deleted, 0);
      await db.execute('UPDATE cloud_media_objects SET cleanup_after = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE file_id = ?', [pending[0].file_id]);
      assert.equal((await cloudMedia.cleanup(db, 2)).deleted, 1);
    });
    await step('memory: opt-in -> automatic prose summary -> next-session injection -> whole-summary edit/conflict', async () => {
      const initial = (await agent('/agent/context-memory', {}, tokenA)).memory; assert.equal(initial.enabled, false);
      await agent('/agent/context-memory', { action: 'enable', consent: true, version: initial.version }, tokenA);
      const result = await agent('/agent/chat', { sessionId: 'memory-a', message: '以后叫我dola吧', clientTurnKey: 'remember-dola' }, tokenA);
      assert.equal(result.contextMemory.status, 'updated');
      const memory = (await agent('/agent/context-memory', {}, tokenA)).memory; assert.equal(memory.summary, '你希望我称呼你为dola。');
      const from = providers.calls.model.length;
      await agent('/agent/chat', { sessionId: 'memory-b', message: '我是谁？', clientTurnKey: 'recall-dola' }, tokenA);
      assert.ok(providers.calls.model.slice(from).some(p => JSON.stringify(p.messages).includes('你希望我称呼你为dola。')));
      const edited = (await agent('/agent/context-memory', { action: 'replace_summary', summary: '你偏好简短的植物养护建议。', version: memory.version }, tokenA)).memory;
      assert.equal(edited.summary, '你偏好简短的植物养护建议。');
      assert.equal((await agent('/agent/context-memory', { action: 'disable', version: memory.version }, tokenA, 409)).success, false);
      assert.equal((await agent('/agent/context-memory', {}, tokenB)).memory.summary, '');
    });
    await step('long sessions: full raw history over 20 turns, compaction and owner-scoped exact retrieval', async () => {
      for (let index = 0; index < 22; index++) {
        const result = await agent('/agent/chat', { sessionId: 'long-session', message: `植物观察记录${index}`, clientTurnKey: `long-${index}` }, tokenA);
        assert.equal(result.success, true);
      }
      const sessionData = await agent('/agent/session', { sessionId: 'long-session' }, tokenA);
      assert.equal(sessionData.messages.length, 40); assert.equal(sessionData.hasMore, true);
      const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [sessionData.conversationId]); assert.equal(Number(count.n), 44);
      const [[context]] = await db.execute('SELECT summary, through_message_id FROM ai_session_context WHERE conversation_id = ?', [sessionData.conversationId]);
      assert.ok(context.summary); assert.ok(Number(context.through_message_id) > 0);
      const ctx = packageRequires['agent-scf']('./lib/conversation-context');
      const history = await ctx.searchHistory({ db, openid: loginA.openid, conversationId: sessionData.conversationId }, { query: '植物观察记录0' });
      assert.equal(history.messages.some(m => m.content === '植物观察记录0'), true);
      const denied = await ctx.searchHistory({ db, openid: loginB.openid, conversationId: sessionData.conversationId }, { query: '' }); assert.equal(denied.messages.length, 0);
      const original = await db.execute('SELECT COUNT(*) AS n FROM ai_messages');
      process.env.NOVA_FUNCTION_NAME = 'history-cleanup-scf';
      const cleanup = await entries['history-cleanup-scf'].main_handler({ Type: 'Timer', TriggerName: 'local-rehearsal' }, {});
      assert.equal(cleanup.statusCode, 200, cleanup.body);
      assert.equal(Number((await db.execute('SELECT COUNT(*) AS n FROM ai_messages'))[0][0].n), Number(original[0][0].n));
    });
    await step('task proposal: explicit intent only, no task before confirmation, owner check and idempotent confirmation', async () => {
      const before = Number((await db.execute('SELECT COUNT(*) AS n FROM todos'))[0][0].n);
      const result = await agent('/agent/chat', { sessionId: 'task-session', plantPetId: pet.id,
        message: '帮我安排一个明天观察月季的任务', clientTurnKey: 'task-proposal-turn' }, tokenA);
      assert.equal(result.success, true);
      const [proposals] = await db.execute("SELECT proposal_key FROM ai_action_proposals WHERE openid = ? AND status = 'pending' AND proposal_type IN ('care_task', 'propose_care_task')", [loginA.openid]);
      assert.equal(proposals.length, 1, JSON.stringify(result)); assert.equal(Number((await db.execute('SELECT COUNT(*) AS n FROM todos'))[0][0].n), before);
      const proposalKey = proposals[0].proposal_key;
      assert.equal((await api('/care/task-proposal-confirm', { proposalKey }, tokenB)).success, false);
      const confirmed = await api('/care/task-proposal-confirm', { proposalKey }, tokenA); assert.equal(confirmed.success, true, JSON.stringify(confirmed));
      const replay = await api('/care/task-proposal-confirm', { proposalKey }, tokenA);
      assert.equal(replay.task.id, confirmed.task.id); assert.equal(replay.proposal.idempotent, true);
      assert.equal(Number((await db.execute('SELECT COUNT(*) AS n FROM todos'))[0][0].n), before + 1);
    });
    await step('permanent plant deletion: cleanup own attachments and message copies; retain other scopes and replay tombstones', async () => {
      const keptPet = (await api('/plant/pet-create', { nickname: '同账号保留植株' }, tokenA)).pet;
      const otherPet = (await api('/plant/pet-create', { nickname: '其他账号保留植株' }, tokenB)).pet;
      const keptTurn = await agent('/agent/chat', { sessionId: 'keep-owner-a', plantPetId: keptPet.id, message: '你好', clientTurnKey: 'keep-owner-a-turn' }, tokenA);
      const otherTurn = await agent('/agent/chat', { sessionId: 'keep-owner-b', plantPetId: otherPet.id, message: '你好', clientTurnKey: 'keep-owner-b-turn' }, tokenB);
      const fileId = await upload('conversation_image', { plantPetId: pet.id });
      const image = await agent('/vision/analyze', { sessionId: 'delete-plant-image', plantPetId: pet.id, mediaFileId: fileId,
        imageBase64, mimeType: 'image/png', message: '只介绍，不安排任务', clientTurnKey: 'delete-plant-image-turn' }, tokenA);
      assert.equal(image.success, true);
      const [[proposal]] = await db.execute('SELECT proposal_key FROM ai_action_proposals WHERE openid = ? AND plant_pet_id = ?', [loginA.openid, pet.id]);
      const [events] = await db.execute('SELECT event_key FROM ai_conversation_events WHERE openid = ? AND conversation_id = ? AND event_key IS NOT NULL', [loginA.openid, image.conversationId]);
      assert.ok(events.length);
      assert.equal((await api('/plant/pet-delete', { plantPetId: pet.id }, tokenB)).success, false);
      assert.equal((await state(fileId)).state, 'ready');
      assert.equal((await api('/plant/pet-delete', { plantPetId: pet.id }, tokenA)).success, true);
      const [[links]] = await db.execute('SELECT COUNT(*) AS n FROM ai_message_media_links WHERE file_id = ?', [fileId]); assert.equal(Number(links.n), 0);
      const [[messages]] = await db.execute('SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [image.conversationId]); assert.equal(Number(messages.n), 0);
      const [[retired]] = await db.execute('SELECT status, payload_json, consumed_target_id FROM ai_action_proposals WHERE proposal_key = ?', [proposal.proposal_key]);
      assert.equal(retired.status, 'expired'); assert.equal(retired.consumed_target_id, null);
      assert.equal(retired.payload_json.reason, 'plant_deleted');
      const [[key]] = await db.execute('SELECT COUNT(*) AS n FROM care_task_creation_keys WHERE openid = ? AND idempotency_key = ?', [loginA.openid, proposal.proposal_key]); assert.equal(Number(key.n), 1);
      for (const event of events) {
        const [[row]] = await db.execute('SELECT payload_json, target_message_id FROM ai_conversation_events WHERE openid = ? AND event_key = ?', [loginA.openid, event.event_key]);
        assert.equal(row.payload_json.reason, 'plant_deleted'); assert.equal(row.target_message_id, null);
      }
      assert.equal((await api('/care/task-proposal-confirm', { proposalKey: proposal.proposal_key }, tokenA)).success, false);
      assert.equal((await state(fileId)).state, 'delete_pending'); await cloudMedia.cleanup(db, 2); assert.equal(await state(fileId), undefined);
      for (const [token, kept, turn] of [[tokenA, keptPet, keptTurn], [tokenB, otherPet, otherTurn]]) {
        assert.equal((await api('/plant/pet', { plantPetId: kept.id }, token)).success, true);
        const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?', [turn.conversationId]); assert.equal(Number(count.n), 2);
      }
    });
    await step('negative gates and unchanged external boundary', async () => {
      process.env.LOCAL_MEDIA_ENABLED = 'true'; assert.equal((await api('/plant/pets', {}, tokenA, 503)).code, 'CLOUD_CONFIGURATION_BLOCKED');
      process.env.LOCAL_MEDIA_ENABLED = 'false';
      assert.deepEqual(providers.calls.blockedNetwork, []); assert.equal(providers.calls.wechat, 2);
      assert.equal(providers.calls.ssm, names.length); assert.equal(poolAssertions, names.length);
      assert.ok(providers.calls.cos.length > 10);
    });
    console.log(JSON.stringify({ status: 'PASS', evidence: 'LOCAL_BUILT_CLOUD_CANDIDATE_WITH_REAL_ISOLATED_MYSQL_AND_EXTERNAL_PROVIDER_STUBS',
      databaseName, steps: results.length, results, actualCloudCalls: 0, deployed: false,
      substitutes: ['WeChat code exchange response', 'LLM and Vision response', 'COS SDK transport', 'SSM SDK transport'],
      realPaths: ['built cloud-entry and SCF business routes', 'MySQL transactions and trigger', 'session/summary persistence', 'owner/JWT checks', 'task confirmation/idempotency'],
      physicalDeviceTested: false, realCloudIamTlsAvailabilityTested: false, databasePreserved: true }, null, 2));
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
    if (db) await db.end(); await admin.end(); providers?.restore();
  }
}
main().catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', databaseName, completedSteps: results, error: error.message,
    code: error.code || null, stack: error.stack, deployed: false, databasePreserved: Boolean(databaseName) }, null, 2)); process.exitCode = 1;
});
