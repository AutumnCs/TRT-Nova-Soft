-- ============================================================
-- ai_assistant M6 —— NOVA 会话、结构化记忆、图片观察与调用统计
-- owner 始终由 JWT openid 决定；Agent 不直接写任务等业务对象。
-- 原始消息最多保留最近 20 轮且不超过 30 天，清理由 agent-scf 执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  session_key VARCHAR(128) NOT NULL,
  plant_pet_id BIGINT UNSIGNED DEFAULT NULL,
  title VARCHAR(128) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_conversations_owner_session (openid, session_key),
  KEY idx_ai_conversations_owner_updated (openid, updated_at),
  KEY idx_ai_conversations_owner_plant (openid, plant_pet_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  openid VARCHAR(128) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  response_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_messages_conversation_time (conversation_id, created_at, id),
  KEY idx_ai_messages_owner_time (openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_memories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  plant_pet_id BIGINT UNSIGNED DEFAULT NULL,
  memory_type VARCHAR(32) NOT NULL,
  memory_key VARCHAR(128) NOT NULL,
  content VARCHAR(1000) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(128) DEFAULT NULL,
  source_time DATETIME DEFAULT NULL,
  user_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_memories_owner_key (openid, memory_key),
  KEY idx_ai_memories_owner_plant (openid, plant_pet_id, updated_at),
  KEY idx_ai_memories_owner_type (openid, memory_type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plant_diagnoses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  plant_pet_id BIGINT UNSIGNED NOT NULL,
  media_file_id VARCHAR(1024) DEFAULT NULL,
  is_plant TINYINT(1) NOT NULL DEFAULT 1,
  candidates_json JSON NOT NULL,
  visible_signs_json JSON NOT NULL,
  possible_causes_json JSON NOT NULL,
  advice_json JSON NOT NULL,
  reshoot_questions_json JSON NOT NULL,
  model_version VARCHAR(128) DEFAULT NULL,
  user_correction_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plant_diagnoses_owner_plant (openid, plant_pet_id, created_at),
  KEY idx_plant_diagnoses_owner_time (openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  openid VARCHAR(128) NOT NULL,
  usage_date DATE NOT NULL,
  chat_count INT UNSIGNED NOT NULL DEFAULT 0,
  vision_count INT UNSIGNED NOT NULL DEFAULT 0,
  prompt_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completion_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (openid, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
