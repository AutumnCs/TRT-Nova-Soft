# 当前架构与实现状态

> 更新日期：2026-07-14。本文件是仓库内“当前状态”的主要事实源。云端是否已部署、环境变量是否完整、真实链路是否健康，仍需通过控制台和运行日志确认。

## 1. 产品与工程定位

当前项目是原生微信小程序智能花盆 MVP，已经具备完整演示链路，但不是大规模产品级系统。

当前仓库包含三部分：

- 微信小程序主线：根目录 `app.js`、`pages/`、`services/`
- SCF 后端部署包：`dist/scf/`
- Flutter 实验客户端：`flutter_app/`，不属于微信小程序正式主线

## 2. 当前架构

```text
设备
  -> OneNET / EMQX
  -> ingest-scf
  -> MySQL

微信小程序
  -> auth-scf：微信登录、openid、token
  -> api-scf：用户、设备、历史、控制、Todo、日记、植物库
  -> agent-scf：设备状态解读、植物知识、养护建议、可选 LLM

设备控制
  -> api-scf /device/cmd
  -> 根据 provider 选择 OneNET HTTP API 或 EMQX Publish API
  -> 设备执行并重新上报真实状态
```

MySQL 是业务事实数据库。CloudBase 不再承担设备和用户的主数据链路，但头像上传、云文件 URL 解析及旧 Adapter 仍保留兼容代码。

## 3. 前端分层

页面应通过服务层访问后端：

```text
pages -> services/modules -> ScfApiAdapter -> SCF HTTP API
```

正式运行时配置现在已经改为分层入口：

- `envList.js`
- `services/config/runtimeProfiles.js`
- `services/config/runtime.js`

当前已支持 `dev / test / prod` 三套 profile，并允许通过 `runtimeConfigOverrides` 做局部覆盖；CloudBase 默认关闭，不再作为主链路默认初始化。

## 4. 已在仓库实现的 SCF

| 部署包 | 仓库能力 |
|---|---|
| `auth-scf` | 微信登录、用户落库、token 签发 |
| `api-scf` | 用户资料、设备 latest/history、绑定、解绑、资料、控制、Todo、日记、植物库与收藏 |
| `ingest-scf` | OneNET 验签/解密与数据归一；EMQX webhook 归一；写入 MySQL |
| `agent-scf` | 只读养护问答、设备状态/历史读取、植物知识增强、可选 OpenAI-compatible LLM |
| `history-cleanup-scf` | 按保留周期清理历史数据、消息审计数据，并巡检命令超时 |

这些目录存在只代表“已实现/已打包”，不自动代表云端已部署或定时触发器已经配置。

## 5. 业务 API 实现范围

`api-scf` 当前代码包含：

- `/health`
- `/device/latest`
- `/device/history`
- `/device/bind`
- `/device/unbind`
- `/device/profile`
- `/device/cmd`
- `/device/commands`
- `/device/command/detail`
- `/device/command/retry`
- `/user/profile`
- `/todo/list`、`/todo/global`、`/todo/add`、`/todo/complete`、`/todo/toggle-urgent`
- `/journal/month`、`/journal/day`、`/journal/add`
- `/plant/library`、`/plant/favorite/toggle`

`agent-scf` 当前提供 `/agent/chat`。现阶段 Agent 是只读建议型能力，不直接执行设备控制或 Todo 写入。

## 6. 数据模型

主要 MySQL 表包括：

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_message_ingest`
- `device_commands`
- `device_history_raw`
- `device_history_agg`
- Todo、植物库、收藏和植物日记相关表

`device_acl` 是设备归属与权限边界；`device_message_ingest` 是归一化消息与幂等入口；`device_latest` 是设备真实状态的读取模型。控制 API 返回成功不等于设备已经执行，最终状态应以设备重新上报后写入的 latest 为准。

`api-scf /device/latest` 现在会直接返回 `online`、`offline`、`onlineStatus`、`lastSeenAt`、`offlineSinceMs`，并补充前端直出聚合字段：

- `sensorSnapshot`：温度 / 湿度 / 光照 / 土壤湿度
- `controlSnapshot`：风扇已上报状态、最近命令状态、是否仍在处理中
- `plantSnapshot`：runState / irStatus / isDead / soulState / favorability / personality / reportedPlantType
- `displaySnapshot`：可直接展示的时间与在线状态文本

前端与告警层应优先使用这些字段，而不是各页面自行猜测。

## 7. IoT 平台口径

OneNET 是已经形成主要文档和联调记录的接入平台。当前代码还实现了 EMQX：

- `ingest-scf` 可识别并归一 EMQX webhook
- `api-scf` 可读取 provider 元数据并选择 EMQX 下行
- 未获得云端配置和日志前，不把 EMQX 表述为“生产环境已验证”

OneNET 规则引擎裁剪推送仍不属于已验证主路径。已记录的 OneNET 主接入方式是数据推送到 `ingest-scf`。

## 8. 当前明确边界

- 没有 Redis 正式架构
- 没有消息队列削峰链路
- 已有 `device_commands`、`pending/sent/acked/done/failed` 基础状态流、`/device/commands` 查询接口和“设备回报驱动的闭环尝试”，但仍缺少超时重试、主动推送和 Redis 实时态承接
- 已补最小结构化日志：消息接收/去重/入库、命令 queued/sent/failed、定时超时清理完成与失败，排障时可按 `messageId`、`logicalKey`、`commandId` 串联关键节点
- 没有证据表明所有 SCF 部署包都已发布为最新版本
- 数据库公网/私网状态属于部署环境事实，不能仅靠仓库确认
- 自动化测试、容量测试、监控告警和灾备仍不完整

## 9. Legacy 与历史资料

以下代码不再视为当前业务主路径：

- `legacy/cloudfunctions/`
- `services/DB.js`

迁移阶段资料保留用于解释历史决策，但若与本文件或当前代码冲突，以本文件和代码为准。

## 10. 产品化方向

近期优先级：

1. 核验云端部署版本、环境变量和真实健康状态
2. 数据库私网化、索引、备份、归档和恢复演练
3. 遥测幂等、乱序处理和历史清理任务上线核验
4. 命令状态机、超时、回执和审计
5. 多环境配置、Secret 管理、自动化测试和 CI/CD
6. 按真实瓶颈引入 Redis、消息队列和完整可观测性
## 11. Capacity evidence and scale planning

The repository now includes two explicit trial-stage capacity references:

- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./trial-scale-stage-plan.md)

Current evidence level:

- there is now a lightweight load-smoke script for runtime endpoints
- there is now a documented trial-stage baseline for success rate, latency review, and rollback-aware validation
- there is still no proof of large-scale production concurrency readiness

Current planning stance:

- around `100` devices is the practical target range for the current small stable trial goal
- around `1000` devices, runtime-service should already be the default real-time core for latest-state and command closure
- around `10000` devices, a more formal scale-oriented backend posture is required
