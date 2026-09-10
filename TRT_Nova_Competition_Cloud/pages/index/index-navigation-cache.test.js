const test = require('node:test');
const assert = require('node:assert/strict');

test('首页 warm refresh 的养护摘要失败时保留原任务和连续天数', async () => {
  const previous = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  const plantService = require('../../services/modules/PlantService');
  const todoService = require('../../services/modules/TodoService');
  const originalList = plantService.listMyPlantPets;
  const originalSummary = todoService.getCareSummary;
  let pageDefinition;
  global.getApp = () => ({ globalData: { hasLogin: true }, checkLoginStatus() {}, gotoLoginPage() {} });
  global.wx = {
    getStorageSync(key) {
      if (key === 'apiAccessTokenMeta') return { openid: 'owner-a' };
      return null;
    },
    getWindowInfo() { return { statusBarHeight: 20 }; }
  };
  global.Page = (definition) => { pageDefinition = definition; };
  plantService.listMyPlantPets = async () => ({
    success: true,
    pets: [{ id: 1, ownerOpenid: 'owner-a', nickname: '新档案', status: 'active' }]
  });
  todoService.getCareSummary = async () => { throw new Error('care offline'); };

  const modulePath = require.resolve('./index.js');
  delete require.cache[modulePath];
  try {
    require(modulePath);
    const oldTask = {
      id: 11,
      ownerOpenid: 'owner-a',
      plantPetId: 1,
      title: '原有任务',
      overdue: false
    };
    const page = {
      ...pageDefinition,
      data: {
        ...pageDefinition.data,
        hasLoaded: true,
        homeTasks: [oldTask],
        careStreak: 8,
        viewMode: 'active'
      },
      setData(patch) { Object.assign(this.data, patch); }
    };
    page._loadedOpenid = 'owner-a';

    await page.loadPlantPets();

    assert.deepEqual(page.data.homeTasks, [oldTask]);
    assert.equal(page.data.careStreak, 8);
    assert.equal(page.data.activePets[0].nickname, '新档案');
    assert.match(page.data.careLoadError, /care offline/);
    assert.equal(page.data.refreshing, false);
  } finally {
    plantService.listMyPlantPets = originalList;
    todoService.getCareSummary = originalSummary;
    delete require.cache[modulePath];
    global.getApp = previous.getApp;
    global.wx = previous.wx;
    global.Page = previous.Page;
  }
});
