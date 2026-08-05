# 历史文档归档

> 状态：Archive / 仅供追溯  
> 归档日期：2026-07-19

本目录保存曾经指导过项目、但已经被当前文档体系覆盖的方案和迁移快照。归档内容不是当前需求、架构或实施顺序，不能直接据此安排研发和部署。

当前有效入口：

- 长期产品系统：[植宠软件系统架构蓝图](../plant-pet-software-system-blueprint.md)
- 已确认技术栈：[植宠产品技术栈定版](../plant-pet-technical-architecture-brief.md)
- 详细技术规范：[植宠产品级技术架构目标](../plant-pet-technical-architecture-target.md)
- 唯一实施顺序：[植宠系统实施顺序与演进路线](../plant-pet-implementation-roadmap.md)
- 当前完成度与风险：[当前系统现状与改进路线](../current-system-status-and-improvement-plan.md)

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
