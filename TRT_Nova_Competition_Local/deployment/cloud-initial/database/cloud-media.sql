-- Apply after the complete reference migration chain. No local business data copied.
-- DOCX MIME has 71 characters; the old VARCHAR(64) silently broke document uploads.
ALTER TABLE media_objects MODIFY COLUMN mime_type VARCHAR(128) NOT NULL;

CREATE TABLE IF NOT EXISTS cloud_media_objects (
  file_id VARCHAR(191) NOT NULL PRIMARY KEY,
  openid VARCHAR(128) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  bucket VARCHAR(128) NOT NULL,
  region VARCHAR(64) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  state ENUM('pending', 'ready', 'delete_pending') NOT NULL,
  cleanup_after DATETIME NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cloud_media_cleanup (state, cleanup_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transactional storage outbox, covers ALL existing owner-scoped deletion paths.
-- No FK cascade is used on media_objects. A business ROLLBACK rolls this back too.
CREATE TRIGGER nova_cloud_media_delete AFTER DELETE ON media_objects FOR EACH ROW
  UPDATE cloud_media_objects SET state = 'delete_pending', cleanup_after = NOW()
  WHERE file_id = OLD.file_id AND openid = OLD.openid AND OLD.provider = 'cos';
