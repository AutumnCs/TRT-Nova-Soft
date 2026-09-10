const {
  shanghaiDateFromMs,
  withTransaction,
  syncCareBadges
} = require('./care-tasks');
const {
  isLocalFileId,
  isLocalMediaEnabled,
  normalizeFileIds,
  normalizePersistentFileId,
  claimLocalMediaFiles,
  deleteLocalMediaFiles,
  deleteLocalMediaReference
} = require('./media-storage');

const JOURNAL_EVENT_TYPES = new Set([
  'note',
  'photo',
  'observation',
  'watering',
  'fertilizing',
  'pruning',
  'repotting'
]);

const DEFAULT_TITLES = Object.freeze({
  note: '成长记录',
  photo: '成长照片',
  observation: '今日观察',
  watering: '浇水记录',
  fertilizing: '施肥记录',
  pruning: '修剪记录',
  repotting: '换盆记录'
});

const JOURNAL_SELECT = `
  SELECT pj.id, pj.openid, pj.logical_key, pj.plant_pet_id, pj.plant_library_id,
         DATE_FORMAT(pj.event_date, '%Y-%m-%d') AS event_date,
         pj.event_type, pj.title, pj.content_text, pj.photos_json, pj.related_todo_id,
         DATE_FORMAT(pj.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(pj.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         pp.nickname AS plant_pet_name, pp.status AS plant_pet_status
  FROM plant_journal pj
  INNER JOIN plant_pets pp ON pp.id = pj.plant_pet_id AND pp.openid = pj.openid
`;

function hasOwn(input, key) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function normalizeText(input, maxLength) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, maxLength);
}

function normalizeJournalDate(input) {
  const value = normalizeText(input, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '';
  return value;
}

function parsePhotoFileIds(value) {
  if (Array.isArray(value)) return value.map(normalizePersistentFileId).filter(Boolean).slice(0, 3);
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(normalizePersistentFileId).filter(Boolean).slice(0, 3) : [];
  } catch (err) {
    return [];
  }
}

function validateJournalInput(input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { ok: false, msg: '请选择植宠' };
  }
  const eventDate = normalizeJournalDate(input.eventDate || shanghaiDateFromMs());
  if (!eventDate) return { ok: false, msg: '记录日期无效' };

  const eventType = normalizeText(input.eventType || 'note', 32).toLowerCase();
  if (!JOURNAL_EVENT_TYPES.has(eventType)) return { ok: false, msg: '记录类型无效' };

  const sourcePhotos = Array.isArray(input.photoFileIds) ? input.photoFileIds : [];
  if (sourcePhotos.length > 3) return { ok: false, msg: '每条日记最多添加 3 张图片' };
  const photoFileIds = normalizeFileIds(sourcePhotos, 3);
  if (photoFileIds.length !== sourcePhotos.length) {
    return { ok: false, msg: '日记图片标识无效或重复' };
  }

  const titleInput = normalizeText(input.title, 128);
  const content = normalizeText(input.content, 2000);
  if (!titleInput && !content && !photoFileIds.length) {
    return { ok: false, msg: '请填写文字或添加图片' };
  }
  const title = titleInput || DEFAULT_TITLES[eventType];

  return {
    ok: true,
    value: {
      plantPetId,
      eventDate,
      eventType,
      title,
      content,
      photoFileIds
    }
  };
}

function mapJournalRow(row = {}) {
  return {
    id: Number(row.id) || 0,
    ownerOpenid: row.openid || '',
    plantPetId: Number(row.plant_pet_id || row.plantPetId) || 0,
    plantPetName: row.plant_pet_name || row.plantPetName || '',
    plantPetStatus: row.plant_pet_status || row.plantPetStatus || 'active',
    eventDate: row.event_date || row.eventDate || '',
    eventType: row.event_type || row.eventType || 'note',
    title: row.title || '',
    content: row.content_text || row.content || '',
    photoFileIds: parsePhotoFileIds(row.photos_json || row.photoFileIds),
    relatedTodoId: Number(row.related_todo_id || row.relatedTodoId) || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null
  };
}

async function getOwnedPlantPet(db, openid, plantPetId, requireActive = false) {
  const [rows] = await db.execute(
    `SELECT id, nickname, status FROM plant_pets
     WHERE id = ? AND openid = ? ${requireActive ? "AND status = 'active'" : ''}
     LIMIT 1`,
    [plantPetId, openid]
  );
  return rows[0] || null;
}

function createDomainError(message) {
  const error = new Error(message);
  error.isJournalDomainError = true;
  return error;
}

async function claimJournalPhotos(db, openid, value, journalId) {
  if (isLocalMediaEnabled() && value.photoFileIds.some((fileId) => !isLocalFileId(fileId))) {
    return { success: false, msg: '本地日记只能使用已持久化的本地图片' };
  }
  return claimLocalMediaFiles(db, openid, value.photoFileIds, {
    purpose: 'journal_photo',
    plantPetId: value.plantPetId,
    referenceType: 'journal',
    referenceKey: String(journalId)
  });
}

