'use strict';

const crypto = require('node:crypto');
const { roleCredentials } = require('./cloud-secrets');
const MAX_BYTES = 2 * 1024 * 1024;
function storageConfig(env = process.env) {
  if (env.MEDIA_STORAGE_PROVIDER !== 'cos' || !/^[a-z0-9-]+-\d+$/.test(env.COS_BUCKET || '') ||
      !/^[a-z]+-[a-z0-9-]+$/.test(env.COS_REGION || '') ||
      !/^nova-staging\/[a-z0-9_-]+\/$/.test(env.COS_PREFIX || '')) throw new Error('CLOUD_COS_CONFIGURATION_INVALID');
  return { Bucket: env.COS_BUCKET, Region: env.COS_REGION, prefix: env.COS_PREFIX };
}
function productionClient() {
  const COS = require('cos-nodejs-sdk-v5');
  const { secretId, secretKey, token } = roleCredentials();
  // A fresh SDK per operation picks up refreshed SCF temporary credentials.
  // SDK 3.0.0 uses up to four attempts internally; MaxRetryTimes is NOT an option.
  // Keep each attempt short. This is a network timeout, not a whole-turn SLA.
  return new COS({ SecretId: secretId, SecretKey: secretKey, SecurityToken: token,
    Protocol: 'https:', Timeout: 2500, FollowRedirect: false });
}
function createMediaStore({ clientFactory = productionClient, env = process.env } = {}) {
  async function call(method, key, extra = {}) {
    const config = storageConfig(env);
    if (!key.startsWith(config.prefix) || key.includes('..')) throw new Error('CLOUD_OBJECT_KEY_INVALID');
    return new Promise((resolve, reject) => clientFactory()[method]({ Bucket: config.Bucket,
      Region: config.Region, Key: key, ...extra }, (error, result) => error ? reject(error) : resolve(result)));
  }
  async function upload(db, openid, value) {
    const config = storageConfig(env);
    const fileId = `cos://${crypto.randomUUID()}`;
    const objectKey = config.prefix + crypto.randomUUID();
    const sha256 = crypto.createHash('sha256').update(value.buffer).digest('hex');
    // Durable intent before the remote write: a process crash can still be cleaned.
    await db.execute(`INSERT INTO cloud_media_objects
      (file_id, openid, object_key, bucket, region, sha256, state, cleanup_after)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 1 DAY))`,
    [fileId, openid, objectKey, config.Bucket, config.Region, sha256]);
    try {
      await call('putObject', objectKey, { Body: value.buffer, ContentType: value.mimeType,
        ContentLength: value.byteSize, ACL: 'private' });
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [locked] = await connection.execute('SELECT state FROM cloud_media_objects WHERE file_id = ? FOR UPDATE', [fileId]);
        if (locked[0]?.state !== 'pending') throw new Error('CLOUD_UPLOAD_EXPIRED');
        await connection.execute(`INSERT INTO media_objects
          (file_id, openid, provider, purpose, plant_pet_id, mime_type, byte_size, original_name,
           content_blob, reference_type, reference_key) VALUES (?, ?, 'cos', ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        [fileId, openid, value.purpose, value.plantPetId, value.mimeType, value.byteSize, value.originalName || null]);
        await connection.execute("UPDATE cloud_media_objects SET state = 'ready', cleanup_after = NULL WHERE file_id = ?", [fileId]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
      return { fileId, provider: 'cos', purpose: value.purpose, plantPetId: value.plantPetId,
        mimeType: value.mimeType, byteSize: value.byteSize, originalName: value.originalName };
    } catch (_) {
      // Do not delete remotely here: COMMIT may have succeeded despite a lost reply.
      // The ledger distinguishes committed media from abandoned writes on retry/GC.
      // A timed-out PUT can finish remotely after the caller loses its reply.
      // Keep the original 24h grace period; immediate DELETE could precede that PUT.
      await db.execute("UPDATE cloud_media_objects SET state = 'delete_pending' WHERE file_id = ? AND state = 'pending'", [fileId]).catch(() => {});
      const error = new Error('云端附件保存未完成，请重试'); error.statusCode = 503; throw error;
    }
  }
  async function read(db, openid, fileId) {
    const [rows] = await db.execute(`SELECT c.object_key, c.bucket, c.region, c.sha256, m.byte_size
      FROM cloud_media_objects c JOIN media_objects m ON m.file_id = c.file_id AND m.openid = c.openid
      WHERE c.file_id = ? AND c.openid = ? AND c.state = 'ready' AND m.provider = 'cos'`, [fileId, openid]);
    const row = rows[0];
    if (!row) { const error = new Error('附件不存在或无权访问'); error.statusCode = 404; throw error; }
    const config = storageConfig(env);
    if (row.bucket !== config.Bucket || row.region !== config.Region || Number(row.byte_size) > MAX_BYTES) throw new Error('CLOUD_MEDIA_METADATA_INVALID');
    let result;
    try { result = await call('getObject', row.object_key, { DataType: 'buffer', Range: `bytes=0-${MAX_BYTES}` }); }
    catch (_) {
      // SDK errors may contain signed request details; never forward them to API logs/UI.
      const error = new Error('云端附件暂时无法读取，请稍后重试'); error.statusCode = 503; throw error;
    }
    const body = Buffer.from(result.Body);
    if (body.length !== Number(row.byte_size) || crypto.createHash('sha256').update(body).digest('hex') !== row.sha256) throw new Error('CLOUD_MEDIA_INTEGRITY_FAILED');
    return body;
  }
  async function cleanup(db, limit = 2) {
    // Two bounded COS operations fit the current 60-second cleanup function.
    const bounded = Math.max(1, Math.min(2, Number(limit) || 2));
    // Only unclaimed drafts expire. Saved messages/branches have no 20-turn/30-day TTL.
    await db.execute(`DELETE FROM media_objects WHERE provider = 'cos' AND reference_type IS NULL
      AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY) LIMIT ${bounded}`);
    const [rows] = await db.execute(`SELECT file_id FROM cloud_media_objects WHERE
      state IN ('pending', 'delete_pending') AND cleanup_after <= NOW()
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
        const config = storageConfig(env);
        if (row.bucket !== config.Bucket || row.region !== config.Region) throw new Error('CLOUD_MEDIA_BUCKET_MISMATCH');
        try { await call('deleteObject', row.object_key); }
        catch (error) { if (Number(error.statusCode) !== 404 && error.code !== 'NoSuchKey') throw error; }
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
  return { upload, read, cleanup };
}
module.exports = { createMediaStore, storageConfig, ...createMediaStore() };
