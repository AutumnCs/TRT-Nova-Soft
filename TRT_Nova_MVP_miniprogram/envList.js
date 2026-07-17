// Optional explicit cloud environment list for local development.
// Keep empty to use the mini program default cloud environment.
// Example:
// const envList = ['cloud1-xxxx'];
const envList = ['cloud1-6gfrptied648aa39'];

// Runtime profile used by app.js.
// Supported values: dev, test, prod.
const runtimeProfile = 'prod';

// Optional per-machine or per-branch overrides.
const runtimeConfigOverrides = {};

const isMac = false;

module.exports = {
  envList,
  runtimeProfile,
  runtimeConfigOverrides,
  isMac
};
