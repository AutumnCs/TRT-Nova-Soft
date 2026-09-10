const crypto = require('crypto');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1 * 1024 * 1024;
const MEDIA_PURPOSES = new Set(['profile_avatar', 'plant_cover', 'journal_photo', 'diagnosis_image', 'conversation_image', 'conversation_document']);
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json'
});

const TEXT_DOCUMENT_MIME = Object.freeze({
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json'
});

function normalizeText(input, maxLength) {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.slice(0, maxLength);
}

function isLocalFileId(fileId) {
  return /^local:\/\/[a-f0-9-]{16,64}$/i.test(String(fileId || '').trim());
}

function normalizePersistentFileId(input) {
  const value = normalizeText(input, 1024);
  if (!value) return '';
  if (isManagedFileId(value)) return value;
  if (/^cloud:\/\/[a-z0-9._~!$&'()*+,;=:@\/-]+$/i.test(value)) return value;
  if (/^https:\/\//i.test(value)) return value;
  return '';
}

function normalizeFileIds(input, maxCount = 12) {
  if (!Array.isArray(input)) return [];
  const result = [];
  for (const item of input) {
    const fileId = normalizePersistentFileId(item);
    if (!fileId || result.includes(fileId)) continue;
    result.push(fileId);
    if (result.length > maxCount) return [];
  }
  return result;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function decodeBase64Image(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  const content = value.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!content || content.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) {
    return { ok: false, msg: '图片为空或超过 2 MB' };
  }
  if (!/^[a-z0-9+/]+={0,2}$/i.test(content) || content.length % 4 !== 0) {
    return { ok: false, msg: '图片内容格式无效' };
  }
  const buffer = Buffer.from(content, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, msg: '单张图片不能超过 2 MB' };
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    return { ok: false, msg: '仅支持 JPEG、PNG 或 WebP 图片' };
  }
  return { ok: true, buffer, mimeType };
}

function getFileExtension(input) {
  const name = normalizeText(input, 255).toLowerCase();
  const match = name.match(/\.([a-z0-9]{1,12})$/i);
  return match ? match[1] : '';
}

function decodeBase64Document(input, originalName = '') {
  const value = typeof input === 'string' ? input.trim() : '';
  const content = value.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!content || content.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 8) {
    return { ok: false, msg: '文档为空或超过 1 MB' };
  }
  if (!/^[a-z0-9+/]+={0,2}$/i.test(content) || content.length % 4 !== 0) {
    return { ok: false, msg: '文档内容格式无效' };
  }
  const buffer = Buffer.from(content, 'base64');
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, msg: '单个文档不能超过 1 MB' };
  }
  const extension = getFileExtension(originalName);
  let mimeType = '';
  if (extension === 'pdf' && buffer.toString('ascii', 0, 5) === '%PDF-') {
    mimeType = 'application/pdf';
  } else if (
    extension === 'docx' && buffer.length >= 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  ) {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (TEXT_DOCUMENT_MIME[extension] && !buffer.includes(0)) {
    mimeType = TEXT_DOCUMENT_MIME[extension];
  }
  if (!mimeType) {
    return { ok: false, msg: '仅支持 TXT、Markdown、CSV、JSON、PDF 或 DOCX 文档' };
  }
  return { ok: true, buffer, mimeType };
}

function validateImageUploadInput(input = {}) {
  const purpose = normalizeText(input.purpose, 32).toLowerCase();
  if (!MEDIA_PURPOSES.has(purpose)) {
    return { ok: false, msg: '图片用途无效' };
  }
  const decoded = decodeBase64Image(input.dataBase64);
  if (!decoded.ok) return decoded;

  const plantPetId = Number(input.plantPetId) || 0;
  if (['journal_photo', 'diagnosis_image'].includes(purpose) && (!Number.isInteger(plantPetId) || plantPetId <= 0)) {
    return { ok: false, msg: purpose === 'journal_photo' ? '日记图片必须关联植宠' : '诊断图片必须关联植宠' };
  }
  if (plantPetId && (!Number.isInteger(plantPetId) || plantPetId <= 0)) {
    return { ok: false, msg: '植宠标识无效' };
  }

  return {
    ok: true,
    value: {
      purpose,
      plantPetId: plantPetId || null,
      originalName: normalizeText(input.originalName, 255),
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      byteSize: decoded.buffer.length
    }
  };
}

function validateDocumentUploadInput(input = {}) {
  const purpose = normalizeText(input.purpose, 32).toLowerCase();
  if (purpose !== 'conversation_document') return { ok: false, msg: '文档用途无效' };
  const originalName = normalizeText(input.originalName, 255);
  if (!originalName) return { ok: false, msg: '文档名称不能为空' };
  const decoded = decodeBase64Document(input.dataBase64, originalName);
  if (!decoded.ok) return decoded;
  const plantPetId = Number(input.plantPetId) || 0;
  if (plantPetId && (!Number.isInteger(plantPetId) || plantPetId <= 0)) {
    return { ok: false, msg: '植宠标识无效' };
  }
  return {
    ok: true,
    value: {
      purpose,
      plantPetId: plantPetId || null,
      originalName,
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      byteSize: decoded.buffer.length
    }
  };
}