async function listJournalTimelineForUser(db, openid, input = {}) {
  const clauses = ['pj.openid = ?', 'pj.plant_pet_id IS NOT NULL'];
  const params = [openid];
  const plantPetId = Number(input.plantPetId) || 0;
  if (input.plantPetId !== undefined) {
    if (!plantPetId || !(await getOwnedPlantPet(db, openid, plantPetId, false))) {
      return { success: false, msg: '植宠不存在或无权访问' };
    }
    clauses.push('pj.plant_pet_id = ?');
    params.push(plantPetId);
  }
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const [rows] = await db.execute(
    `${JOURNAL_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY pj.event_date DESC, pj.created_at DESC, pj.id DESC
     LIMIT ${limit}`,
    params
  );
  return { success: true, records: rows.map(mapJournalRow) };
}

async function getJournalRecordForUser(db, openid, input = {}) {
  const journalId = Number(input.journalId) || 0;
  if (!journalId) return { success: false, msg: '日记标识无效' };
  const [rows] = await db.execute(
    `${JOURNAL_SELECT} WHERE pj.id = ? AND pj.openid = ? LIMIT 1`,
    [journalId, openid]
  );
  if (!rows.length) return { success: false, msg: '日记不存在或无权访问' };
  return { success: true, record: mapJournalRow(rows[0]) };
}

async function createJournalRecordForUser(db, openid, input = {}) {
  const validated = validateJournalInput(input);
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  try {
    const result = await withTransaction(db, async (connection) => {
      if (!(await getOwnedPlantPet(connection, openid, value.plantPetId, true))) {
        throw createDomainError('植宠不存在、已归档或无权访问');
      }
      const [insert] = await connection.execute(
        `INSERT INTO plant_journal
          (openid, logical_key, plant_pet_id, plant_library_id, event_date, event_type,
           title, content_text, photos_json, related_todo_id, created_at, updated_at)
         VALUES (?, '', ?, NULL, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          openid,
          value.plantPetId,
          value.eventDate,
          value.eventType,
          value.title,
          value.content || null,
          JSON.stringify(value.photoFileIds)
        ]
      );
      const journalId = Number(insert.insertId) || 0;
      const claimed = await claimJournalPhotos(connection, openid, value, journalId);
      if (!claimed.success) throw createDomainError(claimed.msg);
      return journalId;
    });
    await syncCareBadges(db, openid);
    return getJournalRecordForUser(db, openid, { journalId: result });
  } catch (err) {
    if (err.isJournalDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

async function updateJournalRecordForUser(db, openid, input = {}) {
  const journalId = Number(input.journalId) || 0;
  if (!journalId) return { success: false, msg: '日记标识无效' };
  try {
    await withTransaction(db, async (connection) => {
      const [rows] = await connection.execute(
        `${JOURNAL_SELECT} WHERE pj.id = ? AND pj.openid = ? LIMIT 1 FOR UPDATE`,
        [journalId, openid]
      );
      if (!rows.length) throw createDomainError('日记不存在或无权访问');
      const current = mapJournalRow(rows[0]);
      if (current.plantPetStatus !== 'active') throw createDomainError('已归档植宠的日记不能编辑');

      const validated = validateJournalInput({
        plantPetId: current.plantPetId,
        eventDate: hasOwn(input, 'eventDate') ? input.eventDate : current.eventDate,
        eventType: hasOwn(input, 'eventType') ? input.eventType : current.eventType,
        title: hasOwn(input, 'title') ? input.title : current.title,
        content: hasOwn(input, 'content') ? input.content : current.content,
        photoFileIds: hasOwn(input, 'photoFileIds') ? input.photoFileIds : current.photoFileIds
      });
      if (!validated.ok) throw createDomainError(validated.msg);
      const value = validated.value;
      const claimed = await claimJournalPhotos(connection, openid, value, journalId);
      if (!claimed.success) throw createDomainError(claimed.msg);

      await connection.execute(
        `UPDATE plant_journal
         SET event_date = ?, event_type = ?, title = ?, content_text = ?, photos_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND openid = ?`,
        [
          value.eventDate,
          value.eventType,
          value.title,
          value.content || null,
          JSON.stringify(value.photoFileIds),
          journalId,
          openid
        ]
      );
      const removed = current.photoFileIds.filter((fileId) => !value.photoFileIds.includes(fileId));
      await deleteLocalMediaFiles(connection, openid, removed, {
        referenceType: 'journal',
        referenceKey: String(journalId)
      });
    });
    return getJournalRecordForUser(db, openid, { journalId });
  } catch (err) {
    if (err.isJournalDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

async function deleteJournalRecordForUser(db, openid, input = {}) {
  const journalId = Number(input.journalId) || 0;
  if (!journalId) return { success: false, msg: '日记标识无效' };
  try {
    await withTransaction(db, async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id FROM plant_journal WHERE id = ? AND openid = ? LIMIT 1 FOR UPDATE',
        [journalId, openid]
      );
      if (!rows.length) throw createDomainError('日记不存在或无权访问');
      await connection.execute('DELETE FROM plant_journal WHERE id = ? AND openid = ?', [journalId, openid]);
      await deleteLocalMediaReference(connection, openid, 'journal', String(journalId));
    });
    return { success: true, journalId };
  } catch (err) {
    if (err.isJournalDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

module.exports = {
  JOURNAL_EVENT_TYPES,
  DEFAULT_TITLES,
  JOURNAL_SELECT,
  normalizeJournalDate,
  parsePhotoFileIds,
  validateJournalInput,
  mapJournalRow,
  listJournalTimelineForUser,
  getJournalRecordForUser,
  createJournalRecordForUser,
  updateJournalRecordForUser,
  deleteJournalRecordForUser
};
