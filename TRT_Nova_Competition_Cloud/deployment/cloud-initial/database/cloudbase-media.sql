-- Incremental extension of the existing storage ledger; business data stays in MySQL.
-- The migration runner adds these columns only when absent.
ALTER TABLE cloud_media_objects ADD COLUMN provider VARCHAR(32) NOT NULL DEFAULT 'cloudbase';
ALTER TABLE cloud_media_objects ADD COLUMN upload_metadata JSON NULL;

-- Same transaction as the business deletion; images and documents share this ledger.
CREATE TRIGGER nova_cloudbase_media_delete AFTER DELETE ON media_objects FOR EACH ROW
  UPDATE cloud_media_objects SET state = 'delete_pending', cleanup_after = NOW()
  WHERE file_id = OLD.file_id AND openid = OLD.openid AND OLD.provider = 'cloudbase';
