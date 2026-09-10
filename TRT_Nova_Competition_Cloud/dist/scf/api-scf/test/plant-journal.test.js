const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeJournalDate,
  parsePhotoFileIds,
  validateJournalInput,
  mapJournalRow
} = require('../lib/plant-journal');

const FILE_IDS = [
  'local://12345678-1234-1234-1234-123456789ab1',
  'local://12345678-1234-1234-1234-123456789ab2',
  'local://12345678-1234-1234-1234-123456789ab3'
];

test('植宠日记接受文字、0/1/3 张永久图片并生成默认标题', () => {
  for (const count of [0, 1, 3]) {
    const result = validateJournalInput({
      plantPetId: 7,
      eventDate: '2026-08-27',
      eventType: 'observation',
      content: '长出了一片新叶',
      photoFileIds: FILE_IDS.slice(0, count)
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.photoFileIds.length, count);
    assert.equal(result.value.title, '今日观察');
  }
});

test('植宠日记拒绝超过 3 张、重复或临时图片标识', () => {
  assert.equal(validateJournalInput({ plantPetId: 7, title: '  ', content: '  ', photoFileIds: [] }).ok, false);
  assert.equal(validateJournalInput({
    plantPetId: 7,
    photoFileIds: [...FILE_IDS, 'local://12345678-1234-1234-1234-123456789ab4']
  }).ok, false);
  assert.equal(validateJournalInput({ plantPetId: 7, photoFileIds: [FILE_IDS[0], FILE_IDS[0]] }).ok, false);
  assert.equal(validateJournalInput({ plantPetId: 7, photoFileIds: ['wxfile://tmp/photo.jpg'] }).ok, false);
});

test('植宠日记校验真实日期并映射时间线字段', () => {
  assert.equal(normalizeJournalDate('2026-02-30'), '');
  const record = mapJournalRow({
    id: 5,
    openid: 'owner-a',
    plant_pet_id: 7,
    plant_pet_name: '小月亮',
    plant_pet_status: 'active',
    event_date: '2026-08-27',
    event_type: 'photo',
    photos_json: JSON.stringify(FILE_IDS.slice(0, 1))
  });
  assert.equal(record.plantPetId, 7);
  assert.deepEqual(record.photoFileIds, FILE_IDS.slice(0, 1));
  assert.equal(record.plantPetName, '小月亮');
});

test('历史异常图片字段不会破坏时间线解析', () => {
  assert.deepEqual(parsePhotoFileIds('{bad-json'), []);
  assert.deepEqual(parsePhotoFileIds(JSON.stringify(['wxfile://tmp/a.jpg', FILE_IDS[0]])), [FILE_IDS[0]]);
});
