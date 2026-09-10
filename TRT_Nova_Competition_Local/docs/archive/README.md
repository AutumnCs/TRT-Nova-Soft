# 历史文档归档

> 状态：Archive / 仅供追溯  
> 最近整理：2026-09-08

本目录保存曾经指导过项目、但已经被当前文档体系覆盖的方案和迁移快照。归档内容不是当前需求、架构或实施顺序，不能直接据此安排研发和部署。

当前有效入口（维护和汇报先看这些）：

- 当前范围、验收与会议材料：[先看这里](../先看这里.md)
- 当前实现和维护：[当前架构](../current-architecture.md)
- 本地化与云候选：[本地化登记](../localization-compromise-register.md)、[云候选说明](../../deployment/cloud-initial/README.md)
- 长期目标另看：[软件系统蓝图](../plant-pet-software-system-blueprint.md)。7 月的技术栈/实施路线属于目标方案，不代表 9 月参赛版已切换到 NestJS 等框架。

## 2026-09-08 文档收敛

原产品入口、938 行 M7 报告、1099 行人工指南、409 行状态追踪分别保存在 [document-consolidation](./2026-09-08-document-consolidation/)。原报告与状态页改为兼容导航，当前产品说明和人工清单已重写。历史正文未丢失，相对链接已按归档位置调整。

本次删除的是当前阅读路径里的重复叙述和旧状态，不删除测试证据、原始需求、SQL、业务源码、云包或数据库。M6/Phase 文档保留原路径并标注历史性质，避免破坏既有追溯引用。

## 归档内容

| 文档 | 归档原因 | 仍可参考的内容 |
|---|---|---|
| `PRODUCT_ROADMAP.md` | 旧页面功能路线，已由产品蓝图和实施路线覆盖 | 早期页面功能与技术债务快照 |
| `plant-care-agent-plan.md` | 旧 Agent 分阶段规划，已由目标架构 R6 路线覆盖 | 当前轻量 Agent 的形成背景 |
| `agent-api-design.md` | 基于设备而非独立 PlantPet 的旧 API 草案 | 只读工具和确认式动作思想 |
| `plant-rag-knowledge-plan.md` | 旧 RAG 专项规划，当前已定为结构化知识优先、ES 按门槛引入 | 知识来源、清洗和事实优先原则 |
| `plant-library-enhancement-plan.md` | 旧植物库专项方案，尚未按 PlantPet/内容治理体系重审 | 高频植物结构化字段建议 |
| `scf-lightdb-current-strategy.md` | 从 CloudBase 转向 SCF + MySQL 的迁移快照已完成使命 | 主链路形成过程 |
| `scf-lightdb-migration-qa.md` | 迁移问答与当前实现部分冲突 | 当时的迁移决策和保留策略 |
| `system-risks-and-stability-notes.md` | 风险已合并到当前现状和实施路线 | 首页轮询、latest 回显等历史问题 |

若要恢复其中某项方案，必须先对照当前代码和基线文档重新评审，不能只修改归档文件后直接执行。
