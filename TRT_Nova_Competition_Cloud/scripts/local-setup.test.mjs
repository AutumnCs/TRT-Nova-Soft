import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setupLocal } from './setup-local.mjs';
import { projectRoot, parseEnvironment, validateLocalSettings } from './local-env.mjs';

test('本地配置可移植、不覆盖已有配置、不打印凭据', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-local-config-'));
  try {
    fs.copyFileSync(path.join(projectRoot, '.env.local.example'), path.join(temp, '.env.local.example'));
    const result = setupLocal({ port: '3130', 'db-port': '3308', database: 'nova_competition_fixture' }, temp);
    const env = parseEnvironment(fs.readFileSync(path.join(temp, '.env.local'), 'utf8'));
    assert.equal(env.LOCAL_PORT, '3130'); assert.equal(env.DB_PORT, '3308');
    assert.equal(env.DB_NAME, 'nova_competition_fixture'); assert.equal(env.JWT_SECRET.length, 64);
    assert.equal(JSON.stringify(result).includes(env.DB_PASSWORD), false);
    assert.equal(env.LLM_API_KEY_FILE, '');
    const before = fs.readFileSync(path.join(temp, '.env.local'), 'utf8');
    assert.throws(() => setupLocal({}, temp), /NO_OVERWRITE/);
    assert.equal(fs.readFileSync(path.join(temp, '.env.local'), 'utf8'), before);
    assert.throws(() => validateLocalSettings({ ...env, DB_NAME: 'zhichong_v01_local' }), /COMPETITION_NAME/);
    assert.throws(() => validateLocalSettings({ ...env, DB_HOST: 'remote.example.com' }), /LOOPBACK/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
