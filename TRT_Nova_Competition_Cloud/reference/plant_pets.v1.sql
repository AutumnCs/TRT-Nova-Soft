-- ============================================================
-- plant_pets v1 —— 植宠小程序 v0.1 的独立植宠档案
-- owner 始终由 JWT openid 决定，不接受客户端声明。
-- M1 只建立档案，不在建档时自动生成任务或绑定硬件。
-- ============================================================

CREATE TABLE IF NOT EXISTS plant_pets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  plant_library_id BIGINT UNSIGNED DEFAULT NULL,
  nickname VARCHAR(64) NOT NULL,
  species_name VARCHAR(128) DEFAULT NULL,
  cover_url VARCHAR(1024) DEFAULT NULL,
  entered_at DATE DEFAULT NULL,
  location VARCHAR(128) DEFAULT NULL,
  care_notes VARCHAR(1000) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  archived_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plant_pets_owner_status (openid, status, created_at),
  KEY idx_plant_pets_library (plant_library_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
