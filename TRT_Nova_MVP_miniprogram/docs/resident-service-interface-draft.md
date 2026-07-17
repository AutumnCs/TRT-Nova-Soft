# 常驻核心服务接口与事件流草案

更新时间：2026-07-14

这份文档是对 [常驻核心服务拆分方案](./resident-service-split-plan.md) 的下一层细化。

目标不是现在立刻改完代码，而是先把未来常驻服务的 contract 定清楚，让后续无论是：

- 先由 `api-scf` 转发
- 还是直接上 FastAPI
- 还是先接一段灰度链路

都能围绕同一套接口和事件流推进。

## 1. 设计原则

常驻服务接口草案遵循 4 个原则：

1. 尽量兼容当前 SCF 的前端调用方式
2. 设备实时态与普通业务态分开
3. 读接口面向页面直出，写接口面向命令闭环
4. 内部事件统一围绕 `deviceId / logicalKey / messageId / commandId`

## 2. 核心服务划分

建议最终收成两个对外服务、一个内部职责：

- Device Query Service
  - 面向小程序读取设备最新状态、命令状态
- Device Command Service
  - 面向小程序和平台下发命令
- Device Runtime Service
  - 面向设备消息接入、状态推进、ACK / done 处理

其中：

- Query / Command Service 可以先做成一个常驻服务
- Runtime Service 可以先接在 `ingest-scf` 后面，后续再独立成为真正设备运行时核心

## 3. 统一基础字段

### 3.1 设备消息统一模型

后端内部继续统一为：

```json
{
  "provider": "onenet",
  "deviceId": "Aruv1l24Y6::Nova_demo_001",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "productId": "Aruv1l24Y6",
  "deviceName": "Nova_demo_001",
  "messageId": "msg-001",
  "timestamp": 1710000000000,
  "type": "property",
  "messageType": "report",
  "payload": {
    "params": {
      "soil_percent": { "value": 48, "time": 1710000000000 }
    }
  }
}
```

这里的重点是：

- `deviceId` 与 `logicalKey` 当前阶段等价
- `messageId` 是幂等和追踪主键之一
- `payload` 保留原始业务含义，但后端内部只认这一层统一结构

### 3.2 命令统一模型

```json
{
  "commandId": "cmd_xxx",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "provider": "onenet",
  "commandName": "set_property",
  "status": "pending",
  "requestedAt": 1710000000000,
  "sentAt": null,
  "ackedAt": null,
  "doneAt": null,
  "failedAt": null,
  "sentParams": {
    "test": true
  },
  "latestSnapshot": {},
  "errorMessage": ""
}
```

## 4. 对外查询接口草案

## 4.1 POST /runtime/device/latest

用途：

- 给首页、设备页、详情页读取最新状态

请求：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001"
}
```

响应建议：

```json
{
  "success": true,
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "provider": "onenet",
  "online": true,
  "offline": false,
  "onlineStatus": "online",
  "lastSeenAt": 1710000000000,
  "offlineSinceMs": null,
  "updatedAt": 1710000000000,
  "sensorSnapshot": {
    "temp": { "value": 24.6, "time": 1710000000000 },
    "humidity": { "value": 60, "time": 1710000000000 },
    "soil": { "value": 48, "time": 1710000000000 }
  },
  "controlSnapshot": {
    "fan": {
      "reportedState": true,
      "pending": false,
      "latestCommandId": "cmd_xxx",
      "latestCommandStatus": "done"
    }
  },
  "plantSnapshot": {
    "isDead": false,
    "soulState": "normal",
    "reportedPlantType": "绿萝"
  },
  "displaySnapshot": {
    "onlineStatusText": "在线"
  },
  "cacheMeta": {
    "latestSource": "redis+mysql",
    "onlineSource": "redis"
  }
}
```

说明：

- 前端仍可维持现有直出结构
- 常驻服务先保证与 `api-scf /device/latest` 返回结构兼容

## 4.2 POST /runtime/device/commands

用途：

- 查询某设备最近命令状态列表

请求：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "limit": 20
}
```

响应：

```json
{
  "success": true,
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "commands": [
    {
      "commandId": "cmd_xxx",
      "status": "sent",
      "provider": "onenet",
      "requestedAt": 1710000000000,
      "sentAt": 1710000000500,
      "ackedAt": null,
      "doneAt": null,
      "failedAt": null,
      "sentParams": { "test": true }
    }
  ],
  "cacheMeta": {
    "source": "redis+mysql"
  }
}
```

## 4.3 POST /runtime/device/command/detail

用途：

- 单条命令详情与排障

请求：

```json
{
  "commandId": "cmd_xxx"
}
```

响应：

```json
{
  "success": true,
  "command": {
    "commandId": "cmd_xxx",
    "logicalKey": "Aruv1l24Y6::Nova_demo_001",
    "provider": "onenet",
    "status": "acked",
    "requestedAt": 1710000000000,
    "sentAt": 1710000000500,
    "ackedAt": 1710000003000,
    "doneAt": null,
    "failedAt": null,
    "sentParams": { "test": true },
    "latestSnapshot": {},
    "errorMessage": ""
  },
  "cacheMeta": {
    "source": "redis+mysql"
  }
}
```

## 5. 对外命令接口草案

## 5.1 POST /runtime/device/command/send

用途：

- 替代当前 `api-scf /device/cmd`

