function buildDeprecatedErrorMessage(prop = '') {
  const suffix = prop ? ` (${prop})` : '';
  return [
    `services/DB.js${suffix} is deprecated.`,
    'Use services/modules/* via ScfApiAdapter -> SCF -> MySQL instead of the old CloudBase adapter path.'
  ].join(' ');
}

const deprecatedDbProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__deprecated__') {
        return true;
      }
      if (prop === 'toString') {
        return () => '[Deprecated CloudBase DB Adapter]';
      }
      throw new Error(buildDeprecatedErrorMessage(String(prop)));
    },
    apply() {
      throw new Error(buildDeprecatedErrorMessage('call'));
    }
  }
);

module.exports = deprecatedDbProxy;
