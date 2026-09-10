const test = require('node:test');
const assert = require('node:assert/strict');

function loadComponentDefinition() {
  let definition = null;
  global.Component = (value) => { definition = value; };
  delete require.cache[require.resolve('./index')];
  require('./index');
  delete global.Component;
  return definition;
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    }
  };
  Object.entries(definition.methods).forEach(([key, method]) => {
    instance[key] = method.bind(instance);
  });
  return instance;
}

test('current tab is ignored and an in-flight switch cannot be duplicated', () => {
  const definition = loadComponentDefinition();
  const instance = createInstance(definition);
  let switchCalls = 0;
  let pendingOptions = null;
  global.getCurrentPages = () => [{ route: 'pages/index/index' }];
  global.wx = {
    switchTab(options) {
      switchCalls += 1;
      pendingOptions = options;
    }
  };

  instance.switchTab({ currentTarget: { dataset: { path: '/pages/index/index', index: 0 } } });
  assert.equal(switchCalls, 0);

  instance.switchTab({ currentTarget: { dataset: { path: '/pages/calendar/calendar', index: 2 } } });
  assert.equal(switchCalls, 1);
  assert.equal(instance.data.selected, 2);
  assert.equal(instance.data.switching, true);

  instance.switchTab({ currentTarget: { dataset: { path: '/pages/profile/profile', index: 3 } } });
  assert.equal(switchCalls, 1);
  assert.equal(instance.data.switching, true);

  instance.switchTab({ currentTarget: { dataset: { path: '/pages/assistant/assistant', index: 1 } } });
  assert.equal(switchCalls, 1);
  assert.equal(instance.data.switching, true);
  pendingOptions.complete();
  assert.equal(instance.data.switching, false);

  delete global.getCurrentPages;
  delete global.wx;
});

test('failed optimistic switch rolls the selected tab back', () => {
  const definition = loadComponentDefinition();
  const instance = createInstance(definition);
  global.getCurrentPages = () => [{ route: 'pages/index/index' }];
  global.wx = {
    switchTab(options) {
      options.fail({ errMsg: 'switchTab:fail' });
      options.complete();
    }
  };

  instance.switchTab({ currentTarget: { dataset: { path: '/pages/profile/profile', index: 3 } } });
  assert.equal(instance.data.selected, 0);
  assert.equal(instance.data.switching, false);

  delete global.getCurrentPages;
  delete global.wx;
});
