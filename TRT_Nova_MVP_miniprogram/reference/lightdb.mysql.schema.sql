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
-- 植物库相关表 (2026-04)
-- ============================================================

-- 公共植物百科库（所有用户共享，管理员维护）
CREATE TABLE plant_library (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(128)    NOT NULL,
  family        VARCHAR(128)    DEFAULT NULL,
  scientific_name VARCHAR(128)  DEFAULT NULL,
  feature       VARCHAR(64)     DEFAULT NULL,   -- 'partial-shade' | 'avoid-sun' | 'sun-loving' | 'shade-tolerant'
  feature_text  VARCHAR(32)     DEFAULT NULL,   -- '半阴' | '忌暴晒' 等
  category      VARCHAR(64)     DEFAULT NULL,   -- 'foliage' | 'succulent' 等
  image_url     VARCHAR(512)    DEFAULT NULL,
  tags_json     JSON            DEFAULT NULL,   -- ["常绿植物","净化空气"]
  description   TEXT            DEFAULT NULL,
  care_light    VARCHAR(256)    DEFAULT NULL,
  care_water    VARCHAR(256)    DEFAULT NULL,
  sort_order    INT             NOT NULL DEFAULT 0,
  is_active     TINYINT         NOT NULL DEFAULT 1,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plant_library_active (is_active, sort_order)
);

-- 用户收藏（每人独立隔离）
CREATE TABLE user_plant_favorites (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid     VARCHAR(128)    NOT NULL,
  plant_id   BIGINT UNSIGNED NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fav_openid_plant (openid, plant_id),
  KEY idx_fav_openid (openid)
);

-- device_acl 关联植物库 id（plant_type 字段保留做历史兼容）
ALTER TABLE device_acl
  ADD COLUMN plant_library_id BIGINT UNSIGNED DEFAULT NULL AFTER plant_type,
  ADD KEY idx_acl_plant_library_id (plant_library_id);

-- ============================================================
-- 初始植物种子数据
-- ============================================================
INSERT INTO plant_library
  (name, family, scientific_name, feature, feature_text, category, image_url, tags_json, description, care_light, care_water, sort_order)
VALUES
  ('龟背竹',   '天南星科・龟背竹属', 'Monstera deliciosa',
   'partial-shade',  '半阴',   'foliage',
   'https://images.unsplash.com/photo-1509423355108-74d6920d986b?q=80&w=600&auto=format&fit=crop',
   '["常绿植物","净化空气","新手友好"]',
   '原生生于热带雨林，具有独特的孔洞叶片，极具观赏性。',
   '半阴或明亮散光', '干透浇透，避积水', 1),

  ('多肉・玉露', '独尾草科・瓦苇属', 'Haworthia cooperi',
   'avoid-sun',      '忌暴晒', 'succulent',
   'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?q=80&w=600&auto=format&fit=crop',
   '["多肉植物","耐旱","小型盆栽"]',
   '叶片晶莹剔透，形如露珠，是多肉植物中的珍品。',
   '散射光，忌强光直射', '干透浇透，冬季少水', 2),

  ('天堂鸟',   '旅人蕉科・鹤望兰属', 'Strelitzia reginae',
   'sun-loving',     '喜阳光', 'foliage',
   'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=600&auto=format&fit=crop',
   '["观花植物","大型盆栽","喜温暖"]',
   '花朵形如仙鹤，姿态优美，是室内外装饰的佳品。',
   '充足阳光，每天至少4小时', '保持土壤湿润，避免积水', 3),

  ('银斑葛',   '天南星科・麒麟叶属', 'Scindapsus pictus',
   'shade-tolerant', '耐阴',   'foliage',
   'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=600&auto=format&fit=crop',
   '["藤蔓植物","净化空气","耐阴"]',
   '叶片带有银色斑点，富有质感，适合悬挂栽培。',
   '低光到中等光照，忌强光', '保持土壤微湿，避免干燥', 4);