function validateMediaUploadInput(input = {}) {
  return String(input.purpose || '').trim().toLowerCase() === 'conversation_document'
    ? validateDocumentUploadInput(input)
    : validateImageUploadInput(input);
}

function isLocalMediaEnabled() {
  return String(process.env.LOCAL_MEDIA_ENABLED || '').trim().toLowerCase() === 'true';
}

function createLocalFileId() {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `local://${id}`;
}

async function assertPlantPetOwned(db, openid, plantPetId, requireActive = true) {
  if (!plantPetId) return true;
  const [rows] = await db.execute(
    `SELECT id FROM plant_pets
     WHERE id = ? AND openid = ? ${requireActive ? "AND status = 'active'" : ''}
     LIMIT 1`,
    [plantPetId, openid]
  );
  return rows.length > 0;
}

function mapMediaMetadata(row = {}) {
  return {
    fileId: row.file_id || row.fileId || '',
    provider: row.provider || 'local',
    purpose: row.purpose || '',
    plantPetId: Number(row.plant_pet_id || row.plantPetId) || null,
    mimeType: row.mime_type || row.mimeType || '',
    extension: MIME_EXTENSIONS[row.mime_type || row.mimeType] || '',
    byteSize: Number(row.byte_size || row.byteSize) || 0,
    originalName: row.original_name || row.originalName || '',
    referenceType: row.reference_type || row.referenceType || '',
    referenceKey: row.reference_key || row.referenceKey || '',
    createdAt: row.created_at || row.createdAt || null
  };
}

async function uploadLocalMediaForUser(db, openid, input = {}) {
  const cloud = process.env.MEDIA_STORAGE_PROVIDER === 'cloudbase';
  if (!isLocalMediaEnabled() && !cloud) {
    return { success: false, msg: '本地媒体存储未启用' };
  }
  const validated = validateMediaUploadInput(input);
  if (!validated.ok) return { success: false, msg: validated.msg };
  const value = validated.value;
  if (!(await assertPlantPetOwned(db, openid, value.plantPetId, true))) {
    return { success: false, msg: '植宠不存在、已归档或无权访问' };
  }

  if (cloud) {
    const upload = await require('../cloud-media').prepareUpload(db, openid, value);
    return { success: true, upload };
  }
  const fileId = createLocalFileId();
  await db.execute(
    `INSERT INTO media_objects
      (file_id, openid, provider, purpose, plant_pet_id, mime_type, byte_size,
       original_name, content_blob, reference_type, reference_key, created_at, updated_at)
     VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      fileId,
      openid,
      value.purpose,
      value.plantPetId,
      value.mimeType,
      value.byteSize,
      value.originalName || null,
      value.buffer
    ]
  );
  return {
    success: true,
    media: {
      fileId,
      provider: 'local',
      purpose: value.purpose,
      plantPetId: value.plantPetId,
      mimeType: value.mimeType,
      extension: MIME_EXTENSIONS[value.mimeType],
      byteSize: value.byteSize
    }
  };
}

async function resolveLocalMediaForUser(db, openid, input = {}) {
  const requested = normalizeFileIds(input.fileIds, 12).filter(isManagedFileId);
  if (process.env.MEDIA_STORAGE_PROVIDER === 'cloudbase' && requested.length > 1) {
    return { success: false, msg: '云端每次解析一个附件，避免超过云函数响应大小限制' };
  }
  if (!requested.length) return { success: true, media: [], missingFileIds: [] };
  const placeholders = requested.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT file_id, provider, purpose, plant_pet_id, mime_type, byte_size, original_name,
            reference_type, reference_key, created_at, content_blob
     FROM media_objects
     WHERE openid = ? AND file_id IN (${placeholders})`,
    [openid, ...requested]
  );
  const byFileId = new Map(rows.map((row) => [row.file_id, row]));
  const media = await Promise.all(requested.filter((fileId) => byFileId.has(fileId)).map(async (fileId) => {
    const row = byFileId.get(fileId);
    return {
      ...mapMediaMetadata(row),
      contentBase64: row.provider === 'cloudbase'
        ? (await require('../cloud-media').read(db, openid, row.file_id)).toString('base64')
        : (row.content_blob ? Buffer.from(row.content_blob).toString('base64') : '')
    };
  }));
  return {
    success: true,
    media,
    missingFileIds: requested.filter((fileId) => !byFileId.has(fileId))
  };
}

