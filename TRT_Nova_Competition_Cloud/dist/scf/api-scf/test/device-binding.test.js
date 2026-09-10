const test = require('node:test');
const assert = require('node:assert/strict');
const { bindDeviceForUser } = require('../index')._private;

function fixture(devices) {
  const queries = [];
  let rolledBack = false;
  const conn = {
    async beginTransaction() {}, async commit() {}, release() {},
    async rollback() { rolledBack = true; },
    async execute(sql, params) {
      if (sql.includes('FROM devices')) { queries.push(params[0]); return [devices[params[0]] ? [devices[params[0]]] : []]; }
      if (sql.includes('FROM device_acl')) return [[{ id: 1, openid: 'owner-a' }]];
      throw new Error('Unexpected query in binding fixture');
    }
  };
  return { db: { async getConnection() { return conn; } }, queries, rolledBack: () => rolledBack };
}
const active = { id: 1, logical_key: 'fixture:plant', status: 'active' };
test('设备绑定优先使用现有 Nova_ 名称', async () => {
  const f = fixture({ Nova_abc: active });
  assert.equal((await bindDeviceForUser(f.db, 'owner-a', { deviceCode: 'abc' })).success, true);
  assert.deepEqual(f.queries, ['Nova_abc']);
});
test('设备绑定兼容远端基线中的无前缀设备名', async () => {
  const f = fixture({ abc: active });
  assert.equal((await bindDeviceForUser(f.db, 'owner-a', { deviceCode: 'abc' })).success, true);
  assert.deepEqual(f.queries, ['Nova_abc', 'abc']);
});
test('带前缀设备未激活时允许回退到已激活的原始设备码', async () => {
  const f = fixture({ Nova_abc: { ...active, status: 'inactive' }, abc: active });
  assert.equal((await bindDeviceForUser(f.db, 'owner-a', { deviceCode: 'abc' })).success, true);
});
test('设备不存在或两个名称均未激活时仍拒绝绑定', async () => {
  for (const devices of [{}, { Nova_abc: { ...active, status: 'inactive' }, abc: { ...active, status: 'inactive' } }]) {
    const f = fixture(devices);
    assert.equal((await bindDeviceForUser(f.db, 'owner-a', { deviceCode: 'abc' })).success, false);
    assert.equal(f.rolledBack(), true);
  }
});
