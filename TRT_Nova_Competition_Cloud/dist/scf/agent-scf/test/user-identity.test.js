const test = require('node:test');
const assert = require('node:assert/strict');

const { hasOwnedPlantPet } = require('../agent/petContext');
const { buildSafetyMeta } = require('../lib/safety');
const {
  loadUserDisplayProfile,
  buildUserIdentityResponse
} = require('../agent/userIdentity');

test('账号称呼只按 JWT openid 读取 users.nick_name', async () => {
  let capturedSql = '';
  let capturedParams = [];
  const db = {
    async execute(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return [[{ nick_name: '  小叶子  ' }]];
    }
  };

  const profile = await loadUserDisplayProfile(db, 'owner-a');
  assert.deepEqual(profile, { available: true, displayName: '小叶子' });
  assert.match(capturedSql, /^\s*SELECT nick_name\s+FROM users\s+WHERE openid = \?\s+LIMIT 1\s*$/s);
  assert.doesNotMatch(capturedSql, /unionid|avatar|gender|birthday|region|phone|email/i);
  assert.deepEqual(capturedParams, ['owner-a']);
});

test('只读能力清单显式披露账号昵称读取而不增加资料写权限', () => {
  const safety = buildSafetyMeta();
  assert.ok(safety.capabilities.readTools.includes('get_user_display_name'));
  assert.equal(safety.capabilities.actionToolsEnabled, false);
  assert.equal(safety.actionPolicy.allowActions, false);
});

test('账号没有昵称时返回可治理的个人资料入口，不虚构身份', () => {
  const response = buildUserIdentityResponse(
    { available: true, displayName: '' },
    {},
    { status: 'in_scope', reason: 'personal_identity' }
  );
  assert.equal(response.scope.status, 'in_scope');
  assert.equal(response.scope.reason, 'personal_identity');
  assert.match(`${response.summary}\n${response.diagnosis}`, /没有设置昵称.*我的 → 个人资料/s);
  assert.match(response.diagnosis, /真实姓名.*手机号.*证件号.*账号密码/);
  assert.equal(response.sources.length, 0);
  assert.equal(response.taskSuggestions.length, 0);
  assert.equal(response.disclaimer, '');
});

test('账号有昵称时只把它表述为账号称呼而不冒充真实身份', () => {
  const response = buildUserIdentityResponse(
    { available: true, displayName: '小叶子' },
    {},
    { status: 'in_scope', reason: 'personal_identity' }
  );
  assert.match(response.summary, /账号资料.*小叶子/);
  assert.match(response.diagnosis, /只代表.*账号.*不等于.*真实身份/);
  assert.equal(response.intent.type, 'user_identity');
  assert.equal(response.memoryUpdated, undefined);
});

test('聊天内提供称呼时不声称已持久保存，并引导用户显式维护账号资料', () => {
  const response = buildUserIdentityResponse(
    {},
    {},
    { status: 'in_scope', reason: 'nickname_preference' }
  );
  const text = `${response.summary}\n${response.diagnosis}`;
  assert.match(text, /愿意.*称呼/);
  assert.match(text, /不会自动修改账号资料.*不会.*写进 AI 养护记忆/s);
  assert.match(text, /我的 → 个人资料/);
  assert.doesNotMatch(text, /已经记住|永久记住|长期记住/);
  assert.equal(response.intent.type, 'nickname_preference');
});

test('身份分支只用最小 PlantPet 所有权查询验证会话关联', async () => {
  let capturedSql = '';
  let capturedParams = [];
  const db = {
    async execute(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return [[{ id: 7 }]];
    }
  };
  assert.equal(await hasOwnedPlantPet(db, 'owner-a', 7), true);
  assert.equal(capturedSql, 'SELECT id FROM plant_pets WHERE id = ? AND openid = ? LIMIT 1');
  assert.deepEqual(capturedParams, [7, 'owner-a']);
});
