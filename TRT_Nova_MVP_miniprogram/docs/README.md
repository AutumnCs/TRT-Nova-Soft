# TRT Nova 文档索引

## 文档状态规则

本文档中的状态含义：

- 已实现：仓库代码中已经存在对应实现
- 已打包：`dist/scf` 中存在可部署目录
- 已部署：已经确认发布到云端，不能只根据仓库代码推断
- 已验证：有真实环境联调或运行证据
- 规划：尚未成为当前正式能力

发生冲突时，优先级为：

当前代码与运行证据 > [当前架构与实现状态](./current-architecture.md) > 专题设计文档 > 迁移记录与历史规划

## 当前事实源

- [当前架构与实现状态](./current-architecture.md)
- [产品化路线图](./PRODUCT_ROADMAP.md)
- [环境配置与切换说明](./environment-configuration.md)
- [Trial Environment Variable Matrix](./trial-environment-variable-matrix.md)
- [常驻核心服务拆分方案](./resident-service-split-plan.md)
- [常驻核心服务接口与事件流草案](./resident-service-interface-draft.md)
- [Runtime Service Migration Map](./runtime-service-migration-map.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Deployment Checklist](./trial-deployment-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Trial Readiness Gap Assessment](./trial-readiness-gap-assessment.md)
- [First Trial Acceptance Record Template](./first-trial-acceptance-record-template.md)
- [First Trial Acceptance Record Sample](./first-trial-acceptance-record-sample.md)
- [Current Goal Completion Audit Summary](./current-goal-completion-audit-summary.md)
- [Daily Trial Ops Checklist](./daily-trial-ops-checklist.md)
- [Trial Weekly Report Template](./trial-weekly-report-template.md)
- [Incident Review Template](./incident-review-template.md)
- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./trial-scale-stage-plan.md)
- [Staged Deployment and Scaling Guide](./staged-deployment-and-scaling-guide.md)
- [Next-Stage Optimization Plan](./next-stage-optimization-plan.md)
- [Four-Week Trial Execution Plan](./four-week-trial-execution-plan.md)
- [Runtime Service Scaffold 目录](../runtime-service/README.md)
- [设备字段协议](./device-field-protocol.md)
- [系统风险与稳定性说明](./system-risks-and-stability-notes.md)
- [SCF 部署包说明](./scf-deploy-packages.md)
- [最小巡检与监控骨架](./minimal-monitoring-checks.md)
- [Redis 实时层接入现状](./redis-runtime-layer-plan.md)
- [Legacy 与 CloudBase 清理清单](./legacy-cleanup-checklist.md)

## 专题文档

- [OneNET 下行控制路径](./scf-onenet-command-path.md)
- [OneNET 接口与鉴权](./scf-onenet-command-api-notes.md)
- [硬件控制当前方案](./hardware-control-current-solution.md)
- [Agent API 设计](./agent-api-design.md)
- [植物养护 Agent 规划](./plant-care-agent-plan.md)
- [植物库增强规划](./plant-library-enhancement-plan.md)
- [轻量知识增强规划](./plant-rag-knowledge-plan.md)
- [IoT 平台兼容说明](../reference/iot-provider-compatibility.md)

## 历史迁移资料

以下文档保留用于复盘，不作为当前状态最高优先级来源：

- [SCF + MySQL 迁移阶段方案](./scf-lightdb-current-strategy.md)
- [迁移 Q&A](./scf-lightdb-migration-qa.md)

## 其他说明

`flutter_app/` 目录是独立客户端实验线，其进度以 `flutter_app/PROJECT_PROGRESS.md` 为准，不代表微信小程序主线状态。
