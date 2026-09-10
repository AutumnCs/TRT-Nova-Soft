const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePagePath,
  getCurrentPagePath,
  resolveTabSelection,
  canStartTabSwitch
} = require('./navigation-state');

const tabs = [
  { pagePath: '/pages/index/index' },
  { pagePath: '/pages/assistant/assistant' },
  { pagePath: '/pages/calendar/calendar' },
  { pagePath: '/pages/profile/profile' }
];

test('normalizes page paths and resolves the active tab', () => {
  assert.equal(normalizePagePath('pages/calendar/calendar'), '/pages/calendar/calendar');
  assert.equal(getCurrentPagePath([{ route: 'pages/index/index' }]), '/pages/index/index');
  assert.equal(resolveTabSelection(tabs, 'pages/profile/profile'), 3);
  assert.equal(resolveTabSelection(tabs, 'pages/unknown/unknown'), 0);
});

test('blocks current-tab and in-flight duplicate navigation', () => {
  assert.equal(canStartTabSwitch({ currentPath: '/pages/index/index', targetPath: '/pages/index/index' }), false);
  assert.equal(canStartTabSwitch({ switching: true, currentPath: '/pages/index/index', targetPath: '/pages/calendar/calendar' }), false);
  assert.equal(canStartTabSwitch({ currentPath: '/pages/index/index', targetPath: '/pages/calendar/calendar' }), true);
});
