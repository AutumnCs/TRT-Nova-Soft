-- ============================================================
-- weather m5 —— 用户城市偏好与和风天气真实缓存
-- 长期只保存 LocationID、城市和行政区；定位坐标只用于当次城市解析。
-- ============================================================

CREATE TABLE IF NOT EXISTS user_weather_preferences (
  openid VARCHAR(128) NOT NULL,
  location_id VARCHAR(64) NOT NULL,
  city_name VARCHAR(128) NOT NULL,
  adm1 VARCHAR(128) DEFAULT NULL,
  adm2 VARCHAR(128) DEFAULT NULL,
  location_source VARCHAR(16) NOT NULL DEFAULT 'manual',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (openid),
  KEY idx_weather_preferences_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS weather_cache (
  location_id VARCHAR(64) NOT NULL,
  city_name VARCHAR(128) NOT NULL,
  adm1 VARCHAR(128) DEFAULT NULL,
  adm2 VARCHAR(128) DEFAULT NULL,
  payload_json JSON NOT NULL,
  fetched_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (location_id),
  KEY idx_weather_cache_expiry (expires_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
