const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadAuthPage() {
  let definition;
  global.getApp = () => ({ globalData: { runtimeConfig: {} } });
  global.Page = (value) => { definition = value; };
  try {
    delete require.cache[require.resolve('./auth')];
    require('./auth');
  } finally {
    delete global.Page;
    delete global.getApp;
  }
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.');
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    }
  };
}

function selectedProfile(page) {
  page.data.userInfo = {
    avatarUrl: 'https://example.test/selected-avatar.jpg',
    avatarFileId: 'cloud://profile/selected-avatar.jpg',
    nickName: '小园丁'
  };
  page._updateCanSave();
}

test('profile shortcut uses native avatar selection, never legacy profile replacement', () => {
  const page = loadAuthPage();
  const markup = fs.readFileSync(path.join(__dirname, 'auth.wxml'), 'utf8');
  const shortcut = markup.match(/<button\b[^>]*class="wechat-profile-btn"[^>]*>/)?.[0];
  assert.ok(shortcut, 'native profile shortcut exists');
  assert.match(shortcut, /open-type="chooseAvatar"/);
  assert.match(shortcut, /bindchooseavatar="onChooseAvatar"/);
  assert.doesNotMatch(shortcut, /bindtap="onUseWechatProfile"/);
  assert.equal(page.onUseWechatProfile, undefined);
  assert.match(markup, /type="nickname"/);
  assert.doesNotMatch(markup, /使用微信头像昵称/);
});

test('choosing an avatar updates only the avatar and preserves an entered nickname', () => {
  const page = loadAuthPage();
  selectedProfile(page);
  page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://new-avatar.jpg' } });
  assert.deepEqual(page.data.userInfo, {
    avatarUrl: 'wxfile://new-avatar.jpg', avatarFileId: '', nickName: '小园丁'
  });
  assert.equal(page.data.canSave, true);
});

test('cancelled or empty avatar selection preserves the entire selected profile', () => {
  const page = loadAuthPage();
  selectedProfile(page);
  const before = JSON.parse(JSON.stringify(page.data));
  for (const event of [undefined, {}, { detail: {} }, { detail: { avatarUrl: '' } }]) {
    page.onChooseAvatar(event);
    assert.deepEqual(page.data, before);
  }
});

test('avatar callback during save cannot replace the profile being saved', () => {
  const page = loadAuthPage();
  selectedProfile(page);
  page.data.saving = true;
  const before = JSON.parse(JSON.stringify(page.data));
  page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://late-avatar.jpg' } });
  assert.deepEqual(page.data, before);
});

test('nickname selection preserves the selected avatar and its persisted file id', () => {
  const page = loadAuthPage();
  selectedProfile(page);
  page.onNickNameChange({ detail: { value: ' 新昵称 ' } });
  assert.deepEqual(page.data.userInfo, {
    avatarUrl: 'https://example.test/selected-avatar.jpg',
    avatarFileId: 'cloud://profile/selected-avatar.jpg',
    nickName: '新昵称'
  });
  assert.equal(page.data.canSave, true);
});

test('App avatar picker preserves data on cancel and ignores a late success while saving', (t) => {
  const page = loadAuthPage();
  selectedProfile(page);
  let picker;
  let calls = 0;
  global.wx = { chooseImage(options) { calls += 1; picker = options; } };
  t.after(() => { delete global.wx; });
  const before = JSON.parse(JSON.stringify(page.data));
  page.onPickAvatar();
  assert.deepEqual(page.data, before);
  picker.success({ tempFilePaths: [] });
  assert.deepEqual(page.data, before);
  page.data.saving = true;
  picker.success({ tempFilePaths: ['wxfile://late-app-avatar.jpg'] });
  assert.deepEqual(page.data.userInfo, before.userInfo);
  page.onPickAvatar();
  assert.equal(calls, 1);
});

test('App avatar picker success preserves nickname and requires the new avatar upload', (t) => {
  const page = loadAuthPage();
  selectedProfile(page);
  global.wx = { chooseImage(options) { options.success({ tempFilePaths: ['wxfile://app-avatar.jpg'] }); } };
  t.after(() => { delete global.wx; });
  page.onPickAvatar();
  assert.deepEqual(page.data.userInfo, {
    avatarUrl: 'wxfile://app-avatar.jpg', avatarFileId: '', nickName: '小园丁'
  });
  assert.equal(page.data.canSave, true);
});

test('explicit clear remains the only action that resets both selected fields', () => {
  const page = loadAuthPage();
  selectedProfile(page);
  page.onUseCustomProfile();
  assert.deepEqual(page.data.userInfo, {
    avatarUrl: page.data.defaultAvatarUrl, avatarFileId: '', nickName: ''
  });
  assert.equal(page.data.canSave, false);
});
