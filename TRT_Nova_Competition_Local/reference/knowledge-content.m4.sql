-- M4 知识内容治理字段。
-- 现有 plant_library 仍可服务植宠建档，但只有 content_status=published 的内容进入知识页与 RAG。

ALTER TABLE knowledge_articles
  ADD COLUMN source_title VARCHAR(255) DEFAULT NULL AFTER source_ref,
  ADD COLUMN source_publisher VARCHAR(255) DEFAULT NULL AFTER source_title,
  ADD COLUMN source_updated_at VARCHAR(32) DEFAULT NULL AFTER source_publisher,
  ADD COLUMN source_url VARCHAR(1024) DEFAULT NULL AFTER source_updated_at,
  ADD COLUMN source_id VARCHAR(128) DEFAULT NULL AFTER source_url,
  ADD COLUMN content_updated_at DATE DEFAULT NULL AFTER source_id,
  ADD COLUMN reviewed_at DATETIME DEFAULT NULL AFTER content_updated_at,
  ADD COLUMN reviewed_by VARCHAR(128) DEFAULT NULL AFTER reviewed_at,
  ADD COLUMN image_license VARCHAR(255) DEFAULT NULL AFTER reviewed_by,
  ADD COLUMN image_source_url VARCHAR(1024) DEFAULT NULL AFTER image_license;

ALTER TABLE plant_library
  ADD COLUMN content_status VARCHAR(32) NOT NULL DEFAULT 'draft' AFTER is_active,
  ADD COLUMN source_title VARCHAR(255) DEFAULT NULL AFTER content_status,
  ADD COLUMN source_publisher VARCHAR(255) DEFAULT NULL AFTER source_title,
  ADD COLUMN source_updated_at VARCHAR(32) DEFAULT NULL AFTER source_publisher,
  ADD COLUMN source_url VARCHAR(1024) DEFAULT NULL AFTER source_updated_at,
  ADD COLUMN source_id VARCHAR(128) DEFAULT NULL AFTER source_url,
  ADD COLUMN content_updated_at DATE DEFAULT NULL AFTER source_id,
  ADD COLUMN reviewed_at DATETIME DEFAULT NULL AFTER content_updated_at,
  ADD COLUMN reviewed_by VARCHAR(128) DEFAULT NULL AFTER reviewed_at,
  ADD COLUMN image_license VARCHAR(255) DEFAULT NULL AFTER reviewed_by,
  ADD COLUMN image_source_url VARCHAR(1024) DEFAULT NULL AFTER image_license,
  ADD KEY idx_plant_library_content_status (content_status, is_active, sort_order);
