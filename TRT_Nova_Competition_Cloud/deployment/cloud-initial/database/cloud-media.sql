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
