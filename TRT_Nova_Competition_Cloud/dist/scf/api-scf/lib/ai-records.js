const { withTransaction } = require('./care-tasks');
const {
  normalizePersistentFileId,
  claimLocalMediaFiles,
  deleteLocalMediaReference
} = require('./media-storage');

const MEMORY_TYPES = new Set(['plant_fact', 'business_event', 'user_preference', 'ai_summary']);

function normalizeText(input, maxLength) {
  return (typeof input === 'string' ? input.trim() : '').slice(0, maxLength);
}

function parseJson(input, fallback) {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input === 'object') return input;
  try { return JSON.parse(input); } catch (err) { return fallback; }
}

function normalizeStringArray(input, maxCount = 8, maxLength = 240) {
  return (Array.isArray(input) ? input : [])
    .map((item) => normalizeText(String(item || ''), maxLength))
    .filter(Boolean)
    .slice(0, maxCount);
}

function normalizeCandidates(input) {
  return (Array.isArray(input) ? input : []).map((item) => ({
    name: normalizeText(item?.name, 80),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
    reason: normalizeText(item?.reason, 240)
  })).filter((item) => item.name).slice(0, 3);
}

function normalizeCauseItems(input) {
  return (Array.isArray(input) ? input : []).map((item) => ({
    name: normalizeText(item?.name || String(item || ''), 100),
    evidence: normalizeText(item?.evidence, 240),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0))
  })).filter((item) => item.name).slice(0, 6);
}

function normalizeAdviceItems(input) {
  return (Array.isArray(input) ? input : []).map((item) => ({
    title: normalizeText(item?.title || String(item || ''), 100),
    detail: normalizeText(item?.detail, 300),
    priority: ['now', 'soon', 'observe'].includes(item?.priority) ? item.priority : 'observe'
  })).filter((item) => item.title).slice(0, 8);
}

function validateDiagnosisInput(input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) return { ok: false, msg: '请选择要保存观察的植宠' };
  const analysis = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  if (analysis.isPlant !== true) return { ok: false, msg: '非植物图片不能保存为植宠观察记录' };
  const mediaFileInput = normalizeText(input.mediaFileId, 1024);
  const mediaFileId = normalizePersistentFileId(mediaFileInput);
  if (mediaFileInput && !mediaFileId) return { ok: false, msg: '诊断图片标识无效' };
  return {
    ok: true,
    value: {
      plantPetId,
      mediaFileId,
      isPlant: true,
      candidates: normalizeCandidates(analysis.candidates),
      visibleSigns: normalizeStringArray(analysis.visibleSigns),
      possibleCauses: normalizeCauseItems(analysis.possibleCauses),
      advice: normalizeAdviceItems(analysis.advice),
      reshootQuestions: normalizeStringArray(analysis.reshootQuestions, 5),
      modelVersion: normalizeText(input.modelVersion, 128),
      userCorrection: input.userCorrection && typeof input.userCorrection === 'object'
        ? input.userCorrection
        : null
    }
  };
}

