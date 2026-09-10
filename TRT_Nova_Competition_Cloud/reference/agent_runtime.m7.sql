-- ============================================================
-- agent_runtime M7 —— 会话事件、受控提案、幂等写入与消息媒体引用
--
-- 安全边界：
-- 1. owner 始终由已验证 JWT openid 决定，客户端与模型都不能指定 owner；
-- 2. Agent 只能创建 pending proposal，不能直接写正式业务对象；
-- 3. api-scf 在确认时重新校验 owner、状态、过期时间、植宠归属与业务字段；
-- 4. client_turn_key / idempotency_key 只用于重试收敛，不作为授权凭据。
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_conversation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  event_key VARCHAR(128) DEFAULT NULL,
  actor VARCHAR(16) NOT NULL DEFAULT 'system',
  target_message_id BIGINT UNSIGNED DEFAULT NULL,
  payload_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_conversation_events_owner_key (openid, event_key),
  KEY idx_ai_conversation_events_conversation (openid, conversation_id, id),
  KEY idx_ai_conversation_events_target (openid, target_message_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_action_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_key VARCHAR(128) NOT NULL,
  openid VARCHAR(128) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  source_user_message_id BIGINT UNSIGNED DEFAULT NULL,
  source_assistant_message_id BIGINT UNSIGNED DEFAULT NULL,
  plant_pet_id BIGINT UNSIGNED DEFAULT NULL,
  proposal_type VARCHAR(32) NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  consumed_target_type VARCHAR(32) DEFAULT NULL,
  consumed_target_id BIGINT UNSIGNED DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  dismissed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_action_proposals_owner_key (openid, proposal_key),
  UNIQUE KEY uk_ai_action_proposals_source_type (openid, source_user_message_id, proposal_type),
  KEY idx_ai_action_proposals_owner_status (openid, status, expires_at),
  KEY idx_ai_action_proposals_conversation (openid, conversation_id, created_at),
  KEY idx_ai_action_proposals_plant (openid, plant_pet_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS care_task_creation_keys (
  openid VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (openid, idempotency_key),
  UNIQUE KEY uk_care_task_creation_keys_task (task_id),
  KEY idx_care_task_creation_keys_owner_time (openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_message_media_links (
  message_id BIGINT UNSIGNED NOT NULL,
  openid VARCHAR(128) NOT NULL,
  file_id VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, file_id),
  KEY idx_ai_message_media_links_owner_file (openid, file_id),
  KEY idx_ai_message_media_links_owner_message (openid, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
