const {
  tokenizeMemoryQuery,
  selectRelevantMemories
} = require('../runtime/memoryAdapter');

async function hasOwnedPlantPet(db, openid, plantPetId) {
  const id = Number(plantPetId) || 0;
  if (!id) return false;
  const [rows] = await db.execute(
    'SELECT id FROM plant_pets WHERE id = ? AND openid = ? LIMIT 1',
    [id, openid]
  );
  return rows.length > 0;
}

async function loadOwnedPlantPet(db, openid, plantPetId) {
  const id = Number(plantPetId) || 0;
  if (!id) return null;
  const [rows] = await db.execute(
    `SELECT pp.id, pp.nickname, pp.species_name, pp.entered_at, pp.location, pp.care_notes,
            pp.status, pl.name AS library_name, pl.scientific_name
     FROM plant_pets pp
     LEFT JOIN plant_library pl ON pl.id = pp.plant_library_id
     WHERE pp.id = ? AND pp.openid = ? LIMIT 1`,
    [id, openid]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id) || 0,
    nickname: row.nickname || '',
    speciesName: row.library_name || row.species_name || '未知品种',
    scientificName: row.scientific_name || '',
    enteredAt: row.entered_at ? String(row.entered_at).slice(0, 10) : '',
    location: row.location || '',
    careNotes: row.care_notes || '',
    status: row.status || 'active'
  };
}

async function loadRecentBusinessFacts(db, openid, plantPetId) {
  const [taskRows] = await db.execute(
    `SELECT id, task_type, title, status, DATE_FORMAT(scheduled_for, '%Y-%m-%d') AS scheduled_for,
            DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at
     FROM todos WHERE openid = ? AND plant_pet_id = ?
     ORDER BY COALESCE(completed_at, updated_at) DESC, id DESC LIMIT 8`,
    [openid, plantPetId]
  );
  const [eventRows] = await db.execute(
    `SELECT id, event_type, task_type, title,
            DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM care_events WHERE openid = ? AND plant_pet_id = ?
     ORDER BY event_date DESC, id DESC LIMIT 8`,
    [openid, plantPetId]
  );
  const [journalRows] = await db.execute(
    `SELECT id, title, content_text AS content, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM plant_journal WHERE openid = ? AND plant_pet_id = ?
     ORDER BY event_date DESC, id DESC LIMIT 5`,
    [openid, plantPetId]
  );
  const [diagnosisRows] = await db.execute(
    `SELECT id, candidates_json, visible_signs_json,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM plant_diagnoses WHERE openid = ? AND plant_pet_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 5`,
    [openid, plantPetId]
  );
  return { taskRows, eventRows, journalRows, diagnosisRows };
}

function buildPlantContextText(pet, facts = {}, memories = [], query = '') {
  if (!pet) return '';
  const tasks = (facts.taskRows || []).map((row) =>
    `${row.scheduled_for || ''} ${row.title || row.task_type || '养护任务'}（${row.status || 'pending'}）`
  );
  const memoryLines = selectRelevantMemories(memories, query, 8).map((item) =>
    `[${item.type}${item.userConfirmed ? '，用户确认' : ''}] ${item.content}`
  );
  return [
    `当前植宠：${pet.nickname}；品种：${pet.speciesName}；位置：${pet.location || '未记录'}；入室：${pet.enteredAt || '未记录'}。`,
    pet.careNotes ? `养护备注：${pet.careNotes}` : '',
    tasks.length ? `近期任务：\n${tasks.join('\n')}` : '近期没有任务记录。',
    memoryLines.length ? `可治理记忆：\n${memoryLines.join('\n')}` : '当前没有额外结构化记忆。'
  ].filter(Boolean).join('\n');
}

async function loadPlantPetContext(db, openid, plantPetId) {
  const pet = await loadOwnedPlantPet(db, openid, plantPetId);
  if (!pet) return { pet: null, facts: { taskRows: [], eventRows: [], journalRows: [], diagnosisRows: [] } };
  const facts = await loadRecentBusinessFacts(db, openid, pet.id);
  return { pet, facts };
}

module.exports = {
  hasOwnedPlantPet,
  loadOwnedPlantPet,
  loadRecentBusinessFacts,
  tokenizeMemoryQuery,
  selectRelevantMemories,
  buildPlantContextText,
  loadPlantPetContext
};
