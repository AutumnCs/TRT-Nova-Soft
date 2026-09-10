import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth, hashPassword } from '../lib/auth.js';

test('admin auth rejects missing credentials and accepts a valid login token', async () => {
  const passwordHash = await hashPassword('correct-password');
  const auth = createAdminAuth({
    jwtSecret: 'test-admin-secret',
    repository: {
      async findByUsername(username) {
        return username === 'owner'
          ? { id: 1, username: 'owner', passwordHash, role: 'owner', status: 'active' }
          : null;
      }
    }
  });

  assert.deepEqual(await auth.authenticate({ headers: {} }), { ok: false });
  const failed = await auth.login('owner', 'wrong-password');
  assert.equal(failed.ok, false);

  const loggedIn = await auth.login('owner', 'correct-password');
  assert.equal(loggedIn.ok, true);
  assert.equal((await auth.authenticate({ headers: { authorization: `Bearer ${loggedIn.token}` } })).admin.role, 'owner');
});
