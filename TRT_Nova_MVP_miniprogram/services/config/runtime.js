const {
  DEFAULT_RUNTIME_PROFILE,
  resolveRuntimeProfile
} = require('./runtimeProfiles');

const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  profileName: DEFAULT_RUNTIME_PROFILE,
  useCloudBase: false,
  cloudEnvId: '',
  scfApiBaseUrl: '',
  agentScfBaseUrl: '',
  authScfBaseUrl: '',
  scfRequestTimeoutMs: 8000,
  weatherApiKey: ''
});

function buildAppRuntimeConfig({
  profileName = DEFAULT_RUNTIME_PROFILE,
  overrides = {}
} = {}) {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...resolveRuntimeProfile(profileName, overrides)
  };
}

function validateRuntimeConfig(config = {}) {
  const warnings = [];

  if (!config.scfApiBaseUrl) {
    warnings.push('scfApiBaseUrl is empty');
  }

  if (!config.authScfBaseUrl) {
    warnings.push('authScfBaseUrl is empty');
  }

  if (!config.agentScfBaseUrl) {
    warnings.push('agentScfBaseUrl is empty');
  }

  if (config.useCloudBase && !config.cloudEnvId) {
    warnings.push('useCloudBase is true but cloudEnvId is empty');
  }

  return warnings;
}

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
  buildAppRuntimeConfig,
  resolveRuntimeConfig,
  validateRuntimeConfig
};
