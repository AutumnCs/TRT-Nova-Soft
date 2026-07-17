const DEFAULT_RUNTIME_PROFILE = 'prod';

const RUNTIME_PROFILES = Object.freeze({
  dev: Object.freeze({
    profileName: 'dev',
    useCloudBase: false,
    cloudEnvId: '',
    scfApiBaseUrl: '',
    agentScfBaseUrl: '',
    authScfBaseUrl: '',
    scfRequestTimeoutMs: 8000,
    weatherApiKey: ''
  }),
  test: Object.freeze({
    profileName: 'test',
    useCloudBase: false,
    cloudEnvId: '',
    scfApiBaseUrl: '',
    agentScfBaseUrl: '',
    authScfBaseUrl: '',
    scfRequestTimeoutMs: 8000,
    weatherApiKey: ''
  }),
  prod: Object.freeze({
    profileName: 'prod',
    useCloudBase: false,
    cloudEnvId: '',
    scfApiBaseUrl: 'https://1395114552-hkiu70pwre.ap-shanghai.tencentscf.com',
    agentScfBaseUrl: 'https://1395114552-5acci5kbwy.ap-shanghai.tencentscf.com',
    authScfBaseUrl: 'https://1395114552-0etc4ugmnu.ap-shanghai.tencentscf.com',
    scfRequestTimeoutMs: 8000,
    weatherApiKey: ''
  })
});

function getAvailableRuntimeProfiles() {
  return Object.keys(RUNTIME_PROFILES);
}

function resolveRuntimeProfile(profileName = DEFAULT_RUNTIME_PROFILE, overrides = {}) {
  const normalizedName = typeof profileName === 'string' ? profileName.trim() : '';
  const selectedProfile = RUNTIME_PROFILES[normalizedName] || RUNTIME_PROFILES[DEFAULT_RUNTIME_PROFILE];

  return {
    ...selectedProfile,
    ...overrides,
    profileName: selectedProfile.profileName
  };
}

module.exports = {
  DEFAULT_RUNTIME_PROFILE,
  RUNTIME_PROFILES,
  getAvailableRuntimeProfiles,
  resolveRuntimeProfile
};
