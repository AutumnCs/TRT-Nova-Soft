# 植物库增强方案

> **归档说明（2026-07-19）**：本文尚未按独立 PlantPet、版本化规则和内容治理体系重审，不再作为当前数据库变更清单；结构化字段建议可在 R4—R6 重新评估。

> 更新日期：2026-05-17

## 1. 目标

将当前 `plant_library` 从“可展示的植物卡片数据”升级为“同时服务前端展示、设备解释和 Agent 知识增强的植物知识底座”。

本方案关注两件事：

- 内容更完整：每种植物不只是简介，而是能支撑养护建议和设备解释
- 结构更可用：既适合小程序展示，也适合 `agent-scf` 检索与拼装上下文

## 2. 当前现状

当前 `plant_library` 已在 `api-scf` 中提供以下基础字段：

- `id`
- `name`
- `family`
- `scientific_name`
- `feature`
- `feature_text`
- `category`
- `image_url`
- `tags_json`
- `description`
- `care_light`
- `care_water`

当前这些字段足够用于：

- 植物列表卡片展示
- 简单植物详情
- Agent 轻量知识增强

但还不够支撑：

- 基于不同植物解释设备数据
- 结构化 FAQ
- 更稳定的养护建议
- 推荐与筛选

## 3. 设计原则

- 真实设备状态仍以 `device_latest` 为准
- 植物库负责“植物习性和养护知识”，不负责伪造设备事实
- 前端展示字段和 Agent 专用字段应尽量分层
- 优先支持结构化检索，而不是堆长文案
- 先轻量增强，优先用 JSON 字段过渡；只有在数据量和复杂度明显上升时再拆分更多表

## 4. 推荐分层

建议把植物库信息分成三层：

### 4.1 展示层

主要用于植物列表页、详情页和设备绑定选择器。

建议字段：

- `name`
- `aliases_json`
- `family`
- `scientific_name`
- `category`
- `image_url`
- `feature_text`
- `tags_json`
- `difficulty`
- `description`

### 4.2 养护层

主要用于生成建议、问答和详情页内容。

建议字段：

- `care_light`
- `care_water`
- `care_temperature`
- `care_humidity`
- `care_soil`
- `care_fertilizer`
- `care_ventilation`
- `seasonal_tips_json`
- `common_issues_json`

### 4.3 Agent 解释层

主要用于把植物知识和设备数据对接起来。

建议字段：

- `device_interpretation_json`
- `agent_notes`
- `faq_json`
- `recommend_questions_json`

## 5. 推荐字段增强

### 5.1 建议直接新增的结构化字段

这些字段优先级最高，适合先直接加到主表：

- `aliases_json`
  - 植物别名数组
- `difficulty`
  - 建议值：`easy` / `medium` / `hard`
- `care_temperature`
  - 温度偏好说明
- `care_humidity`
  - 湿度偏好说明
- `care_soil`
  - 基质和排水需求
- `care_fertilizer`
  - 施肥频率和注意事项
- `care_ventilation`
  - 通风偏好
- `agent_notes`
  - 给 Agent 的简短提示，不直接展示给用户

### 5.2 建议用 JSON 过渡的字段

这类字段结构性很强，但初期不一定要拆新表，先用 JSON 最划算：

- `seasonal_tips_json`
  - 春夏秋冬养护差异
- `common_issues_json`
  - 常见问题、原因、建议动作
- `faq_json`
  - 标准化问答
- `recommend_questions_json`
  - 适合给用户的追问问题
- `device_interpretation_json`
  - 针对传感器数据的植物化解释规则

## 6. 最关键的 Agent 字段

### 6.1 `device_interpretation_json`

这是最值得补的字段之一。它的作用不是替代规则层，而是让 Agent 在解释设备数据时更像“针对这类植物”的建议，而不是一刀切。

示例：

```json
{
  "soil_percent": {
    "dry": 20,
    "ok": [20, 40],
    "wet": 65,
    "meaning": {
      "dry": "对这类植物来说已经明显偏干，可以准备补水。",
      "wet": "对这类植物来说偏湿，需避免继续浇水。"
    }
  },
  "light_val": {
    "low": 800,
    "ok": [800, 12000],
    "high": 30000
  },
  "dht_temp": {
    "low": 12,
    "ok": [15, 28],
    "high": 33
  }
}
```

这样后面 `agent-scf` 就可以从：

- “土壤湿度 18%”

进化成：

- “对多肉来说，当前湿度已经接近理想下限，短期不必急着大量补水”

### 6.2 `common_issues_json`

示例：

```json
[
  {
    "issue": "黄叶",
    "possibleCauses": ["积水", "暴晒", "换盆应激"],
    "actions": ["暂停浇水", "移到散射光位置", "观察新叶是否正常"]
  },
  {
    "issue": "徒长",
    "possibleCauses": ["长期缺光"],
    "actions": ["增加光照", "减少频繁浇水"]
  }
]
```

