const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCareStatus,
  buildTaskFactsByPlant,
  mapPlantPetCard,
  splitPlantPetCards
} = require('./plant-pet-state');

test('未知品种使用待完善状态且不生成健康分', () => {
  const card = mapPlantPetCard({
    id: 1,
    nickname: '小叶子',
    isUnknownSpecies: true,
    status: 'active'
  });

  assert.equal(card.speciesName, '未知品种');
  assert.equal(card.careStatus.key, 'incomplete');
  assert.match(card.careStatus.reason, /不推断健康状况/);
  assert.equal(Object.prototype.hasOwnProperty.call(card, 'healthScore'), false);
});

test('基础档案完整时只说明已记录，不声称植物健康', () => {
  const status = buildCareStatus({
    speciesName: '月季',
    enteredAt: '2026-08-12',
    location: '南阳台',
    status: 'active'
  });

  assert.equal(status.key, 'recorded');
  assert.equal(status.label, '档案已建立');
  assert.match(status.reason, /不推断植物健康/);
});

test('到期与逾期任务生成可解释养护状态', () => {
  const facts = buildTaskFactsByPlant([
    { plantPetId: 5, overdue: true },
    { plantPetId: 5, overdue: false },
    { plantPetId: 8, overdue: false }
  ]);
  assert.deepEqual(facts[5], { dueTodayCount: 1, overdueCount: 1 });
  assert.equal(buildCareStatus({ status: 'active' }, facts[5]).key, 'overdue');
  assert.equal(buildCareStatus({ status: 'active' }, facts[8]).key, 'due');
});

test('在养与已归档档案分开显示', () => {
  const result = splitPlantPetCards([
    { id: 1, nickname: 'A', status: 'active' },
    { id: 2, nickname: 'B', status: 'archived' }
  ]);

  assert.deepEqual(result.active.map((item) => item.id), [1]);
  assert.deepEqual(result.archived.map((item) => item.id), [2]);
  assert.equal(result.archived[0].careStatus.label, '已归档');
});
