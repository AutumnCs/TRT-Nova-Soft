CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) DEFAULT NULL,
  nick_name VARCHAR(128) DEFAULT NULL,
  avatar_url VARCHAR(512) DEFAULT NULL,
  gender TINYINT NOT NULL DEFAULT 0,
  birthday VARCHAR(32) DEFAULT NULL,
  region_json JSON DEFAULT NULL,
  experience_level VARCHAR(64) DEFAULT NULL,
  signature VARCHAR(255) DEFAULT NULL,
  phone VARCHAR(64) DEFAULT NULL,
  email VARCHAR(128) DEFAULT NULL,
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_openid (openid),
  KEY idx_users_unionid (unionid)
);

CREATE TABLE devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logical_key VARCHAR(191) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  external_device_id VARCHAR(128) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_devices_logical_key (logical_key),
  KEY idx_devices_product_device (product_id, device_name)
);

CREATE TABLE device_acl (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  logical_key VARCHAR(191) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'owner',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  alias VARCHAR(128) DEFAULT NULL,
  location VARCHAR(128) DEFAULT NULL,
  plant_type VARCHAR(64) DEFAULT NULL,
  bind_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unbind_time DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_acl_openid_status (openid, status),
  KEY idx_acl_logical_key_status (logical_key, status),
  KEY idx_acl_openid_logical_key (openid, logical_key)
);

CREATE TABLE device_latest (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logical_key VARCHAR(191) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  data_id VARCHAR(128) DEFAULT NULL,
  notify_type VARCHAR(64) DEFAULT NULL,
  message_type VARCHAR(64) DEFAULT NULL,
  params_json JSON NOT NULL,
  push_meta_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_latest_logical_key (logical_key)
);

CREATE TABLE device_history_raw (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logical_key VARCHAR(191) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  param_key VARCHAR(64) NOT NULL,
  value_num DECIMAL(16,4) DEFAULT NULL,
  value_text VARCHAR(255) DEFAULT NULL,
  sample_time_ms BIGINT NOT NULL,
  data_id VARCHAR(128) DEFAULT NULL,
  push_id VARCHAR(128) DEFAULT NULL,
  dedup_key VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_history_raw_dedup_key (dedup_key),
  KEY idx_history_raw_lookup (logical_key, param_key, sample_time_ms)
);

CREATE TABLE device_history_agg (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  logical_key VARCHAR(191) NOT NULL,
  param_key VARCHAR(64) NOT NULL,
  granularity VARCHAR(16) NOT NULL,
  bucket_start_ms BIGINT NOT NULL,
  min_value DECIMAL(16,4) DEFAULT NULL,
  max_value DECIMAL(16,4) DEFAULT NULL,
  avg_value DECIMAL(16,4) DEFAULT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_history_agg_bucket (logical_key, param_key, granularity, bucket_start_ms),
  KEY idx_history_agg_lookup (logical_key, granularity, param_key, bucket_start_ms)
);
