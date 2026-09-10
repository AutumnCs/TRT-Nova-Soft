-- plant_library 增强字段初版（2026-05-17）
-- 目标：先支持更厚的植物资料和 Agent 轻量知识增强

ALTER TABLE plant_library
  ADD COLUMN aliases_json JSON DEFAULT NULL AFTER name,
  ADD COLUMN difficulty VARCHAR(32) DEFAULT NULL AFTER category,
  ADD COLUMN care_temperature VARCHAR(256) DEFAULT NULL AFTER care_water,
  ADD COLUMN care_humidity VARCHAR(256) DEFAULT NULL AFTER care_temperature,
  ADD COLUMN care_soil VARCHAR(256) DEFAULT NULL AFTER care_humidity,
  ADD COLUMN care_fertilizer VARCHAR(256) DEFAULT NULL AFTER care_soil,
  ADD COLUMN care_ventilation VARCHAR(256) DEFAULT NULL AFTER care_fertilizer,
  ADD COLUMN seasonal_tips_json JSON DEFAULT NULL AFTER care_ventilation,
  ADD COLUMN common_issues_json JSON DEFAULT NULL AFTER seasonal_tips_json,
  ADD COLUMN faq_json JSON DEFAULT NULL AFTER common_issues_json,
  ADD COLUMN recommend_questions_json JSON DEFAULT NULL AFTER faq_json,
  ADD COLUMN device_interpretation_json JSON DEFAULT NULL AFTER recommend_questions_json,
  ADD COLUMN agent_notes TEXT DEFAULT NULL AFTER device_interpretation_json;

-- 首批高频植物增强样例
UPDATE plant_library
SET
  aliases_json = JSON_ARRAY('蓬莱蕉', '裂叶喜林芋'),
  difficulty = 'easy',
  care_temperature = '18~30℃，低于12℃要注意保温',
  care_humidity = '偏好中高湿，空气过干时叶缘可能发焦',
  care_soil = '疏松透气、富含有机质的基质',
  care_fertilizer = '春夏每月薄肥一次，冬季减少施肥',
  care_ventilation = '喜欢通风但避免冷风直吹',
  common_issues_json = JSON_ARRAY(
    JSON_OBJECT(
      'issue', '黄叶',
      'possibleCauses', JSON_ARRAY('浇水过多', '强光暴晒', '换盆应激'),
      'actions', JSON_ARRAY('先检查盆土是否长期潮湿', '移到散射光更稳定的位置', '观察新叶是否恢复正常')
    ),
    JSON_OBJECT(
      'issue', '叶片无开裂',
      'possibleCauses', JSON_ARRAY('植株偏幼', '长期缺光', '养分不足'),
      'actions', JSON_ARRAY('补充稳定散射光', '在生长期适度补肥', '不要期待短期内马上开背')
    )
  ),
  faq_json = JSON_ARRAY(
    JSON_OBJECT('question', '龟背竹多久浇一次？', 'answer', '不建议按固定天数浇水，更适合观察盆土状态，表层微干再浇更稳。'),
    JSON_OBJECT('question', '龟背竹怕晒吗？', 'answer', '怕夏季强烈直射光，长时间暴晒容易灼伤叶片，但也不能长期放在太暗的位置。')
  ),
  recommend_questions_json = JSON_ARRAY('龟背竹适合什么光照？', '我的龟背竹现在要不要浇水？'),
  device_interpretation_json = JSON_OBJECT(
    'soil_percent', JSON_OBJECT('dry', 20, 'ok', JSON_ARRAY(20, 45), 'wet', 70),
    'light_val', JSON_OBJECT('low', 800, 'ok', JSON_ARRAY(800, 12000), 'high', 28000),
    'dht_temp', JSON_OBJECT('low', 15, 'ok', JSON_ARRAY(18, 30), 'high', 33)
  ),
  agent_notes = '适合把重点放在散射光、湿度和积水风险上。'
WHERE name = '龟背竹';

UPDATE plant_library
SET
  aliases_json = JSON_ARRAY('玉露', 'Haworthia cooperi'),
  difficulty = 'medium',
  care_temperature = '15~28℃较舒适，夏季闷热和冬季严寒都要注意',
  care_humidity = '不需要过高湿度，闷湿环境反而容易出问题',
  care_soil = '颗粒占比高、排水透气的多肉基质',
  care_fertilizer = '生长期少量薄肥即可，不宜频繁施肥',
  care_ventilation = '非常看重通风，长期闷养容易化水烂根',
  common_issues_json = JSON_ARRAY(
    JSON_OBJECT(
      'issue', '叶片发软',
      'possibleCauses', JSON_ARRAY('缺水', '烂根', '高温闷湿'),
      'actions', JSON_ARRAY('先看盆土是否长期潮湿', '确认是否有烂根异味', '加强通风并减少暴晒')
    ),
    JSON_OBJECT(
      'issue', '徒长',
      'possibleCauses', JSON_ARRAY('长期缺光'),
      'actions', JSON_ARRAY('逐步增加光照', '避免频繁浇水', '保持通风防止株形松散')
    )
  ),
  faq_json = JSON_ARRAY(
    JSON_OBJECT('question', '多肉是不是一定要少浇水？', 'answer', '核心不是少，而是干透再浇、避免长期潮湿，不同季节和通风条件差别很大。'),
    JSON_OBJECT('question', '玉露适合暴晒吗？', 'answer', '不适合长时间强光直晒，尤其是夏季中午，很容易出现晒伤或失水发皱。')
  ),
  recommend_questions_json = JSON_ARRAY('多肉现在要不要浇水？', '玉露适合什么光照？'),
  device_interpretation_json = JSON_OBJECT(
    'soil_percent', JSON_OBJECT('dry', 15, 'ok', JSON_ARRAY(15, 28), 'wet', 45),
    'light_val', JSON_OBJECT('low', 1200, 'ok', JSON_ARRAY(1200, 15000), 'high', 32000),
    'dht_temp', JSON_OBJECT('low', 10, 'ok', JSON_ARRAY(15, 28), 'high', 32)
  ),
  agent_notes = '回答多肉问题时应强调排水、通风和宁干勿涝。'
WHERE name = '多肉・玉露';
