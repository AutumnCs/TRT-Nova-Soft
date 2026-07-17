# TRT Nova 智能植宠 MVP

TRT Nova 是一个微信小程序方向的智能植宠项目，目前定位是：

从“可演示 Demo”继续收口到“可小规模稳定试运行”。

当前主能力包括：

- 设备接入与状态展示
- 设备控制与命令状态跟踪
- 植物养护辅助能力
- 小程序前端 + SCF 后端 + MySQL 数据层
- Redis 轻量实时层预留 / 已接入部分链路

## 当前技术口径

- 前端：原生微信小程序
- 认证：`auth-scf`
- 业务 API：`api-scf`
- 消息接入：`ingest-scf`
- 巡检/清理：`history-cleanup-scf`
- Agent 能力：`agent-scf`
- 主数据库：MySQL
- 实时态补充：Redis（可选启用）
- 设备平台：当前以 OneNET 为主，仓库保留 EMQX 兼容实现
- CloudBase：不再作为主业务链路，仅保留少量兼容/历史资产

## 当前主链路

```text
设备 -> OneNET / EMQX -> ingest-scf -> MySQL (+ Redis 可选)
小程序 -> auth-scf -> token
小程序 -> api-scf -> MySQL / Redis / IoT 平台
小程序 -> agent-scf -> MySQL / 知识能力 / 可选 LLM
定时任务 -> history-cleanup-scf -> 清理 / 超时补偿 / 轻量巡检
```

## 当前阶段已经收口的关键点

- 统一设备消息模型，后端内部按固定结构处理消息
- 建立/完善最新状态聚合能力，前端优先读取最新状态接口
- 建立/完善命令状态表，支持 `pending / sent / acked / done / failed`
- 增加消息防重和幂等处理
- 打通“下发 -> 执行 -> ACK / 回报 -> 前端可见”的命令闭环
- Redis 已接入轻量实时层，用于最新快照、在线态、命令处理中状态、短期防重
- 清理 CloudBase 主链路依赖，明确其已退居兼容层

## 当前仍然属于产品化补齐项

- 开发 / 测试 / 生产环境彻底分离
- 更完整的监控告警
- 更系统的压测与容量验证
- Redis 在生产环境的正式启用与观测
- 核心实时链路从 SCF 逐步抽为常驻服务
- OneNET / EMQX 主路径进一步收敛，避免长期双主并行

## 文档入口

- [文档索引](./docs/README.md)
- [当前架构与实现状态](./docs/current-architecture.md)
- [产品化路线图](./docs/PRODUCT_ROADMAP.md)
- [环境配置与切换说明](./docs/environment-configuration.md)
- [Trial Environment Variable Matrix](./docs/trial-environment-variable-matrix.md)
- [常驻核心服务拆分方案](./docs/resident-service-split-plan.md)
- [常驻核心服务接口与事件流草案](./docs/resident-service-interface-draft.md)
- [Runtime Service Migration Map](./docs/runtime-service-migration-map.md)
- [Runtime Service Trial Rollout Checklist](./docs/runtime-service-rollout-checklist.md)
- [Trial Deployment Checklist](./docs/trial-deployment-checklist.md)
- [Trial Acceptance Checklist](./docs/trial-acceptance-checklist.md)
- [Trial Readiness Gap Assessment](./docs/trial-readiness-gap-assessment.md)
- [First Trial Acceptance Record Template](./docs/first-trial-acceptance-record-template.md)
- [First Trial Acceptance Record Sample](./docs/first-trial-acceptance-record-sample.md)
- [Current Goal Completion Audit Summary](./docs/current-goal-completion-audit-summary.md)
- [Daily Trial Ops Checklist](./docs/daily-trial-ops-checklist.md)
- [Trial Weekly Report Template](./docs/trial-weekly-report-template.md)
- [Incident Review Template](./docs/incident-review-template.md)
- [Trial Capacity Baseline](./docs/trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./docs/trial-scale-stage-plan.md)
- [Staged Deployment and Scaling Guide](./docs/staged-deployment-and-scaling-guide.md)
- [Next-Stage Optimization Plan](./docs/next-stage-optimization-plan.md)
- [Four-Week Trial Execution Plan](./docs/four-week-trial-execution-plan.md)
- [Runtime Service Scaffold](./runtime-service/README.md)
- [设备字段协议](./docs/device-field-protocol.md)
- [SCF 部署包说明](./docs/scf-deploy-packages.md)
- [最小巡检与监控骨架](./docs/minimal-monitoring-checks.md)
- [Redis 实时层接入现状](./docs/redis-runtime-layer-plan.md)

## 当前定位说明

这个仓库现在适合：

- 演示
- 联调
- 小规模试运行准备

但还不能直接等同于“大规模产品级稳定运行”。

真正进入更高并发和更高稳定性阶段，还需要继续补：

- Redis 生产化
- 监控告警体系
- 容量压测
- 常驻后端服务化
- 更严格的配置与密钥治理
