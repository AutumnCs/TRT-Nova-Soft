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

CREATE TABLE device_commands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  command_id VARCHAR(64) NOT NULL,
  logical_key VARCHAR(191) NOT NULL,
  product_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT '',
  openid VARCHAR(128) DEFAULT NULL,
  command_name VARCHAR(64) NOT NULL DEFAULT 'set_property',
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  sent_params_json JSON NOT NULL,
  latest_snapshot_json JSON DEFAULT NULL,
  error_message VARCHAR(255) DEFAULT NULL,
  provider_response_json JSON DEFAULT NULL,
  requested_at_ms BIGINT NOT NULL,
  sent_at_ms BIGINT DEFAULT NULL,
  acked_at_ms BIGINT DEFAULT NULL,
  done_at_ms BIGINT DEFAULT NULL,
  failed_at_ms BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_commands_command_id (command_id),
  KEY idx_device_commands_logical_status (logical_key, status, requested_at_ms),
  KEY idx_device_commands_openid_requested (openid, requested_at_ms)
);

CREATE TABLE device_message_ingest (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(32) NOT NULL,
  logical_key VARCHAR(191) NOT NULL,
  device_id VARCHAR(191) NOT NULL,
  message_id VARCHAR(128) NOT NULL,
  message_type VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) DEFAULT NULL,
  message_timestamp_ms BIGINT NOT NULL,
  payload_json JSON NOT NULL,
  raw_meta_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_message_ingest_device_msg (device_id, message_id),
  KEY idx_device_message_ingest_lookup (logical_key, message_timestamp_ms),
  KEY idx_device_message_ingest_type (message_type, event_type, message_timestamp_ms)
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

CREATE TABLE todos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  logical_key VARCHAR(191) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL,
  urgent TINYINT NOT NULL DEFAULT 0,
  icon VARCHAR(32) DEFAULT NULL,
  icon_color VARCHAR(64) DEFAULT NULL,
  icon_bg VARCHAR(64) DEFAULT NULL,
  description_text VARCHAR(255) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_todos_openid_logical_key (openid, logical_key),
  KEY idx_todos_openid_status (openid, status),
  KEY idx_todos_created_at (created_at)
);

-- ============================================================
-- 植物库相关表
-- ============================================================

CREATE TABLE plant_library (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  aliases_json JSON DEFAULT NULL,
  family VARCHAR(128) DEFAULT NULL,
  scientific_name VARCHAR(128) DEFAULT NULL,
  feature VARCHAR(64) DEFAULT NULL,
  feature_text VARCHAR(32) DEFAULT NULL,
  category VARCHAR(64) DEFAULT NULL,
  difficulty VARCHAR(32) DEFAULT NULL,
  image_url VARCHAR(512) DEFAULT NULL,
  tags_json JSON DEFAULT NULL,
  description TEXT DEFAULT NULL,
  care_light VARCHAR(256) DEFAULT NULL,
  care_water VARCHAR(256) DEFAULT NULL,
  care_temperature VARCHAR(256) DEFAULT NULL,
  care_humidity VARCHAR(256) DEFAULT NULL,
  care_soil VARCHAR(256) DEFAULT NULL,
  care_fertilizer VARCHAR(256) DEFAULT NULL,
  care_ventilation VARCHAR(256) DEFAULT NULL,
  seasonal_tips_json JSON DEFAULT NULL,
  common_issues_json JSON DEFAULT NULL,
  faq_json JSON DEFAULT NULL,
  recommend_questions_json JSON DEFAULT NULL,
  device_interpretation_json JSON DEFAULT NULL,
  agent_notes TEXT DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plant_library_active (is_active, sort_order)
);

CREATE TABLE user_plant_favorites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid VARCHAR(128) NOT NULL,
  plant_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fav_openid_plant (openid, plant_id),
  KEY idx_fav_openid (openid)
);

ALTER TABLE device_acl
  ADD COLUMN plant_library_id BIGINT UNSIGNED DEFAULT NULL AFTER plant_type,
  ADD KEY idx_acl_plant_library_id (plant_library_id);

-- ============================================================
-- 初始植物种子数据
-- ============================================================
INSERT INTO plant_library
  (
    name, aliases_json, family, scientific_name, feature, feature_text, category, difficulty,
    image_url, tags_json, description, care_light, care_water, care_temperature, care_humidity,
    care_soil, care_fertilizer, care_ventilation, recommend_questions_json,
    device_interpretation_json, agent_notes, sort_order
  )
