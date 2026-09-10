'use strict';

const crypto = require('node:crypto');
const cloudbaseStorage = require('./cloudbase-storage');
const MAX_BYTES = 2 * 1024 * 1024;
const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json'
};
function createMediaStore({ env = process.env, cloudbase = cloudbaseStorage.createStorage({ env }) } = {}) {
  async function prepareUpload(db, openid, value) {
    const config = cloudbaseStorage.storageConfig(env);
    const extension = MIME_EXTENSIONS[value.mimeType];
    if (!extension) throw new Error('CLOUDBASE_MEDIA_TYPE_INVALID');
    try {
      const cloudPath = config.prefix + crypto.randomUUID() + '.' + extension;
      const prepared = await cloudbase.prepare(cloudPath);
      cloudbaseStorage.nativeFileInfo(prepared.fileId, config, cloudPath);
      const metadata = { purpose: value.purpose, plantPetId: value.plantPetId,
        mimeType: value.mimeType, byteSize: value.byteSize, originalName: value.originalName || '' };
      await db.execute(`INSERT INTO cloud_media_objects
        (file_id, openid, provider, object_key, bucket, region, sha256, upload_metadata, state, cleanup_after)
        VALUES (?, ?, 'cloudbase', ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [prepared.fileId, openid, cloudPath, prepared.bucket, config.region,
        crypto.createHash('sha256').update(value.buffer).digest('hex'), JSON.stringify(metadata)]);
      return { mode: 'cloudbase-client', fileId: prepared.fileId, cloudPath, envId: config.envId };
    } catch (_) {
      const error = new Error('云开发附件上传暂不可用，请稍后重试'); error.statusCode = 503; throw error;
    }
  }

  async function completeUpload(db, openid, fileId) {
    const [rows] = await db.execute(`SELECT *, cleanup_after > NOW() AS upload_active FROM cloud_media_objects
      WHERE file_id = ? AND openid = ? AND provider = 'cloudbase'`, [fileId, openid]);
    const row = rows[0];
    if (!row || !['pending', 'ready'].includes(row.state)) {
      const error = new Error('附件上传记录不存在或无权访问'); error.statusCode = 404; throw error;
    }
    const config = cloudbaseStorage.storageConfig(env);
    const info = cloudbaseStorage.nativeFileInfo(fileId, config, row.object_key);
    if (row.region !== config.region || row.bucket !== info.bucket) throw new Error('CLOUDBASE_MEDIA_ENVIRONMENT_MISMATCH');
    const metadata = typeof row.upload_metadata === 'string' ? JSON.parse(row.upload_metadata) : row.upload_metadata;
    const maxBytes = metadata?.purpose === 'conversation_document' ? 1024 * 1024 : MAX_BYTES;
    if (!metadata || !MIME_EXTENSIONS[metadata.mimeType] || !(metadata.byteSize > 0 && metadata.byteSize <= maxBytes)) {
      throw new Error('CLOUDBASE_UPLOAD_METADATA_INVALID');
    }
    if (row.state === 'pending') {
      if (!Number(row.upload_active)) { const error = new Error('附件上传已过期，请重新选择'); error.statusCode = 409; throw error; }
      let bytes;
      try { bytes = await cloudbase.read(fileId, row.object_key); }
      catch (_) { const error = new Error('附件尚未上传完成，请重试'); error.statusCode = 503; throw error; }
      if (bytes.length !== Number(metadata.byteSize) || crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        const error = new Error('上传附件与原文件不一致，请重新选择'); error.statusCode = 400; throw error;
      }
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [locked] = await connection.execute(`SELECT state, cleanup_after > NOW() AS upload_active
        FROM cloud_media_objects WHERE file_id = ? AND openid = ? AND provider = 'cloudbase' FOR UPDATE`, [fileId, openid]);
      if (!locked[0] || !['pending', 'ready'].includes(locked[0].state) ||
          (locked[0].state === 'pending' && !Number(locked[0].upload_active))) {
        const error = new Error('附件上传已取消或过期'); error.statusCode = 409; throw error;
      }
      if (metadata.plantPetId) {
        const [plants] = await connection.execute("SELECT id FROM plant_pets WHERE id = ? AND openid = ? AND status = 'active' FOR UPDATE",
          [metadata.plantPetId, openid]);
        if (!plants.length) { const error = new Error('植宠不存在、已归档或无权访问'); error.statusCode = 409; throw error; }
      }
      if (locked[0].state === 'pending') {
        await connection.execute(`INSERT INTO media_objects
          (file_id, openid, provider, purpose, plant_pet_id, mime_type, byte_size, original_name,
           content_blob, reference_type, reference_key) VALUES (?, ?, 'cloudbase', ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        [fileId, openid, metadata.purpose, metadata.plantPetId, metadata.mimeType, metadata.byteSize, metadata.originalName || null]);
        await connection.execute("UPDATE cloud_media_objects SET state = 'ready', cleanup_after = NULL WHERE file_id = ?", [fileId]);
      } else {
        const [live] = await connection.execute("SELECT file_id FROM media_objects WHERE file_id = ? AND openid = ? AND provider = 'cloudbase'", [fileId, openid]);
        if (!live.length) throw new Error('CLOUDBASE_READY_MEDIA_MISSING');
      }
      await connection.commit();
      return { fileId, provider: 'cloudbase', ...metadata };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async function cancelUpload(db, openid, fileId) {
    // A client upload can finish after cancellation. Keep the original 24h grace.
    await db.execute(`UPDATE cloud_media_objects SET state = 'delete_pending'
      WHERE file_id = ? AND openid = ? AND provider = 'cloudbase' AND state = 'pending'`, [fileId, openid]);
  }

  async function read(db, openid, fileId) {
    const [rows] = await db.execute(`SELECT c.object_key, c.bucket, c.region, c.sha256, m.byte_size, m.provider
      FROM cloud_media_objects c JOIN media_objects m ON m.file_id = c.file_id AND m.openid = c.openid
      WHERE c.file_id = ? AND c.openid = ? AND c.state = 'ready' AND m.provider = 'cloudbase' AND c.provider = 'cloudbase'`, [fileId, openid]);
    const row = rows[0];
    if (!row) { const error = new Error('附件不存在或无权访问'); error.statusCode = 404; throw error; }
    if (!(Number(row.byte_size) > 0 && Number(row.byte_size) <= MAX_BYTES)) throw new Error('CLOUD_MEDIA_METADATA_INVALID');
    let body;
    try {
      const config = cloudbaseStorage.storageConfig(env);
      const info = cloudbaseStorage.nativeFileInfo(fileId, config, row.object_key);
      if (row.bucket !== info.bucket || row.region !== config.region) throw new Error('CLOUDBASE_MEDIA_ENVIRONMENT_MISMATCH');
      body = await cloudbase.read(fileId, row.object_key);
    }
    catch (_) {
      // Provider errors may contain credentials; never forward them to API logs/UI.
      const error = new Error('云端附件暂时无法读取，请稍后重试'); error.statusCode = 503; throw error;
    }
    if (body.length !== Number(row.byte_size) || crypto.createHash('sha256').update(body).digest('hex') !== row.sha256) throw new Error('CLOUD_MEDIA_INTEGRITY_FAILED');
    return body;
  }
  async function cleanup(db, limit = 2) {
    // Two bounded provider operations fit the current 60-second cleanup function.
    const bounded = Math.max(1, Math.min(2, Number(limit) || 2));
    // Only unclaimed drafts expire. Saved messages/branches have no 20-turn/30-day TTL.
    await db.execute(`DELETE FROM media_objects WHERE provider = 'cloudbase' AND reference_type IS NULL
      AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT ${bounded}`);
    const [rows] = await db.execute(`SELECT file_id FROM cloud_media_objects WHERE
      provider = 'cloudbase' AND state IN ('pending', 'delete_pending') AND cleanup_after <= NOW()
      ORDER BY cleanup_after, file_id LIMIT ${bounded}`);
    let deleted = 0; let failed = 0;
    for (const item of rows) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [locked] = await connection.execute(`SELECT * FROM cloud_media_objects
          WHERE file_id = ? AND state IN ('pending', 'delete_pending') AND cleanup_after <= NOW() FOR UPDATE`, [item.file_id]);
        if (!locked.length) { await connection.rollback(); continue; }
        const row = locked[0];
        const [live] = await connection.execute('SELECT file_id FROM media_objects WHERE file_id = ?', [item.file_id]);
        if (live.length) throw new Error('CLOUD_MEDIA_STILL_REFERENCED');
        const config = cloudbaseStorage.storageConfig(env);
        const info = cloudbaseStorage.nativeFileInfo(item.file_id, config, row.object_key);
        if (row.provider !== 'cloudbase' || row.bucket !== info.bucket || row.region !== config.region) throw new Error('CLOUDBASE_MEDIA_ENVIRONMENT_MISMATCH');
        await cloudbase.remove(item.file_id, row.object_key);
        await connection.execute('DELETE FROM cloud_media_objects WHERE file_id = ?', [item.file_id]);
        await connection.commit(); deleted++;
      } catch (_) {
        await connection.rollback();
        // Back off failed objects so they cannot starve later entries in the queue.
        // Keep the ledger until remote deletion is confirmed.
        await connection.execute(`UPDATE cloud_media_objects
          SET cleanup_after = DATE_ADD(NOW(), INTERVAL LEAST(3600, 30 * POW(2, LEAST(attempts, 7))) SECOND),
              attempts = attempts + 1
          WHERE file_id = ? AND state IN ('pending', 'delete_pending')`, [item.file_id]);
        failed++;
      }
      finally { connection.release(); }
    }
    return { deleted, failed, bounded };
  }
  return { prepareUpload, completeUpload, cancelUpload, read, cleanup };
}
module.exports = { createMediaStore, storageConfig: cloudbaseStorage.storageConfig, ...createMediaStore() };
