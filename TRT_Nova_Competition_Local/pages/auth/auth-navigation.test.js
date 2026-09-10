const test = require('node:test');
const assert = require('node:assert/strict');

function loadAuthPageDefinition() {
  let definition = null;
  global.getApp = () => ({ globalData: { runtimeConfig: {} } });
  global.Page = (value) => { definition = value; };
  delete require.cache[require.resolve('./auth')];
  require('./auth');
  delete global.Page;
  delete global.getApp;
  return definition;
}

function createInstance(definition) {
  return {
    data: { transitioning: false },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    _goHome: definition._goHome
  };
}

test('successful login switches home immediately and suppresses duplicate submits', () => {
  const definition = loadAuthPageDefinition();
  const instance = createInstance(definition);
  let switchCalls = 0;
  global.wx = {
    switchTab(options) {
      switchCalls += 1;
      assert.equal(options.url, '/pages/index/index');
    }
  };

  instance._goHome();
  instance._goHome();
  assert.equal(instance.data.transitioning, true);
  assert.equal(switchCalls, 1);
  delete global.wx;
});

test('failed home switch releases the login transition lock', () => {
  const definition = loadAuthPageDefinition();
  const instance = createInstance(definition);
  global.wx = {
    switchTab(options) {
      options.fail({ errMsg: 'switchTab:fail' });
    }
  };

  instance._goHome();
  assert.equal(instance.data.transitioning, false);
  delete global.wx;
});