async function claimLocalMediaFiles(db, openid, fileIds, options = {}) {
  const supplied = Array.isArray(fileIds) ? fileIds.filter(Boolean) : [];
  const normalizedIds = normalizeFileIds(supplied, 12);
  if (process.env.MEDIA_STORAGE_PROVIDER === 'cloudbase' &&
      (normalizedIds.length !== new Set(supplied).size || normalizedIds.some(id => !isManagedFileId(id) || isLocalFileId(id)))) {
    return { success: false, msg: '请上传本人云端附件，不接受外部地址或本地标识' };
  }
  const localIds = normalizedIds.filter(isManagedFileId);
  if (!localIds.length) return { success: true };
  const placeholders = localIds.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT file_id, purpose, plant_pet_id, reference_type, reference_key
     FROM media_objects
     WHERE openid = ? AND file_id IN (${placeholders})
     FOR UPDATE`,
    [openid, ...localIds]
  );
  if (rows.length !== localIds.length) return { success: false, msg: '图片不存在或无权访问' };

  const expectedPurpose = normalizeText(options.purpose, 32);
  const plantPetId = Number(options.plantPetId) || null;
  const referenceType = normalizeText(options.referenceType, 32);
  const referenceKey = normalizeText(options.referenceKey, 191);
  const valid = rows.every((row) =>
    (!expectedPurpose || row.purpose === expectedPurpose) &&
    (!plantPetId || !row.plant_pet_id || Number(row.plant_pet_id) === plantPetId) &&
    (!row.reference_type || (row.reference_type === referenceType && row.reference_key === referenceKey))
  );
  if (!valid) return { success: false, msg: '图片用途、植宠或引用关系不匹配' };

  await db.execute(
    `UPDATE media_objects
     SET plant_pet_id = COALESCE(?, plant_pet_id), reference_type = ?, reference_key = ?, updated_at = CURRENT_TIMESTAMP
     WHERE openid = ? AND file_id IN (${placeholders})`,
    [plantPetId, referenceType || null, referenceKey || null, openid, ...localIds]
  );
  return { success: true };
}

async function deleteLocalMediaFiles(db, openid, fileIds, options = {}) {
  const localIds = normalizeFileIds(fileIds, 20).filter(isManagedFileId);
  if (!localIds.length) return { success: true, deleted: 0 };
  const clauses = ['openid = ?', `file_id IN (${localIds.map(() => '?').join(', ')})`];
  const params = [openid, ...localIds];
  if (options.onlyUnclaimed === true) clauses.push('reference_type IS NULL');
  if (options.referenceType) {
    clauses.push('reference_type = ?');
    params.push(normalizeText(options.referenceType, 32));
  }
  if (options.referenceKey !== undefined) {
    clauses.push('reference_key = ?');
    params.push(normalizeText(options.referenceKey, 191));
  }
  const [result] = await db.execute(`DELETE FROM media_objects WHERE ${clauses.join(' AND ')}`, params);
  return { success: true, deleted: Number(result.affectedRows) || 0 };
}

async function deleteLocalMediaReference(db, openid, referenceType, referenceKey) {
  const [result] = await db.execute(
    `DELETE FROM media_objects WHERE openid = ? AND reference_type = ? AND reference_key = ?`,
    [openid, normalizeText(referenceType, 32), normalizeText(referenceKey, 191)]
  );
  return Number(result.affectedRows) || 0;
}

async function discardLocalMediaForUser(db, openid, input = {}) {
  const fileId = normalizePersistentFileId(input.fileId);
  if (!isManagedFileId(fileId)) return { success: false, msg: '附件标识无效' };
  if (isCloudbaseFileId(fileId)) await require('../cloud-media').cancelUpload(db, openid, fileId);
  return deleteLocalMediaFiles(db, openid, [fileId], { onlyUnclaimed: true });
}

function isCloudbaseFileId(fileId) {
  return process.env.MEDIA_STORAGE_PROVIDER === 'cloudbase' &&
    /^cloud:\/\/[a-z0-9-]+\.[a-z0-9-]+\/.+/.test(String(fileId || '')) && String(fileId).length <= 191;
}

async function completeMediaUploadForUser(db, openid, input = {}) {
  if (!isCloudbaseFileId(input.fileId)) return { success: false, msg: '云开发附件标识无效或未启用' };
  const media = await require('../cloud-media').completeUpload(db, openid, input.fileId);
  return { success: true, media: { ...media, extension: MIME_EXTENSIONS[media.mimeType] } };
}

function isManagedFileId(fileId) {
  return isLocalFileId(fileId) || isCloudbaseFileId(fileId);
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_DOCUMENT_BYTES,
  MEDIA_PURPOSES,
  MIME_EXTENSIONS,
  isLocalFileId,
  normalizePersistentFileId,
  normalizeFileIds,
  detectImageMime,
  decodeBase64Image,
  decodeBase64Document,
  validateImageUploadInput,
  validateDocumentUploadInput,
  validateMediaUploadInput,
  isLocalMediaEnabled,
  mapMediaMetadata,
  uploadLocalMediaForUser,
  completeMediaUploadForUser,
  resolveLocalMediaForUser,
  claimLocalMediaFiles,
  deleteLocalMediaFiles,
  deleteLocalMediaReference,
  discardLocalMediaForUser
};
