import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cloudRoot, repoRoot } from '../tools/common.mjs';

const require = createRequire(import.meta.url);
const runtime = require('../overlays/cloud-runtime.js');
const modes = ['legacy-direct', 'private-network', 'required'];
const environment = {
  DB_HOST: 'mysql.legacy.invalid', DB_PORT: '28245', DB_NAME: 'nova_staging_fixture',
  DB_USER: 'fixture-user', DB_PASSWORD: 'fixture-password', DB_CONN_LIMIT: '5',
  WECHAT_APPID: 'wx-fixture', WECHAT_SECRET: 'fixture-wechat-secret',
  JWT_SECRET: 'fixture-jwt-key-with-at-least-32-characters',
  MEDIA_STORAGE_PROVIDER: 'cloudbase', CLOUDBASE_STORAGE_ENV_ID: 'nova-media-fixture',
  CLOUDBASE_STORAGE_REGION: 'ap-shanghai', CLOUDBASE_STORAGE_PREFIX: 'nova-staging/fixture/media/',
  NOVA_INGEST_ENABLED: 'true', ONE_NET_TOKEN: 'fixture-token', NOVA_HISTORY_CLEANUP_ENABLED: 'true'
};
const functions = ['auth-scf', 'api-scf', 'ingest-scf', 'agent-scf', 'history-cleanup-scf'];

test('五个云函数接受明确旧直连及保留模式，拒绝未知模式', () => {
  for (const name of functions) {
    for (const mode of modes) {
      assert.equal(runtime._private.validateRuntimeEnvironment(name, { ...environment, DB_TLS_MODE: mode }), '', name + ':' + mode);
    }
    assert.match(runtime._private.validateRuntimeEnvironment(name, { ...environment, DB_TLS_MODE: 'require' }), /DB_TLS_MODE/);
  }
});

for (const name of functions) {
  test(name + ' 实际 getDb：旧端口/库名透传，直连不加 SSL，required 保持证书校验', async () => {
    const file = path.join(repoRoot, 'dist/scf', name, name === 'agent-scf' ? 'lib/db.js' : 'index.js');
    const source = fs.readFileSync(file, 'utf8');
    // Execute the existing top-level getDb body, not a reimplementation of its options.
    // The driver is replaced before evaluation: no connection or business handler runs.
    const body = source.match(/async function getDb\(\) \{[\s\S]+?\n\}/)?.[0];
    assert.ok(body, 'Expected a top-level getDb function in ' + name);
    for (const mode of modes) {
      let captured;
      let poolCalls = 0;
      const fakePool = {};
      const getDb = vm.runInNewContext('let pool;\n' + body + '\ngetDb;', {
        process: { env: { ...environment, DB_TLS_MODE: mode, DB_SSL_CA: 'fixture-ca\\nsecond-line' } },
        require(id) {
          assert.equal(id, 'mysql2/promise');
          return { createPool(options) { captured = options; poolCalls++; return fakePool; } };
        }
      });
      assert.equal(await getDb(), fakePool);
      assert.equal(await getDb(), fakePool);
      assert.equal(poolCalls, 1, 'Preserve pool reuse');
      assert.equal(captured.host, environment.DB_HOST);
      assert.equal(captured.port, 28245);
      assert.equal(captured.database, environment.DB_NAME);
      assert.equal(captured.user, environment.DB_USER);
      assert.equal(captured.password, environment.DB_PASSWORD);
      assert.equal(captured.connectionLimit, 5);
      if (mode === 'required') {
        assert.equal(captured.ssl.rejectUnauthorized, true);
        assert.equal(captured.ssl.verifyIdentity, true);
        assert.equal(captured.ssl.ca, 'fixture-ca\nsecond-line');
      } else {
        assert.equal(Object.hasOwn(captured, 'ssl'), false);
      }
    }
  });
}

for (const tool of ['migrate-database.mjs', 'seed-reviewed-content.mjs']) {
  test(tool + ' 云端模式必须明确，不能因拼写错误意外关闭 TLS', () => {
    for (const mode of ['', 'require', 'disabled']) {
      const result = spawnSync(process.execPath, [path.join(cloudRoot, 'tools', tool),
        '--confirm-database=' + environment.DB_NAME, '--acknowledge-reviewed'], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, ...environment, DB_TLS_MODE: mode }
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /DB_TLS_MODE_REQUIRED_OR_INVALID/);
      assert.equal(result.stdout, '');
    }
  });
}