这类结构既适合前端展示，也适合 Agent 拿来回答“为什么叶子黄了”。

### 6.3 `faq_json`

示例：

```json
[
  {
    "question": "这种植物多久浇一次水？",
    "answer": "比固定天数更重要的是观察土壤状态，通常建议干透或接近干透再浇。"
  },
  {
    "question": "它适合放在卧室吗？",
    "answer": "适合放在通风良好、光线明亮的位置，避免长期阴暗。"
  }
]
```

### 6.4 `recommend_questions_json`

示例：

```json
[
  "这种植物平时怎么浇水？",
  "它怕暴晒吗？",
  "如果叶子发软该怎么办？",
  "这种植物适合什么湿度环境？"
]
```

这类字段可以直接给小程序作为快捷追问，也能让 Agent 的 follow-up 更像“懂植物的人”。

## 7. 推荐表结构路线

### 7.1 方案 A：主表增强 + JSON 过渡

适合当前阶段，改动小、收益高。

主表 `plant_library` 新增：

- `aliases_json`
- `difficulty`
- `care_temperature`
- `care_humidity`
- `care_soil`
- `care_fertilizer`
- `care_ventilation`
- `seasonal_tips_json`
- `common_issues_json`
- `faq_json`
- `recommend_questions_json`
- `device_interpretation_json`
- `agent_notes`

适用场景：

- 数据量不大
- 品种数在几十到一两百以内
- 先服务小程序和 Agent

### 7.2 方案 B：后续拆分扩展表

当植物资料越来越多时，再考虑拆分：

- `plant_library`
  - 基本信息、展示字段
- `plant_library_care_rules`
  - 设备解释、阈值、风险
- `plant_library_faq`
  - FAQ 及排序
- `plant_library_issue_guide`
  - 常见异常与动作建议

适用场景：

- 资料规模变大
- 需要后台运营编辑
- 需要更细粒度查询和版本管理

## 8. 推荐接口返回增强

当前 `/plant/library` 返回可以逐步扩成：

```json
{
  "id": 12,
  "name": "绿萝",
  "aliases": ["黄金葛"],
  "family": "天南星科",
  "scientificName": "Epipremnum aureum",
  "category": "观叶",
  "difficulty": "easy",
  "image": "https://...",
  "tags": ["耐阴", "新手友好", "室内"],
  "description": "适合室内养护的常见观叶植物。",
  "care": {
    "light": "明亮散射光",
    "water": "土壤微干再浇",
    "temperature": "18~30℃",
    "humidity": "偏好中高湿",
    "soil": "疏松透气基质",
    "fertilizer": "生长期每月薄肥一次",
    "ventilation": "保持空气流通"
  },
  "commonIssues": [
    {
      "issue": "黄叶",
      "possibleCauses": ["积水", "暴晒"],
      "actions": ["暂停浇水", "移到散射光位置"]
    }
  ],
  "faq": [
    {
      "question": "绿萝多久浇一次？",
      "answer": "以土壤状态为准，微干再浇。"
    }
  ],
  "recommendQuestions": [
    "我的绿萝现在要不要浇水？",
    "它适合什么光照？"
  ],
  "deviceInterpretation": {
    "soil_percent": {
      "dry": 20,
      "ok": [20, 45],
      "wet": 70
    }
  }
}
```

## 9. 功能收益

### 9.1 对前端的收益

- 植物库详情页更像真正的植物档案
- 可以做更好的筛选、搜索和标签导航
- 可以给用户更自然的快捷问法

### 9.2 对 Agent 的收益

- 植物知识回答更稳定
- 可以把设备数据解释成“这类植物视角下的建议”
- FAQ 和常见异常可以显著减少胡说概率

### 9.3 对业务的收益

- 一份植物资料可同时服务：
  - 小程序展示
  - Agent 检索
  - Wiki
  - 设备绑定后的个性化解释

## 10. 推荐首批补齐植物

优先把高频植物做深，而不是先铺太多品种。

建议首批优先：

- 绿萝
- 龟背竹
- 虎皮兰
- 发财树
- 吊兰
- 白掌
- 常见多肉
- 文竹
- 红掌
- 长寿花

这批植物补齐后，Agent 的感知提升会比“多加几十个薄资料植物”更明显。

## 11. 实施顺序建议

1. 扩充 `plant_library` 字段
2. 优先补 10~20 个高频植物的完整资料
3. `/plant/library` 返回新字段，但前端可按需渐进消费
4. `agent-scf` 先消费：
   - `care_*`
   - `common_issues_json`
   - `faq_json`
   - `device_interpretation_json`
5. 稳定后再决定是否拆表和加后台运营编辑能力

## 12. 一句话建议

现阶段最值得做的不是“把植物库做大”，而是“把高频植物做厚、做结构化、做成能解释设备数据的知识底座”。
