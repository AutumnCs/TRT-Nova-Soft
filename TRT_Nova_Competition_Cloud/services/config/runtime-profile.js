const { DEFAULT_RUNTIME_CONFIG } = require('./runtime');

// Cloud source is inert until cloud:client supplies the deployment origin.
// Even a mistaken direct DevTools import must not reach the local or old backend.
const LOCAL_BASE_URL = 'https://configure-competition.invalid';

const REMOTE_ENDPOINTS = Object.freeze({
  scfApiBaseUrl: 'https://configure-competition.invalid',
  agentScfBaseUrl: 'https://configure-competition.invalid',
  authScfBaseUrl: 'https://configure-competition.invalid'
});

const PROFILE_CONFIGS = Object.freeze({
  development: Object.freeze({
    runtimeProfile: 'development',
    useCloudBase: false,
    enableDevPhoneLogin: false,
    scfApiBaseUrl: LOCAL_BASE_URL,
    agentScfBaseUrl: LOCAL_BASE_URL,
    authScfBaseUrl: LOCAL_BASE_URL
  }),
  experience: Object.freeze({
    runtimeProfile: 'experience',
    useCloudBase: false,
    enableDevPhoneLogin: false,
    ...REMOTE_ENDPOINTS
  }),
  release: Object.freeze({
    runtimeProfile: 'release',
    useCloudBase: false,
    enableDevPhoneLogin: false,
    ...REMOTE_ENDPOINTS
  })
});

function normalizeRuntimeProfile(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'develop' || profile === 'development') return 'development';
  if (profile === 'trial' || profile === 'experience') return 'experience';
  if (profile === 'release') return 'release';
  return 'experience';
}

function detectRuntimeProfile(wxApi) {
  if (!wxApi || typeof wxApi.getAccountInfoSync !== 'function') {
    return 'experience';
  }

  try {
    const envVersion = wxApi.getAccountInfoSync()?.miniProgram?.envVersion;
    return normalizeRuntimeProfile(envVersion);
  } catch (err) {
    return 'experience';
  }
}

function isLocalServiceUrl(value) {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(String(value || ''));
}

function assertRuntimeConfig(profile, config) {
  if (profile === 'development') return;

  const serviceUrls = [
    config.scfApiBaseUrl,
    config.agentScfBaseUrl,
    config.authScfBaseUrl
  ];

  if (serviceUrls.some(isLocalServiceUrl)) {
    throw new Error(`${profile} runtime must not use a local backend URL`);
  }
}

function createRuntimeConfig(profileValue, overrides = {}) {
  const profile = normalizeRuntimeProfile(profileValue);
  const config = {
    ...DEFAULT_RUNTIME_CONFIG,
    mediaStorageProvider: 'cloudbase',
    cloudbaseStorageEnvId: '',
    ...PROFILE_CONFIGS[profile],
    ...overrides,
    runtimeProfile: profile
  };

  assertRuntimeConfig(profile, config);
  return config;
}

function resolveAppRuntimeConfig(wxApi = typeof wx === 'undefined' ? null : wx) {
  return createRuntimeConfig(detectRuntimeProfile(wxApi));
}

module.exports = {
  LOCAL_BASE_URL,
  REMOTE_ENDPOINTS,
  PROFILE_CONFIGS,
  normalizeRuntimeProfile,
  detectRuntimeProfile,
  isLocalServiceUrl,
  assertRuntimeConfig,
  createRuntimeConfig,
  resolveAppRuntimeConfig
};
