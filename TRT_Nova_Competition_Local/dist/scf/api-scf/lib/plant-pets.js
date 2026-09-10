const { withTransaction } = require('./care-tasks');
const {
  normalizePersistentFileId,
  claimLocalMediaFiles,
  deleteLocalMediaFiles,
  deleteLocalMediaReference
} = require('./media-storage');

const PET_SELECT = `
  SELECT pp.id, pp.openid, pp.plant_library_id, pp.nickname, pp.species_name,
         pp.cover_url, pp.cover_file_id, DATE_FORMAT(pp.entered_at, '%Y-%m-%d') AS entered_at,
         pp.location, pp.care_notes, pp.status, pp.archived_at,
         pp.created_at, pp.updated_at,
         pl.name AS library_plant_name, pl.image_url AS library_image_url
  FROM plant_pets pp
  LEFT JOIN plant_library pl ON pl.id = pp.plant_library_id
`;

function hasOwn(input, key) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function normalizeText(input, maxLength) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, maxLength);
}

function normalizePlantLibraryId(input) {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: null };
  }
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, value: null, msg: '植物品种无效' };
  }
  return { ok: true, value };
}

function normalizeDateInput(input) {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: null };
  }
  const value = typeof input === 'string' ? input.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, value: null, msg: '入室日期格式无效' };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { ok: false, value: null, msg: '入室日期无效' };
  }
  return { ok: true, value };
}

function createDomainError(message) {
  const error = new Error(message);
  error.isDomainError = true;
  return error;
}

function validateCreateInput(input = {}) {
  const nickname = normalizeText(input.nickname, 64);
  if (!nickname) {
    return { ok: false, msg: '请填写植宠昵称' };
  }

  const plantLibraryId = normalizePlantLibraryId(input.plantLibraryId);
  if (!plantLibraryId.ok) return plantLibraryId;
  const enteredAt = normalizeDateInput(input.enteredAt);
  if (!enteredAt.ok) return enteredAt;
  const coverFileIdInput = normalizeText(input.coverFileId, 1024);
  const coverFileId = normalizePersistentFileId(coverFileIdInput);
  if (coverFileIdInput && !coverFileId) {
    return { ok: false, msg: '植宠封面标识无效' };
  }

  return {
    ok: true,
    value: {
      nickname,
      plantLibraryId: plantLibraryId.value,
      speciesName: normalizeText(input.speciesName, 128),
      coverUrl: normalizeText(input.coverUrl, 1024),
      coverFileId,
      enteredAt: enteredAt.value,
      location: normalizeText(input.location, 128),
      careNotes: normalizeText(input.careNotes, 1000)
    }
  };
}