请求：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "provider": "onenet",
  "params": {
    "test": true
  },
  "requestId": "req_xxx"
}
```

响应：

```json
{
  "success": true,
  "commandId": "cmd_xxx",
  "commandStatus": "sent",
  "provider": "onenet",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "productId": "Aruv1l24Y6",
  "deviceName": "Nova_demo_001",
  "sentParams": {
    "test": true
  }
}
```

失败响应：

```json
{
  "success": false,
  "commandId": "cmd_xxx",
  "commandStatus": "failed",
  "provider": "onenet",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "msg": "OneNET error"
}
```

实现要求：

- 先写 `device_commands`
- 再发平台命令
- 再推进 `sent / failed`
- Redis 标记命令处理中状态

## 5.2 POST /runtime/device/command/retry

用途：

- 替代当前 `api-scf /device/command/retry`

请求：

```json
{
  "commandId": "cmd_xxx"
}
```

说明：

- 当前阶段仍建议重试生成新 commandId
- 原 command 记录保持审计完整

## 6. 内部运行时入口草案

## 6.1 POST /runtime/ingest/message

用途：

- 给 `ingest-scf` 或后续接入层调用
- 作为统一消息入口

请求：

```json
{
  "provider": "onenet",
  "deviceId": "Aruv1l24Y6::Nova_demo_001",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "productId": "Aruv1l24Y6",
  "deviceName": "Nova_demo_001",
  "messageId": "msg-001",
  "timestamp": 1710000000000,
  "type": "property",
  "messageType": "report",
  "payload": {
    "params": {
      "soil_percent": { "value": 48, "time": 1710000000000 }
    }
  },
  "sourceMeta": {
    "pushId": "push-001",
    "rawEvent": "webhook"
  }
}
```

响应：

```json
{
  "success": true,
  "deduplicated": false,
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "messageId": "msg-001",
  "recordCount": 1,
  "reconciledCommands": [
    {
      "commandId": "cmd_xxx",
      "toStatus": "done"
    }
  ]
}
```

如果命中幂等：

```json
{
  "success": true,
  "deduplicated": true,
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "messageId": "msg-001",
  "recordCount": 0
}
```

## 7. 内部事件流草案

建议内部把运行时链路明确成以下事件。

## 7.1 device.message.ingested

含义：

- 接入消息已通过基础校验并进入统一模型

建议字段：

```json
{
  "event": "device.message.ingested",
  "provider": "onenet",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "messageId": "msg-001",
  "timestamp": 1710000000000,
  "type": "property"
}
```

## 7.2 device.message.deduplicated

含义：

- 命中 `deviceId + messageId` 或等效幂等规则

## 7.3 device.latest.updated

含义：

- `device_latest` 已更新

建议字段：

```json
{
  "event": "device.latest.updated",
  "logicalKey": "Aruv1l24Y6::Nova_demo_001",
  "updatedAt": 1710000000000,
  "paramKeys": ["soil_percent", "dht_temp"]
}
```

## 7.4 device.online.updated

含义：

- 在线状态已刷新

## 7.5 device.command.queued

含义：

- 命令已写入 `device_commands`，状态为 `pending`

## 7.6 device.command.sent

含义：

- 平台下行已返回成功，状态推进到 `sent`

## 7.7 device.command.acked

含义：

- 设备 ACK 已识别

## 7.8 device.command.done

含义：

- 设备真实状态回报已满足命令完成条件

## 7.9 device.command.failed

含义：

- 平台返回失败、超时、或运行时判定失败

## 8. 与现有 SCF 的兼容接法

第一阶段建议这样接：

### 8.1 小程序不改接口名

- 小程序仍调 `api-scf /device/latest`
- 小程序仍调 `api-scf /device/cmd`
- 小程序仍调 `api-scf /device/commands`

### 8.2 SCF 做转发壳

等常驻服务上线后：

- `api-scf /device/latest` -> 转发到 `/runtime/device/latest`
- `api-scf /device/cmd` -> 转发到 `/runtime/device/command/send`
- `api-scf /device/commands` -> 转发到 `/runtime/device/commands`

### 8.3 ingest-scf 做统一入口壳

- `ingest-scf` 继续负责 OneNET / EMQX 兼容解析
- 解析完统一消息后，转发到 `/runtime/ingest/message`

这样做的好处是：

- 前端先不改
- 设备侧先不改
- 常驻服务可以逐步灰度上线

## 9. 第一批最值得先实现的接口

如果只做最小版本，建议优先做：

1. `POST /runtime/ingest/message`
2. `POST /runtime/device/command/send`
3. `POST /runtime/device/latest`
4. `POST /runtime/device/commands`

这四个接口足以先把：

- 设备上报
- 命令下发
- 最新状态读取
- 命令状态追踪

这四条最关键链路跑起来。

## 10. 一句话总结

常驻服务第一阶段不需要追求“大而全”，而应该先把：

- 统一消息入口
- 命令状态机
- 最新状态查询
- 在线状态更新

这几条 contract 固定下来。

只要 contract 稳了，后面不管你是继续 SCF 转发，还是正式切到 FastAPI，整个演进都会顺很多。

## 11. 仓库内当前 scaffold 对应

仓库里已经补了一个最小常驻服务骨架：

- `runtime-service/app/main.py`
- `runtime-service/app/models.py`
- `runtime-service/app/services.py`

当前它还是 scaffold：

- 用内存态模拟 latest / commands / dedup
- 已拆出 config / repository / provider adapter 分层
- 主要用于把接口边界先落成代码结构
- 还没有接 MySQL / Redis / OneNET / EMQX

但它已经足够作为下一阶段真正实现的代码入口。