function mapDiagnosis(row = {}) {
  return {
    id: Number(row.id) || 0,
    ownerOpenid: row.openid || '',
    plantPetId: Number(row.plant_pet_id) || 0,
    plantPetName: row.plant_pet_name || '',
    mediaFileId: row.media_file_id || '',
    isPlant: Boolean(row.is_plant),
    candidates: parseJson(row.candidates_json, []),
    visibleSigns: parseJson(row.visible_signs_json, []),
    possibleCauses: parseJson(row.possible_causes_json, []),
    advice: parseJson(row.advice_json, []),
    reshootQuestions: parseJson(row.reshoot_questions_json, []),
    modelVersion: row.model_version || '',
    userCorrection: parseJson(row.user_correction_json, null),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapMemory(row = {}) {
  return {
    id: Number(row.id) || 0,
    plantPetId: Number(row.plant_pet_id) || null,
    plantPetName: row.plant_pet_name || '',
    type: row.memory_type || '',
    key: row.memory_key || '',
    content: row.content || '',
    sourceType: row.source_type || '',
    sourceId: row.source_id || '',
    sourceTime: row.source_time || null,
    userConfirmed: Boolean(row.user_confirmed),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function assertActivePlantPet(db, openid, plantPetId) {
  const [rows] = await db.execute(
    `SELECT id, nickname FROM plant_pets
     WHERE id = ? AND openid = ? AND status = 'active' LIMIT 1`,
    [plantPetId, openid]
  );
  return rows[0] || null;
}

async function listDiagnosesForUser(db, openid, input = {}) {
  const clauses = ['pd.openid = ?'];
  const params = [openid];
  if (input.plantPetId) { clauses.push('pd.plant_pet_id = ?'); params.push(Number(input.plantPetId) || 0); }
  const [rows] = await db.execute(
    `SELECT pd.*, pp.nickname AS plant_pet_name,
            DATE_FORMAT(pd.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(pd.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM plant_diagnoses pd
     LEFT JOIN plant_pets pp ON pp.id = pd.plant_pet_id AND pp.openid = pd.openid
     WHERE ${clauses.join(' AND ')}
     ORDER BY pd.created_at DESC, pd.id DESC LIMIT 50`,
    params
  );
  return { success: true, diagnoses: rows.map(mapDiagnosis) };
}

async function saveDiagnosisForUser(db, openid, input = {}) {
  const validated = validateDiagnosisInput(input);
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  if (!(await assertActivePlantPet(db, openid, value.plantPetId))) {
    return { success: false, msg: '植宠不存在、已归档或无权访问' };
  }
  try {
    const diagnosisId = await withTransaction(db, async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO plant_diagnoses
          (openid, plant_pet_id, media_file_id, is_plant, candidates_json, visible_signs_json,
           possible_causes_json, advice_json, reshoot_questions_json, model_version,
           user_correction_json, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          openid,
          value.plantPetId,
          value.mediaFileId || null,
          JSON.stringify(value.candidates),
          JSON.stringify(value.visibleSigns),
          JSON.stringify(value.possibleCauses),
          JSON.stringify(value.advice),
          JSON.stringify(value.reshootQuestions),
          value.modelVersion || null,
          value.userCorrection ? JSON.stringify(value.userCorrection) : null
        ]
      );
      const id = Number(result.insertId) || 0;
      const claimed = await claimLocalMediaFiles(connection, openid, [value.mediaFileId], {
        purpose: 'diagnosis_image',
        plantPetId: value.plantPetId,
        referenceType: 'diagnosis',
        referenceKey: String(id)
      });
      if (!claimed.success) {
        const error = new Error(claimed.msg);
        error.isDomainError = true;
        throw error;
      }
      await connection.execute(
        `INSERT IGNORE INTO user_badges (openid, badge_key, earned_at, context_json)
         VALUES (?, 'first_diagnosis', CURRENT_TIMESTAMP, ?)`,
        [openid, JSON.stringify({ diagnosisId: id, plantPetId: value.plantPetId })]
      );
      return id;
    });
    const result = await listDiagnosesForUser(db, openid, { plantPetId: value.plantPetId });
    return { success: true, diagnosis: result.diagnoses.find((item) => item.id === diagnosisId) || null };
  } catch (err) {
    if (err?.isDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

async function correctDiagnosisForUser(db, openid, input = {}) {
  const diagnosisId = Number(input.diagnosisId) || 0;
  if (!diagnosisId) return { success: false, msg: '观察记录标识无效' };
  const correction = input.userCorrection && typeof input.userCorrection === 'object' ? input.userCorrection : null;
  if (!correction || JSON.stringify(correction).length > 4000) return { success: false, msg: '请填写有效的用户修正' };
  const [result] = await db.execute(
    `UPDATE plant_diagnoses SET user_correction_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND openid = ?`,
    [JSON.stringify(correction), diagnosisId, openid]
  );
  return result.affectedRows ? { success: true, diagnosisId } : { success: false, msg: '观察记录不存在或无权访问' };
}

async function deleteDiagnosisForUser(db, openid, input = {}) {
  const diagnosisId = Number(input.diagnosisId) || 0;
  if (!diagnosisId) return { success: false, msg: '观察记录标识无效' };
  const deleted = await withTransaction(db, async (connection) => {
    const [rows] = await connection.execute(
      'SELECT id FROM plant_diagnoses WHERE id = ? AND openid = ? LIMIT 1 FOR UPDATE',
      [diagnosisId, openid]
    );
    if (!rows.length) return false;
    await deleteLocalMediaReference(connection, openid, 'diagnosis', String(diagnosisId));
    await connection.execute('DELETE FROM ai_memories WHERE openid = ? AND memory_key = ?', [openid, `diagnosis:${diagnosisId}`]);
    await connection.execute('DELETE FROM plant_diagnoses WHERE id = ? AND openid = ?', [diagnosisId, openid]);
    return true;
  });
  return deleted ? { success: true, diagnosisId } : { success: false, msg: '观察记录不存在或无权访问' };
}

async function listMemoriesForUser(db, openid, input = {}) {
  const clauses = ['am.openid = ?'];
  const params = [openid];
  if (input.plantPetId) { clauses.push('am.plant_pet_id = ?'); params.push(Number(input.plantPetId) || 0); }
  if (input.memoryType && MEMORY_TYPES.has(input.memoryType)) { clauses.push('am.memory_type = ?'); params.push(input.memoryType); }
  const [rows] = await db.execute(
    `SELECT am.*, pp.nickname AS plant_pet_name,
            DATE_FORMAT(am.source_time, '%Y-%m-%d %H:%i:%s') AS source_time,
            DATE_FORMAT(am.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(am.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM ai_memories am
     LEFT JOIN plant_pets pp ON pp.id = am.plant_pet_id AND pp.openid = am.openid
     WHERE ${clauses.join(' AND ')}
     ORDER BY am.updated_at DESC, am.id DESC LIMIT 200`,
    params
  );
  return { success: true, memories: rows.map(mapMemory) };
}

async function createMemoryForUser(db, openid, input = {}) {
  if (input.confirmed !== true) return { success: false, msg: '长期偏好需由用户确认后保存' };
  const content = normalizeText(input.content, 1000);
  if (!content) return { success: false, msg: '请填写记忆内容' };
  const plantPetId = Number(input.plantPetId) || null;
  if (plantPetId && !(await assertActivePlantPet(db, openid, plantPetId))) {
    return { success: false, msg: '植宠不存在、已归档或无权访问' };
  }
  const key = `user_preference:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const [result] = await db.execute(
    `INSERT INTO ai_memories
      (openid, plant_pet_id, memory_type, memory_key, content, source_type, source_id,
       source_time, user_confirmed, created_at, updated_at)
     VALUES (?, ?, 'user_preference', ?, ?, 'user', NULL, CURRENT_TIMESTAMP, 1,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [openid, plantPetId, key, content]
  );
  return { success: true, memoryId: Number(result.insertId) || 0 };
}

async function updateMemoryForUser(db, openid, input = {}) {
  const memoryId = Number(input.memoryId) || 0;
  const content = normalizeText(input.content, 1000);
  if (!memoryId || !content) return { success: false, msg: '记忆标识或内容无效' };
  const [result] = await db.execute(
    `UPDATE ai_memories
     SET content = ?, user_confirmed = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND openid = ?
       AND memory_type = 'user_preference' AND user_confirmed = 1`,
    [content, memoryId, openid]
  );
  return result.affectedRows
    ? { success: true, memoryId }
    : { success: false, msg: '只有你确认保存的偏好可以直接修正；档案和养护事实请回到原记录修改' };
}

async function deleteMemoryForUser(db, openid, input = {}) {
  const memoryId = Number(input.memoryId) || 0;
  if (!memoryId) return { success: false, msg: '记忆标识无效' };
  const [result] = await db.execute('DELETE FROM ai_memories WHERE id = ? AND openid = ?', [memoryId, openid]);
  return result.affectedRows ? { success: true, memoryId } : { success: false, msg: '记忆不存在或无权访问' };
}

async function clearMemoriesForUser(db, openid, input = {}) {
  if (input.confirmed !== true) return { success: false, msg: '请确认清除全部 AI 记忆' };
  const plantPetId = Number(input.plantPetId) || 0;
  const [result] = plantPetId
    ? await db.execute('DELETE FROM ai_memories WHERE openid = ? AND plant_pet_id = ?', [openid, plantPetId])
    : await db.execute('DELETE FROM ai_memories WHERE openid = ?', [openid]);
  return { success: true, deleted: Number(result.affectedRows) || 0 };
}

module.exports = {
  MEMORY_TYPES,
  normalizeCandidates,
  normalizeCauseItems,
  normalizeAdviceItems,
  validateDiagnosisInput,
  mapDiagnosis,
  mapMemory,
  listDiagnosesForUser,
  saveDiagnosisForUser,
  correctDiagnosisForUser,
  deleteDiagnosisForUser,
  listMemoriesForUser,
  createMemoryForUser,
  updateMemoryForUser,
  deleteMemoryForUser,
  clearMemoriesForUser
};
