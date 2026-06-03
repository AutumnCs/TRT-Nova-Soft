# 植物养护 Agent API 设计

> 更新日期：2026-05-17

## 当前口径

当前 `/agent/chat` 已经不是纯规则问答，而是：

- 设备类问题：规则层 + 设备事实
- 普通知识/植物问答：轻量知识检索 + LLM
- 未配置 LLM 时：本地知识或本地助手回退

当前仍然保持：

- 只读
- 不执行设备控制
- 不直接创建待办

## 1. 目标

为小程序提供一个统一的 Agent 入口，用于：

- 接收用户问题
- 读取设备状态与历史
- 检索植物知识
- 输出结构化建议
- 在安全边界内生成待办建议或控制建议
- 当前阶段不在 `/agent/chat` 中执行设备控制或写操作
- 当前阶段允许在只读边界内使用轻量知识增强

建议服务位置：

- `dist/scf/agent-scf`

建议基础路径：

- `POST /agent/chat`

后续可扩展：

- `POST /agent/action`
- `GET /agent/session`
- `POST /agent/feedback`

## 2. 设计原则

- Agent 不直接暴露数据库
- Agent 不直接接受任意设备控制参数
- Agent 输出结构化结果，方便小程序渲染
- Agent 必须以 `device_latest` 作为事实来源
- Agent 可以使用规则层和知识库，但不应伪造设备执行结果

## 3. 推荐接口

### 3.1 `POST /agent/chat`

用途：

- 统一处理问答、诊断、建议、计划生成

请求示例：

```json
{
  "sessionId": "sess_20260514_001",
  "message": "我的绿萝现在状态怎么样，要不要浇水？",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "context": {
    "page": "index",
    "plantLibraryId": 12,
    "plantType": "绿萝"
  },
  "options": {
    "includeHistory": true,
    "historyRange": "24h",
    "allowActions": false,
    "allowControlSuggestions": true
  }
}
```

字段说明：

- `sessionId`
  - 用于多轮对话上下文
- `message`
  - 用户自然语言输入
- `logicalKey`
  - 当前设备标识，可为空
- `context`
  - 页面和设备补充上下文
- `options`
  - 控制本轮是否允许调用历史数据、是否允许返回控制建议
  - 当前阶段建议固定 `allowActions: false`，只允许返回建议，不允许执行动作

响应示例：

```json
{
  "success": true,
  "sessionId": "sess_20260514_001",
  "intent": {
    "type": "diagnosis",
    "name": "watering_decision"
  },
  "summary": "当前土壤湿度偏低，建议今晚补水一次。",
  "riskLevel": "medium",
  "facts": [
    "土壤湿度 18%",
    "环境温度 29℃",
    "最近 24 小时土壤湿度持续下降"
  ],
  "diagnosis": "当前最主要的问题是缺水，且白天蒸发偏快。",
  "suggestions": [
    "今晚 20:00 前补水一次",
    "补水后 2 小时内复查土壤湿度",
    "短期内避免长时间强光直晒"
  ],
  "todoSuggestions": [
    {
      "title": "今晚补水",
      "urgency": "high"
    },
    {
      "title": "补水后复查湿度",
      "urgency": "medium"
    }
  ],
  "actions": [],
  "actionPolicy": {
    "allowActions": false,
    "allowControlSuggestions": true,
    "requiresUserConfirmation": true
  },
  "disclaimer": "建议基于设备数据和养护规则生成，仅供参考；执行设备操作前请以现场情况为准。",
  "followUpQuestions": [
    "要不要我帮你创建浇水提醒？",
    "要不要顺便看看最近 7 天的湿度变化？"
  ],
  "sources": [
    {
      "type": "device_latest",
      "logicalKey": "Aruv1l24Y6::Nova_demo_001"
    },
    {
      "type": "device_history",
      "range": "24h"
    },
    {
      "type": "plant_library",
      "plantLibraryId": 12
    }
  ]
}
```

## 4. 推荐意图分类

建议在 Agent 内部先识别意图，再决定是否调用工具。

### 4.1 `status_query`

适用问题：

- “现在怎么样？”
- “设备正常吗？”

调用工具：

- `get_device_snapshot`

### 4.2 `trend_analysis`

适用问题：

- “最近是不是越来越干？”
- “温度波动大吗？”

调用工具：

- `get_device_snapshot`
- `get_device_history`

### 4.3 `care_knowledge`

适用问题：

- “绿萝怎么养？”
- “黄叶怎么办？”

调用工具：

- `get_plant_profile`
- `search_rag_knowledge`

### 4.4 `diagnosis`

适用问题：

- “现在最需要处理什么？”
- “为什么状态变差了？”

调用工具：

- `get_device_snapshot`
- `get_device_history`
- `get_plant_profile`

### 4.5 `todo_planning`

适用问题：

- “帮我记一下今晚浇水”
- “生成今天的养护任务”

调用工具：

- 第一阶段：只返回 `todoSuggestions`
- 后续阶段：用户确认后通过 `/agent/action` 调用 `create_care_todo`

### 4.6 `control_decision`

适用问题：

- “现在要不要开风扇？”
- “帮我开风扇”

调用工具：

