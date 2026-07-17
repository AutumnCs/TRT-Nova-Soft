# 最小巡检与监控骨架

更新时间：2026-07-14

这份文档描述仓库里已经落地的“最小巡检骨架”，目标不是完整监控平台，而是先把试运行期最关键的异常变成可定时检查、可日志追踪、可离线汇总的对象。

## 当前承载点

当前最小巡检由 `dist/scf/history-cleanup-scf` 承担。

它现在负责两类工作：

- 清理与状态收口
  - 清理 `device_message_ingest`
  - 清理历史原始表与聚合表
  - 将超时未完成的 `device_commands` 标记为 `failed`

- 巡检摘要输出
  - 超过阈值仍未上报的设备
  - 超时前已经出现积压的命令

## 已覆盖的检查项

### 1. 命令超时无 ACK

通过 `COMMAND_TIMEOUT_MINUTES` 控制最终失败化阈值。

当命令状态仍处于以下集合时：

- `pending`
- `sent`
- `acked`

并且请求时间早于超时阈值，`history-cleanup-scf` 会将其改写为：

- `status = failed`
- `error_message = Command timed out without ACK`（当原错误为空时）

这一动作属于“状态收口”。

### 2. 设备长时间无上报

通过 `ALERT_OFFLINE_MINUTES` 控制巡检阈值。

定时任务会扫描 `device_latest.updated_at_ms`，找出超过该阈值仍没有新上报、且存在活跃 ACL 的设备，并输出摘要。

当前输出字段包括：

- `logicalKey`
- `alias`
- `productId`
- `deviceName`
- `lastSeenAt`

这一项当前属于“可巡检、可追踪”，还不是自动通知。

### 3. 命令积压预警

通过 `ALERT_COMMAND_LAG_MINUTES` 控制巡检阈值。

定时任务会扫描仍处于以下状态的命令：

- `pending`
- `sent`
- `acked`

当它们尚未达到最终超时失败阈值，但已经明显滞留时，会输出积压摘要。

当前输出字段包括：

- `commandId`
- `logicalKey`
- `provider`
- `status`
- `requestedAt`

这一项的作用是提前发现：

- 下行链路变慢
- ACK 回报缺失
- 平台到设备之间的阻塞

### 4. 关键接口异常与入库异常

仓库里的 SCF 已经有结构化日志埋点，可作为最小异常统计来源：

- `api-scf`
  - `request_failed`
  - `device_command_failed`
- `ingest-scf`
  - `push_processing_failed`
  - `decrypt_failed`
- `history-cleanup-scf`
  - `cleanup_failed`
  - `cleanup_alerts_detected`

这意味着即使还没有正式接入监控平台，也可以先从日志导出里统计：

- 关键接口异常次数
- 消息入库/处理失败次数
- 命令失败次数
- 巡检告警次数

## 相关环境变量

`history-cleanup-scf` 当前涉及以下变量：

- `INGEST_RETENTION_DAYS`
- `RAW_RETENTION_DAYS`
- `AGG_5M_RETENTION_DAYS`
- `AGG_1H_RETENTION_DAYS`
- `AGG_1D_RETENTION_DAYS`
- `COMMAND_TIMEOUT_MINUTES`
- `ALERT_OFFLINE_MINUTES`
- `ALERT_COMMAND_LAG_MINUTES`

建议：

- `ALERT_COMMAND_LAG_MINUTES < COMMAND_TIMEOUT_MINUTES`
- `ALERT_OFFLINE_MINUTES` 依据真实设备心跳频率设置，试运行期可先用 30 分钟

## 当前输出形式

当前主要输出到两处：

- SCF 返回结果中的 `alerts`
- 结构化 JSON 日志

日志事件重点包括：

- `cleanup_completed`
- `cleanup_alerts_detected`
- `cleanup_failed`
- `request_failed`
- `push_processing_failed`
- `device_command_failed`

### runtime-service structured log supplement

If `runtime-service` is enabled during trial, keep its JSON logs as a parallel signal source.

Current event names:

- `runtime_ingest`
- `runtime_query_latest`
- `runtime_query_commands`
- `runtime_query_command_detail`
- `runtime_send_command`

Most useful first-pass fields:

- `logicalKey`
- `messageId`
- `commandId`
- `commandStatus`
- `deduplicated`
- `dedupSource`
- `latestSource`
- `onlineSource`
- `mode`
- `hits`
- `misses`

These fields help explain:

- whether a duplicate report was stopped by runtime cache or repository fact
- whether latest-state mainly came from hot cache or from fact backfill
- whether command list/detail was `repo_only`, `cache_merged`, or `cache_only`

## 新增：日志离线汇总脚本

仓库已提供一个最小可执行脚本：

- `scripts/monitoring-log-summary.js`

它可以读取 SCF 导出的 NDJSON / JSON Lines 日志，并输出汇总结果，重点统计：

- `request_failed`
- `push_processing_failed`
- `decrypt_failed`
- `device_command_failed`
- `cleanup_failed`
- `cleanup_alerts_detected`

示例：

```bash
node scripts/monitoring-log-summary.js --file ./logs/scf.ndjson --pretty
```

也可以带阈值配置：

```bash
node scripts/monitoring-log-summary.js --file ./logs/scf.ndjson --config ./reference/minimal-monitoring.config.example.json --pretty
```

输出结果会给出：

- 总体状态：`ok / warn / critical`
- 各类异常计数
- 服务维度计数
- 关键样本

## 推荐试运行动作

试运行阶段至少建议做到：

1. `history-cleanup-scf` 固定周期执行
2. 每天导出一次 SCF 结构化日志
3. 用 `scripts/monitoring-log-summary.js` 汇总日志
4. 当 `overall = critical` 时，人工介入排查

如果还没有接企业微信/飞书，这套已经足够支撑“小规模稳定试运行”的最小巡检。

## 还没做到的部分

当前还没有完整做到以下能力：

- 自动推送企业微信 / 飞书 / 短信通知
- 实时接口异常率面板
- Redis 实时态监控
- 云端统一告警收敛
- 多阈值分级与值班流程

所以这套能力应理解为：

“已经有最小巡检骨架和离线汇总工具，可支撑试运行排障，但还不是完整监控平台。”