function mapPlantPetRow(row = {}) {
  const libraryId = row.plant_library_id ? Number(row.plant_library_id) : null;
  const customSpeciesName = row.species_name || '';
  const librarySpeciesName = row.library_plant_name || '';
  return {
    id: Number(row.id) || 0,
    ownerOpenid: row.openid || '',
    plantLibraryId: libraryId,
    nickname: row.nickname || '',
    speciesName: customSpeciesName || librarySpeciesName || '未知品种',
    isUnknownSpecies: !libraryId && !customSpeciesName,
    coverUrl: row.cover_url || row.library_image_url || '',
    customCoverUrl: row.cover_url || '',
    coverFileId: row.cover_file_id || '',
    enteredAt: row.entered_at || '',
    location: row.location || '',
    careNotes: row.care_notes || '',
    status: row.status || 'active',
    archivedAt: row.archived_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function assertPlantLibraryExists(db, plantLibraryId) {
  if (!plantLibraryId) return true;
  const [rows] = await db.execute(
    'SELECT id FROM plant_library WHERE id = ? AND is_active = 1 LIMIT 1',
    [plantLibraryId]
  );
  return rows.length > 0;
}

async function listPlantPetsForUser(db, openid, input = {}) {
  const includeArchived = input.includeArchived === true;
  const [rows] = await db.execute(
    `${PET_SELECT}
     WHERE pp.openid = ? ${includeArchived ? '' : "AND pp.status = 'active'"}
     ORDER BY CASE WHEN pp.status = 'active' THEN 0 ELSE 1 END, pp.created_at DESC, pp.id DESC`,
    [openid]
  );
  return {
    success: true,
    pets: rows.map(mapPlantPetRow)
  };
}

async function getPlantPetForUser(db, openid, input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { success: false, msg: '植宠档案标识无效' };
  }
  const [rows] = await db.execute(
    `${PET_SELECT} WHERE pp.id = ? AND pp.openid = ? LIMIT 1`,
    [plantPetId, openid]
  );
  if (!rows.length) {
    return { success: false, msg: '植宠档案不存在或无权访问' };
  }
  return {
    success: true,
    pet: mapPlantPetRow(rows[0])
  };
}

async function createPlantPetForUser(db, openid, input = {}) {
  const validated = validateCreateInput(input);
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  if (!(await assertPlantLibraryExists(db, value.plantLibraryId))) {
    return { success: false, msg: '所选植物品种不存在' };
  }

  try {
    const plantPetId = await withTransaction(db, async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO plant_pets
          (openid, plant_library_id, nickname, species_name, cover_url, cover_file_id, entered_at,
           location, care_notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          openid,
          value.plantLibraryId,
          value.nickname,
          value.speciesName || null,
          value.coverUrl || null,
          value.coverFileId || null,
          value.enteredAt,
          value.location || null,
          value.careNotes || null
        ]
      );
      const createdPlantPetId = Number(result.insertId) || 0;
      const claimed = await claimLocalMediaFiles(connection, openid, [value.coverFileId], {
        purpose: 'plant_cover',
        plantPetId: createdPlantPetId,
        referenceType: 'plant_cover',
        referenceKey: String(createdPlantPetId)
      });
      if (!claimed.success) throw createDomainError(claimed.msg);
      return createdPlantPetId;
    });
    return getPlantPetForUser(db, openid, { plantPetId });
  } catch (err) {
    if (err?.isDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

async function updatePlantPetForUser(db, openid, input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { success: false, msg: '植宠档案标识无效' };
  }

  const fields = [];
  const params = [];
  if (hasOwn(input, 'nickname')) {
    const nickname = normalizeText(input.nickname, 64);
    if (!nickname) return { success: false, msg: '请填写植宠昵称' };
    fields.push('nickname = ?');
    params.push(nickname);
  }
  if (hasOwn(input, 'plantLibraryId')) {
    const library = normalizePlantLibraryId(input.plantLibraryId);
    if (!library.ok) return { success: false, msg: library.msg };
    if (!(await assertPlantLibraryExists(db, library.value))) {
      return { success: false, msg: '所选植物品种不存在' };
    }
    fields.push('plant_library_id = ?');
    params.push(library.value);
  }
  if (hasOwn(input, 'speciesName')) {
    fields.push('species_name = ?');
    params.push(normalizeText(input.speciesName, 128) || null);
  }
  if (hasOwn(input, 'coverUrl')) {
    fields.push('cover_url = ?');
    params.push(normalizeText(input.coverUrl, 1024) || null);
  }
  let nextCoverFileId;
  if (hasOwn(input, 'coverFileId')) {
    const coverFileIdInput = normalizeText(input.coverFileId, 1024);
    nextCoverFileId = normalizePersistentFileId(coverFileIdInput);
    if (coverFileIdInput && !nextCoverFileId) {
      return { success: false, msg: '植宠封面标识无效' };
    }
    fields.push('cover_file_id = ?');
    params.push(nextCoverFileId || null);
  }
  if (hasOwn(input, 'enteredAt')) {
    const enteredAt = normalizeDateInput(input.enteredAt);
    if (!enteredAt.ok) return { success: false, msg: enteredAt.msg };
    fields.push('entered_at = ?');
    params.push(enteredAt.value);
  }
  if (hasOwn(input, 'location')) {
    fields.push('location = ?');
    params.push(normalizeText(input.location, 128) || null);
  }
  if (hasOwn(input, 'careNotes')) {
    fields.push('care_notes = ?');
    params.push(normalizeText(input.careNotes, 1000) || null);
  }

  if (!fields.length) {
    return { success: false, msg: '没有可更新的档案字段' };
  }
  try {
    const updated = await withTransaction(db, async (connection) => {
      const [ownedRows] = await connection.execute(
        `SELECT cover_file_id FROM plant_pets
         WHERE id = ? AND openid = ? AND status = 'active'
         LIMIT 1 FOR UPDATE`,
        [plantPetId, openid]
      );
      if (!ownedRows.length) return false;
      const oldCoverFileId = ownedRows[0].cover_file_id || '';

      fields.push('updated_at = CURRENT_TIMESTAMP');
      const updateParams = [...params, plantPetId, openid];
      await connection.execute(
        `UPDATE plant_pets SET ${fields.join(', ')} WHERE id = ? AND openid = ? AND status = 'active'`,
        updateParams
      );

      if (nextCoverFileId !== undefined && nextCoverFileId !== oldCoverFileId) {
        const claimed = await claimLocalMediaFiles(connection, openid, [nextCoverFileId], {
          purpose: 'plant_cover',
          plantPetId,
          referenceType: 'plant_cover',
          referenceKey: String(plantPetId)
        });
        if (!claimed.success) throw createDomainError(claimed.msg);
        await deleteLocalMediaFiles(connection, openid, [oldCoverFileId], {
          referenceType: 'plant_cover',
          referenceKey: String(plantPetId)
        });
      }
      return true;
    });
    if (!updated) {
      return { success: false, msg: '植宠档案不存在、已归档或无权访问' };
    }
    return getPlantPetForUser(db, openid, { plantPetId });
  } catch (err) {
    if (err?.isDomainError) return { success: false, msg: err.message };
    throw err;
  }
}

async function archivePlantPetForUser(db, openid, input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { success: false, msg: '植宠档案标识无效' };
  }
  const [result] = await db.execute(
    `UPDATE plant_pets
     SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND openid = ? AND status = 'active'`,
    [plantPetId, openid]
  );
  if (!result.affectedRows) {
    return { success: false, msg: '植宠档案不存在、已归档或无权访问' };
  }
  return getPlantPetForUser(db, openid, { plantPetId });
}

