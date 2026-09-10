const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCAL_BASE_URL,
  detectRuntimeProfile,
  createRuntimeConfig,
  isLocalServiceUrl
} = require('./runtime-profile');

function wxWithEnvVersion(envVersion) {
  return {
    getAccountInfoSync() {
      return { miniProgram: { envVersion } };
    }
  };
}

test('开发版自动使用本地后端并绕开 CloudBase', () => {
  const profile = detectRuntimeProfile(wxWithEnvVersion('develop'));
  const config = createRuntimeConfig(profile);

  assert.equal(profile, 'development');
  assert.equal(config.scfApiBaseUrl, LOCAL_BASE_URL);
  assert.equal(config.useCloudBase, false);
});

test('未配置的体验版和正式版不再连接旧项目或 CloudBase', () => {
  for (const envVersion of ['trial', 'release']) {
    const profile = detectRuntimeProfile(wxWithEnvVersion(envVersion));
    const config = createRuntimeConfig(profile);

    assert.equal(isLocalServiceUrl(config.scfApiBaseUrl), false);
    assert.equal(config.useCloudBase, false);
    assert.equal(new URL(config.scfApiBaseUrl).hostname, 'configure-competition.invalid');
  }
});

test('无法读取微信环境时使用体验配置', () => {
  assert.equal(detectRuntimeProfile(null), 'experience');
  assert.equal(detectRuntimeProfile({ getAccountInfoSync() { throw new Error('unavailable'); } }), 'experience');
});

test('体验或正式配置拒绝本地后端地址', () => {
  assert.throws(
    () => createRuntimeConfig('experience', { scfApiBaseUrl: 'http://localhost:3000' }),
    /must not use a local backend URL/
  );
  assert.throws(
    () => createRuntimeConfig('release', { agentScfBaseUrl: 'http://127.0.0.1:3000' }),
    /must not use a local backend URL/
  );
});