VALUES
  (
    '龟背竹',
    JSON_ARRAY('蓬莱蕉', '裂叶喜林芋'),
    '天南星科',
    'Monstera deliciosa',
    'partial-shade',
    '半阴',
    'foliage',
    'easy',
    'https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop',
    JSON_ARRAY('常绿植物', '净化空气', '新手友好'),
    '原生于热带雨林，叶片会逐步开裂，适合明亮散射光环境。',
    '明亮散射光，避免长时间暴晒',
    '表层微干后浇透，避免积水',
    '18~30℃，低于12℃要注意保温',
    '偏好中高湿，空气过干时叶缘可能发焦',
    '疏松透气、富含有机质的基质',
    '春夏每月薄肥一次，冬季减少施肥',
    '喜欢通风但避免冷风直吹',
    JSON_ARRAY('龟背竹适合什么光照？', '我的龟背竹现在要不要浇水？'),
    JSON_OBJECT(
      'soil_percent', JSON_OBJECT('dry', 20, 'ok', JSON_ARRAY(20, 45), 'wet', 70),
      'light_val', JSON_OBJECT('low', 800, 'ok', JSON_ARRAY(800, 12000), 'high', 28000),
      'dht_temp', JSON_OBJECT('low', 15, 'ok', JSON_ARRAY(18, 30), 'high', 33)
    ),
    '适合把重点放在散射光、湿度和积水风险上。',
    1
  ),
  (
    '多肉・玉露',
    JSON_ARRAY('玉露', 'Haworthia cooperi'),
    '独尾草科',
    'Haworthia cooperi',
    'avoid-sun',
    '忌暴晒',
    'succulent',
    'medium',
    'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop',
    JSON_ARRAY('多肉植物', '耐旱', '小型盆栽'),
    '叶片晶莹通透，适合通风良好、颗粒基质比例高的环境。',
    '明亮散射光，夏季避免中午直晒',
    '干透再浇，宁干勿涝',
    '15~28℃较舒适',
    '不需要过高湿度，闷湿环境反而容易出问题',
    '颗粒占比高、排水透气的多肉基质',
    '生长期少量薄肥即可',
    '非常看重通风，长期闷养容易化水烂根',
    JSON_ARRAY('多肉现在要不要浇水？', '玉露适合什么光照？'),
    JSON_OBJECT(
      'soil_percent', JSON_OBJECT('dry', 15, 'ok', JSON_ARRAY(15, 28), 'wet', 45),
      'light_val', JSON_OBJECT('low', 1200, 'ok', JSON_ARRAY(1200, 15000), 'high', 32000),
      'dht_temp', JSON_OBJECT('low', 10, 'ok', JSON_ARRAY(15, 28), 'high', 32)
    ),
    '回答多肉问题时应强调排水、通风和宁干勿涝。',
    2
  ),
  (
    '天堂鸟',
    JSON_ARRAY('鹤望兰', 'Strelitzia'),
    '旅人蕉科',
    'Strelitzia reginae',
    'sun-loving',
    '喜阳光',
    'foliage',
    'medium',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=600&auto=format&fit=crop',
    JSON_ARRAY('观花植物', '大型盆栽', '喜温暖'),
    '需要更充足光照，适合作为高光需求的观赏植物示例。',
    '充足阳光或很强的明亮光照',
    '生长期保持微湿，避免积水',
    '18~32℃较适宜',
    '中等湿度即可',
    '肥沃、疏松、排水良好的基质',
    '生长期定期薄肥',
    '保持通风，避免长期闷热',
    JSON_ARRAY('天堂鸟现在缺光吗？', '天堂鸟要不要增加通风？'),
    JSON_OBJECT(
      'soil_percent', JSON_OBJECT('dry', 22, 'ok', JSON_ARRAY(22, 48), 'wet', 70),
      'light_val', JSON_OBJECT('low', 1800, 'ok', JSON_ARRAY(1800, 25000), 'high', 45000),
      'dht_temp', JSON_OBJECT('low', 14, 'ok', JSON_ARRAY(18, 32), 'high', 36)
    ),
    '回答时可以更积极提醒光照不足问题。',
    3
  ),
  (
    '银斑葛',
    JSON_ARRAY('银斑藤芋', 'Scindapsus pictus'),
    '天南星科',
    'Scindapsus pictus',
    'shade-tolerant',
    '耐阴',
    'foliage',
    'easy',
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=600&auto=format&fit=crop',
    JSON_ARRAY('藤蔓植物', '净化空气', '耐阴'),
    '耐阴但不等于喜暗，适合作为低到中光照环境示例。',
    '低到中等光照都能适应，明亮散射光状态更好',
    '保持微湿，避免过干或过湿',
    '18~30℃较适宜',
    '偏好中高湿',
    '排水良好的通用观叶基质',
    '春夏少量补肥即可',
    '保持柔和通风',
    JSON_ARRAY('银斑葛适合什么湿度？', '我的银斑葛现在状态怎么样？'),
    JSON_OBJECT(
      'soil_percent', JSON_OBJECT('dry', 20, 'ok', JSON_ARRAY(20, 42), 'wet', 68),
      'light_val', JSON_OBJECT('low', 500, 'ok', JSON_ARRAY(500, 9000), 'high', 22000),
      'dht_temp', JSON_OBJECT('low', 14, 'ok', JSON_ARRAY(18, 30), 'high', 34)
    ),
    '要把耐阴和长期过暗区分开。',
    4
  );
