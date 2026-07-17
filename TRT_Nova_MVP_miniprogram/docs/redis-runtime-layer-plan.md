# Redis 实时层接入现状

更新时间：2026-07-14

这份文档只描述仓库中已经落地的 Redis 接入预留层，不把它表述成“已经在云端启用”。

## 目标

当前目标不是立刻把主链路切到 Redis，而是先把最值得放进 Redis 的几类数据接上“可选承接层”：

- 在线状态
- 最新快照
- 命令处理中状态
- 短期防重标记

这样做的好处是：

- 不配置 Redis 时，系统继续按当前 MySQL 主链路运行
- 配置 Redis 时，可以先开始写入实时态，不必一次性改造所有读取接口

## 当前已落地的位置

### `api-scf`

文件：

- `dist/scf/api-scf/lib/runtimeCache.js`
- `dist/scf/api-scf/index.js`

当前已接入：

- 命令进入队列时写入 command processing 状态
- 命令状态写入 latest command state
- 命令发送成功 / 失败时更新缓存状态

### `ingest-scf`

文件：

- `dist/scf/ingest-scf/lib/runtimeCache.js`
- `dist/scf/ingest-scf/index.js`

当前已接入：

- 写入消息短期防重标记
- 写入设备最新快照
- 写入设备在线状态
- 在 ACK / done 回报时推进命令缓存状态

## 当前 Redis 键模型

当前预留的键空间包括：

- `trt:nova:device:latest:{logicalKey}`
- `trt:nova:device:online:{logicalKey}`
- `trt:nova:device:command:latest:{logicalKey}`
- `trt:nova:command:state:{commandId}`
- `trt:nova:command:processing:{commandId}`
- `trt:nova:message:dedup:{deviceId}:{messageId}`

默认前缀可通过 `REDIS_KEY_PREFIX` 修改。

## 当前行为边界

### 已做到

- Redis 成为一个“增强层”
- 未配置 Redis 时，主链路不受影响
- Redis 连接失败时，不阻塞设备消息入库和命令主流程
- `/device/latest` 已具备“Redis 补实时态、MySQL 保底”的读路径雏形：优先使用 Redis 中更近实时的 online/latest/command 状态，但事实底座仍以 MySQL ACL 与 latest 读取模型为准
- `/device/commands` 与 `/device/command/detail` 已具备“Redis 补命令实时态、MySQL 保底”的读路径雏形：列表和详情会优先吸收 Redis 中更近实时的命令状态推进结果
- `api-scf` 已开始输出 Redis 命中/回退摘要：latest、commands、detail 三条查询链路都会输出结构化日志，并在响应中附带 `cacheMeta`

### 还没做到

- `/device/latest` 完全改成 Redis 优先读取
- `/device/commands` 完全改成 Redis 优先读取
- Redis 与 MySQL 的读一致性策略细化
- Redis 主动失效 / 回补策略
- Redis 监控指标与命中率评估

## 环境变量

当前预留的 Redis 变量：

- `REDIS_ENABLED`
- `REDIS_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_KEY_PREFIX`
- `REDIS_DEVICE_LATEST_TTL_SEC`
- `REDIS_DEVICE_ONLINE_TTL_SEC`
- `REDIS_COMMAND_STATE_TTL_SEC`
- `REDIS_MESSAGE_DEDUP_TTL_SEC`

## 当前阶段建议

当前最合适的推进方式是：

1. 先在测试或试运行环境启用 Redis 写入
2. 先观察键内容是否稳定、TTL 是否合理
3. 再考虑让个别热点接口优先读 Redis
4. 最后再决定是否抽出独立常驻实时服务

## 当前可观测性

当前 Redis 读路径已经有最小可观测性：

- 结构化日志事件
  - `device_latest_cache_summary`
  - `device_commands_cache_summary`
  - `device_command_detail_cache_summary`

- 接口响应字段
  - `cacheMeta`

这意味着现在已经可以回答：

- latest 这次请求有多少设备吃到了 Redis latest / online / latest command
- commands 列表这次有多少条命令吃到了 Redis 补态
- detail 这次是命中 Redis 还是回退到 MySQL

一句话说：

现在的 Redis 不是主链路替代品，而是“为后续实时层和高并发演进做的安全预埋”。
