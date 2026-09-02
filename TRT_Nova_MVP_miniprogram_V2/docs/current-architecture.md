# 当前架构入口

> 文档状态：Current Documentation Index  
> 最近审阅：2026-07-19

系统长期目标、领域边界与协作基线请先阅读：

- [`plant-pet-software-system-blueprint.md`](./plant-pet-software-system-blueprint.md)

需要快速了解技术路线、部署阶段和研发分工时请阅读：

- [植宠产品技术栈定版](./plant-pet-technical-architecture-brief.md)

目标技术架构、代码框架、平台能力与产品级验收基线请阅读：

- [`plant-pet-technical-architecture-target.md`](./plant-pet-technical-architecture-target.md)

从当前 SCF Demo 开始安排具体研发顺序时请阅读：

- [植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)

当前完成度、问题和近期改进计划请阅读：

- [`current-system-status-and-improvement-plan.md`](./current-system-status-and-improvement-plan.md)

当前实现专题只保留以下文档：

- [设备字段协议](./device-field-protocol.md)
- [`scf-onenet-command-path.md`](./scf-onenet-command-path.md)
- [`scf-onenet-command-api-notes.md`](./scf-onenet-command-api-notes.md)
- [`hardware-control-current-solution.md`](./hardware-control-current-solution.md)
- [`scf-deploy-packages.md`](./scf-deploy-packages.md)

从 CloudBase 到 SCF/MySQL 的旧迁移问答、旧产品路线和旧 Agent/RAG 规划已移入[历史文档归档](./archive/README.md)，不得再作为当前排期或部署依据。

## 当前正式主链路

- 设备 -> OneNET 数据推送 -> `ingest-scf` -> MySQL
- 小程序 -> `auth-scf` -> token
- 小程序 -> `api-scf` -> MySQL / OneNET

## 当前下行控制建议

当前正式下行控制链路：

- 小程序 -> `api-scf /device/cmd`
- `api-scf` -> OneNET 北向 HTTP API
- OneNET -> 设备

不建议当前再新增一层：

- 自建 MQTT client
- 自定义 broker 中转
- 自定义命令转发服务

## 当前已文档化的 OneNET 控制相关内容

- [`scf-onenet-command-path.md`](./scf-onenet-command-path.md)
- [`scf-onenet-command-api-notes.md`](./scf-onenet-command-api-notes.md)
- [`hardware-control-current-solution.md`](./hardware-control-current-solution.md)

## 仓库里的 legacy 提醒

以下内容保留作历史参考，但不再视为当前正式主路径：

- [`legacy/cloudfunctions/sendDeviceCmd/index.js`](../legacy/cloudfunctions/sendDeviceCmd/index.js)
- [`services/core/CloudAdapter.js`](../services/core/CloudAdapter.js)
- [`services/DB.js`](../services/DB.js)

当前产品和后端演进以：

- `SCF + MySQL + OneNET`

为准。

如文档发生冲突，当前运行事实以代码、部署证据和《当前系统现状与改进路线》为准；技术选型以《植宠产品技术栈定版》为准；实施顺序以《植宠系统实施顺序与演进路线》为准。
## AI 协作入口

如果你想让 agent 更快理解本仓库，先读这两份简版入口文档：
- [`ai-project-map.md`](./ai-project-map.md)
- [`ai-workflow.md`](./ai-workflow.md)