async function deletePlantPetForUser(db, openid, input = {}) {
  const plantPetId = Number(input.plantPetId) || 0;
  if (!Number.isInteger(plantPetId) || plantPetId <= 0) {
    return { success: false, msg: '植宠档案标识无效' };
  }
  const deleted = await withTransaction(db, async (connection) => {
    const [ownedRows] = await connection.execute(
      'SELECT id FROM plant_pets WHERE id = ? AND openid = ? LIMIT 1 FOR UPDATE',
      [plantPetId, openid]
    );
    if (!ownedRows.length) return false;

    // These runtime tables deliberately have no cascading foreign keys. Retire
    // copies before deleting their source rows, in the same owner-scoped transaction.
    await connection.execute(
      `DELETE link FROM ai_message_media_links link
       INNER JOIN ai_messages m ON m.id = link.message_id AND m.openid = link.openid
       INNER JOIN ai_conversations c ON c.id = m.conversation_id AND c.openid = m.openid
       WHERE link.openid = ? AND c.plant_pet_id = ?`,
      [openid, plantPetId]
    );
    await connection.execute(
      `UPDATE ai_conversation_events ev
       INNER JOIN ai_conversations c ON c.id = ev.conversation_id AND c.openid = ev.openid
       SET ev.target_message_id = NULL,
           ev.payload_json = JSON_OBJECT('retired', TRUE, 'reason', 'plant_deleted')
       WHERE ev.openid = ? AND c.plant_pet_id = ?`,
      [openid, plantPetId]
    );
    await connection.execute(
      `UPDATE ai_action_proposals p
       LEFT JOIN ai_conversations c ON c.id = p.conversation_id AND c.openid = p.openid
       SET p.status = 'expired',
           p.source_user_message_id = NULL, p.source_assistant_message_id = NULL,
           p.consumed_target_type = NULL, p.consumed_target_id = NULL,
           p.payload_json = JSON_OBJECT('retired', TRUE, 'reason', 'plant_deleted'),
           p.updated_at = CURRENT_TIMESTAMP
       WHERE p.openid = ? AND (p.plant_pet_id = ? OR c.plant_pet_id = ?)`,
      [openid, plantPetId, plantPetId]
    );
    // Retain event_key, proposal_key and care_task_creation_keys as tombstones.
    // Confirmed proposals must also expire: confirmation checks their status
    // before its idempotent path can return a target that this deletion removes.
    await connection.execute(
      'DELETE FROM care_events WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      'DELETE FROM todos WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      'DELETE FROM plant_journal WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      `DELETE aim FROM ai_messages aim
       INNER JOIN ai_conversations aic ON aic.id = aim.conversation_id
       WHERE aic.plant_pet_id = ? AND aic.openid = ?`,
      [plantPetId, openid]
    );
    await connection.execute(
      `DELETE ctx FROM ai_session_context ctx INNER JOIN ai_conversations c ON c.id = ctx.conversation_id
       WHERE c.plant_pet_id = ? AND c.openid = ?`,
      [plantPetId, openid]
    );
    // Remove automatic summary copies with deleted message sources, preserving
    // user-edited facts and facts belonging to other living conversations.
    const [memoryRows] = await connection.execute('SELECT facts_json FROM ai_context_memory WHERE openid = ? FOR UPDATE', [openid]);
    if (Array.isArray(memoryRows) && memoryRows.length) {
      const raw = memoryRows[0].facts_json;
      const facts = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const ids = Array.isArray(facts) ? facts.map(f => Number(f.sourceMessageId)).filter(Boolean) : [];
      const [liveRows] = ids.length ? await connection.execute(
        `SELECT id FROM ai_messages WHERE openid = ? AND id IN (${ids.map(() => '?').join(',')})`, [openid, ...ids]
      ) : [[]];
      const live = new Set(liveRows.map(row => Number(row.id)));
      await connection.execute('UPDATE ai_context_memory SET facts_json = ?, summary_text = NULL, policy_version = policy_version + 1, revision = revision + 1 WHERE openid = ?',
        [JSON.stringify((facts || []).filter(f => !f.sourceMessageId || live.has(Number(f.sourceMessageId)))), openid]);
    }
    await connection.execute(
      'DELETE FROM ai_conversations WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      'DELETE FROM ai_memories WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      'DELETE FROM plant_diagnoses WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await deleteLocalMediaReference(connection, openid, 'plant_cover', String(plantPetId));
    await connection.execute(
      'DELETE FROM media_objects WHERE plant_pet_id = ? AND openid = ?',
      [plantPetId, openid]
    );
    await connection.execute(
      'DELETE FROM plant_pets WHERE id = ? AND openid = ?',
      [plantPetId, openid]
    );
    return true;
  });
  if (!deleted) return { success: false, msg: '植宠档案不存在或无权访问' };
  return { success: true, plantPetId };
}

module.exports = {
  PET_SELECT,
  normalizeText,
  normalizePlantLibraryId,
  normalizeDateInput,
  validateCreateInput,
  mapPlantPetRow,
  listPlantPetsForUser,
  getPlantPetForUser,
  createPlantPetForUser,
  updatePlantPetForUser,
  archivePlantPetForUser,
  deletePlantPetForUser
};
