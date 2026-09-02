function isDevPhoneLoginEnabled(runtimeConfig = {}) {
  return runtimeConfig.enableDevPhoneLogin === true;
}

module.exports = {
  isDevPhoneLoginEnabled
};
