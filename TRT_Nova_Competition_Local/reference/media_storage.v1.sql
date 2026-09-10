-- ============================================================
-- media_storage v1 —— M3 本地媒体、PlantPet 日记与永久 fileID
-- 本地 provider 将测试图片保存在 MySQL；CloudBase/COS 适配留到线上阶段。
-- ============================================================

ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE plant_pets CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE plant_journal CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN avatar_file_id VARCHAR(512) DEFAULT NULL AFTER avatar_url;

ALTER TABLE plant_pets
  ADD COLUMN cover_file_id VARCHAR(512) DEFAULT NULL AFTER cover_url;

ALTER TABLE plant_journal
  ADD COLUMN plant_pet_id BIGINT UNSIGNED DEFAULT NULL AFTER logical_key,
  ADD KEY idx_journal_owner_plant_date (openid, plant_pet_id, event_date, id);

CREATE TABLE media_objects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id VARCHAR(191) NOT NULL,
  openid VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'local',
  purpose VARCHAR(32) NOT NULL,
  plant_pet_id BIGINT UNSIGNED DEFAULT NULL,
  mime_type VARCHAR(64) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  content_blob MEDIUMBLOB DEFAULT NULL,
  reference_type VARCHAR(32) DEFAULT NULL,
  reference_key VARCHAR(191) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_file_id (file_id),
  KEY idx_media_owner_created (openid, created_at),
  KEY idx_media_owner_plant (openid, plant_pet_id, created_at),
  KEY idx_media_reference (openid, reference_type, reference_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
