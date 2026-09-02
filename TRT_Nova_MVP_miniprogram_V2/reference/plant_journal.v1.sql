CREATE TABLE plant_journal (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  logical_key VARCHAR(191) NOT NULL,
  plant_library_id BIGINT UNSIGNED DEFAULT NULL,
  event_date DATE NOT NULL,
  event_type VARCHAR(32) NOT NULL DEFAULT 'note',
  title VARCHAR(128) NOT NULL,
  content_text TEXT DEFAULT NULL,
  photos_json JSON DEFAULT NULL,
  related_todo_id BIGINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_journal_openid_device_date (openid, logical_key, event_date),
  KEY idx_journal_device_date (logical_key, event_date),
  KEY idx_journal_todo (related_todo_id)
);
