const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDiagnosisInput,
  mapDiagnosis,
  normalizeCandidates,
  clearMemoriesForUser,
  updateMemoryForUser
} = require('../lib/ai-records');

test('图片观察保存契约覆盖候选、可见现象、可能原因、建议与补拍问题', () => {
  const result = validateDiagnosisInput({
    plantPetId: 7,
    mediaFileId: 'local://12345678-1234-1234-1234-123456789abc',
    analysis: {
      isPlant: true,
      candidates: [{ name: '月季', confidence: 0.98, reason: '花型' }],
      visibleSigns: ['叶缘发黄'],
      possibleCauses: [{ name: '可能缺水', evidence: '叶缘状态', confidence: 0.4 }],
      advice: [{ title: '检查盆土', detail: '先确认表土', priority: 'now' }],
      reshootQuestions: ['补拍叶背']
    },
    modelVersion: 'vision-model'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.plantPetId, 7);
  assert.equal(result.value.candidates[0].name, '月季');
  assert.equal(result.value.visibleSigns[0], '叶缘发黄');
});

test('非植物、无植宠和临时文件路径不能保存为观察记录', () => {
  assert.equal(validateDiagnosisInput({ plantPetId: 0, analysis: { isPlant: true } }).ok, false);
  assert.equal(validateDiagnosisInput({ plantPetId: 1, analysis: { isPlant: false } }).ok, false);
  assert.equal(validateDiagnosisInput({
    plantPetId: 1,
    mediaFileId: 'wxfile://tmp/rose.jpg',
    analysis: { isPlant: true }
  }).ok, false);
});

test('图片观察数据库映射保留模型版本和用户修正', () => {
  const row = mapDiagnosis({
    id: 4,
    openid: 'owner',
    plant_pet_id: 3,
    candidates_json: JSON.stringify(normalizeCandidates([{ name: '月季', confidence: 0.9 }])),
    visible_signs_json: '[]',
    possible_causes_json: '[]',
    advice_json: '[]',
    reshoot_questions_json: '[]',
    model_version: 'vision-model',
    user_correction_json: JSON.stringify({ candidateName: '月季' })
  });
  assert.equal(row.modelVersion, 'vision-model');
  assert.equal(row.userCorrection.candidateName, '月季');
});

test('记忆清空在选择植宠时不扩大到整个账号', async () => {
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 3 }];
    }
  };
  const result = await clearMemoriesForUser(db, 'owner', { confirmed: true, plantPetId: 9 });
  assert.equal(result.deleted, 3);
  assert.match(calls[0].sql, /openid = \? AND plant_pet_id = \?/);
  assert.deepEqual(calls[0].params, ['owner', 9]);
});

test('后台只允许修正用户确认偏好，派生事实不能绕过页面直接编辑', async () => {
  const calls = [];
  const deniedDb = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 0 }];
    }
  };
  const result = await updateMemoryForUser(deniedDb, 'owner', { memoryId: 7, content: '伪造的新事实' });
  assert.equal(result.success, false);
  assert.match(result.msg, /只有你确认保存的偏好/);
  assert.match(calls[0].sql, /memory_type = 'user_preference'/);
  assert.match(calls[0].sql, /user_confirmed = 1/);
});
