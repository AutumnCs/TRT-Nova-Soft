const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  scfApiBaseUrl: '',
  agentScfBaseUrl: '',
  authScfBaseUrl: '',
  enableDevPhoneLogin: false,
  scfRequestTimeoutMs: 8000
});

function resolveRuntimeConfig(overrides = {}) {
  let appConfig = {};

  if (typeof getApp === 'function') {
    try {
      const app = getApp();
      appConfig = app?.globalData?.runtimeConfig || {};
    } catch (err) {
      appConfig = {};
    }
  }

  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...appConfig,
    ...overrides
  };
}

module.exports = {
  DEFAULT_RUNTIME_CONFIG,
  resolveRuntimeConfig
};
