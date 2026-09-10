-- Additive migration. Existing conversations, attachments and legacy memories are retained.
CREATE TABLE IF NOT EXISTS ai_session_context (
  conversation_id BIGINT UNSIGNED NOT NULL,
  openid VARCHAR(128) NOT NULL,
  summary TEXT NOT NULL,
  through_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id), KEY idx_session_context_owner (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_context_memory (
  openid VARCHAR(128) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 0,
  policy_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  facts_json JSON NOT NULL,
  summary_text TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
