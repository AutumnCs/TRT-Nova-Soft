-- ============================================================
-- care_tasks v1 —— 植宠小程序 v0.1 的养护任务、打卡事件与徽章
-- 任务归属始终由 JWT openid 决定；日期按 Asia/Shanghai 解释。
-- ============================================================

-- 旧 todos 继承数据库排序规则，M1 plant_pets 曾继承 MySQL 8 的服务端默认规则；
-- M2 需要按 owner 联表，因此在增加任务字段前统一两张表的 utf8mb4 排序规则。
ALTER TABLE todos CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE plant_pets CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE todos
  ADD COLUMN plant_pet_id BIGINT UNSIGNED DEFAULT NULL AFTER logical_key,
  ADD COLUMN task_type VARCHAR(32) NOT NULL DEFAULT 'other' AFTER plant_pet_id,
  ADD COLUMN scheduled_for DATE DEFAULT NULL AFTER description_text,
  ADD COLUMN reminder_time TIME DEFAULT NULL AFTER scheduled_for,
  ADD COLUMN recurrence_type VARCHAR(16) NOT NULL DEFAULT 'none' AFTER reminder_time,
  ADD COLUMN recurrence_interval SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER recurrence_type,
  ADD COLUMN recurrence_parent_id BIGINT UNSIGNED DEFAULT NULL AFTER recurrence_interval,
  ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'manual' AFTER recurrence_parent_id,
  ADD COLUMN completed_at DATETIME DEFAULT NULL AFTER status,
  ADD KEY idx_todos_owner_schedule (openid, status, scheduled_for),
  ADD KEY idx_todos_owner_plant (openid, plant_pet_id, scheduled_for),
  ADD KEY idx_todos_recurrence_parent (recurrence_parent_id);

CREATE TABLE care_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  plant_pet_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  event_date DATE NOT NULL,
  event_type VARCHAR(32) NOT NULL DEFAULT 'task_completed',
  task_type VARCHAR(32) NOT NULL DEFAULT 'other',
  title VARCHAR(128) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_care_events_task (task_id),
  KEY idx_care_events_owner_date (openid, event_date),
  KEY idx_care_events_owner_plant (openid, plant_pet_id, event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_badges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  badge_key VARCHAR(64) NOT NULL,
  earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  context_json JSON DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_badges_owner_key (openid, badge_key),
  KEY idx_user_badges_owner_time (openid, earned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