- `get_device_snapshot`
- 第一阶段：只返回控制建议
- 后续阶段：用户确认后通过 `/agent/action` 调用 `send_safe_device_command`

## 5. 推荐工具层定义

Agent 不应直接访问数据库或设备控制接口，而应通过统一工具层。

### 5.1 `get_device_snapshot(logicalKey)`

输入：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001"
}
```

输出：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "alias": "客厅绿萝",
  "plantType": "绿萝",
  "updatedAt": 1747213200000,
  "params": {
    "soil_percent": { "value": 18, "time": 1747213200000 },
    "dht_temp": { "value": 29, "time": 1747213200000 },
    "dht_humi": { "value": 51, "time": 1747213200000 },
    "light_val": { "value": 1380, "time": 1747213200000 },
    "test": { "value": false, "time": 1747213200000 }
  }
}
```

来源：

- `api-scf /device/latest`

### 5.2 `get_device_history(logicalKey, metric, range)`

输入：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "metric": "soil_percent",
  "range": "24h"
}
```

输出：

```json
{
  "metric": "soil_percent",
  "range": "24h",
  "points": [
    { "bucketStart": 1747209600000, "avg": 26.4 },
    { "bucketStart": 1747211400000, "avg": 22.1 },
    { "bucketStart": 1747213200000, "avg": 18.0 }
  ],
  "summary": {
    "trend": "down",
    "min": 18.0,
    "max": 26.4,
    "avg": 22.2
  }
}
```

来源：

- `api-scf /device/history`

### 5.3 `get_plant_profile(plantLibraryId, plantType)`

输入：

```json
{
  "plantLibraryId": 12,
  "plantType": "绿萝"
}
```

输出：

```json
{
  "id": 12,
  "name": "绿萝",
  "feature": "耐阴，易养护",
  "care": {
    "light": "明亮散射光",
    "water": "土壤微干再浇透"
  },
  "tags": ["耐阴", "观叶", "室内"]
}
```

来源：

- `api-scf /plant/library`
- 本地知识库补充说明

### 5.4 `create_care_todo(logicalKey, title, urgency)`

> 后续执行型工具。第一阶段 `/agent/chat` 只返回待办建议，不直接创建。

输入：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "title": "今晚补水",
  "urgency": "high"
}
```

输出：

```json
{
  "success": true,
  "todoId": "12345",
  "title": "今晚补水"
}
```

来源：

- `api-scf /todo/add`

### 5.5 `send_safe_device_command(logicalKey, action)`

> 后续执行型工具。第一阶段 `/agent/chat` 只返回控制建议，不直接下发命令。

输入：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "action": "fan_on"
}
```

动作白名单建议：

- `fan_on`
- `fan_off`

映射示例：

- `fan_on` -> `{ "test": true }`
- `fan_off` -> `{ "test": false }`

输出：

```json
{
  "success": true,
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "action": "fan_on",
  "sentParams": {
    "test": true
  }
}
```

来源：

- `api-scf /device/cmd`

## 6. 动作执行接口建议

> 该接口属于第二阶段能力。上线前必须有用户二次确认、动作白名单、权限校验和操作日志。

### 6.1 `POST /agent/action`

用途：

- 执行 `chat` 响应中返回的动作卡片

请求示例：

```json
{
  "sessionId": "sess_20260514_001",
  "action": {
    "type": "create_todo",
    "payload": {
      "logicalKey": "Aruv1l24Y6::Nova_demo_001",
      "title": "今晚补水",
      "urgency": "high"
    }
  }
}
```

这样可以避免：

- 模型在对话阶段直接做不可逆动作
- 前端把模型生成内容直接当命令发送

## 7. 会话管理建议

### 7.1 会话标识

建议使用：

- `openid + logicalKey + 页面类型 + 时间片`

也可由前端生成 `sessionId`。

### 7.2 会话内容

初期建议仅保存：

- 最近几轮用户问题
- 最近几轮 Agent 响应摘要
- 当前设备上下文

初期存储可直接放 MySQL。

## 8. 错误返回建议

统一结构：

```json
{
  "success": false,
  "code": "DEVICE_NOT_FOUND",
  "message": "未找到当前设备，暂时无法完成诊断。"
}
```

推荐错误码：

- `UNAUTHORIZED`
- `DEVICE_NOT_FOUND`
- `NO_DEVICE_CONTEXT`
- `KNOWLEDGE_NOT_FOUND`
- `ACTION_NOT_ALLOWED`
- `TOOL_EXECUTION_FAILED`
- `LLM_RESPONSE_INVALID`

## 9. 小程序前端接入建议

建议新增一个“植物管家”入口，支持三类 UI：

### 9.1 问答输入框

用于：

- 用户自然语言提问

### 9.2 结构化结果卡片

展示：

- 总结
- 风险等级
- 当前依据
- 建议动作

### 9.3 动作按钮区

包括：

- 创建待办
- 查看趋势
- 执行安全控制（第二阶段开放，必须二次确认）

## 10. 第一阶段范围

第一阶段建议仅开放：

- `/agent/chat`
- 只读工具
- 待办建议卡片
- 不自动执行控制

等结果稳定后，再开放：

- `/agent/action`
- 白名单控制动作
