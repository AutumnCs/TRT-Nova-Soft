# TRT Nova 植宠产品技术栈定版

> 文档定位：用于研发立项、人员分工和环境建设的主技术栈  
> 结论状态：已确认，可作为 T0—T3 的研发基线  
> 基线日期：2026-07-18  
> 最近审阅：2026-07-19  
> 实施顺序：[植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)

## 1. 定版结论

本项目主技术路线确定为：

**原生微信小程序 + TypeScript / Node.js + NestJS + Fastify + Drizzle ORM + MySQL + OneNET + 腾讯云 SCF，后续按规模加入 Redis、CKafka、TCHouse-C（ClickHouse）、COS、Elasticsearch 和 TKE Serverless。**

这套组合兼顾现有代码迁移、IoT 接入、AI 扩展、团队招聘、长期维护和云成本。T0/T1 不更换主语言，不建设全量微服务，不同时引入多套同类框架。

## 2. 唯一主选技术栈

| 层级 | 确认技术 | 用途 |
|---|---|---|
| 微信端 | 原生微信小程序 + TypeScript | 当前主客户端；保留微信生态能力并渐进迁移现有 JavaScript |
| 管理后台 | React + TypeScript + Vite | 运营、客服、设备、内容和审核后台 |
| 移动 App | Flutter + Dart | T2 启动正式 App；T0/T1 不组建独立 App 产品线 |
| 业务后端 | Node.js Active LTS + TypeScript strict | 用户、植宠、养护、设备、互动和社区主业务 |
| 后端框架 | NestJS + Fastify Adapter | 模块、依赖注入、鉴权、OpenAPI 和 HTTP 服务 |
| 数据校验 | Zod | API、事件、配置和环境变量 Schema |
| 数据访问 | Drizzle ORM + drizzle-kit + mysql2 | 类型化查询、Schema migration；复杂查询允许受控 SQL |
| 事务数据库 | 腾讯云 TDSQL-C MySQL 8 | 用户、植宠、绑定、任务、命令、社区等权威业务数据 |
| IoT 平台 | OneNET + 自有 Provider Adapter | 设备连接、上报和命令下发；业务代码不直接依赖 OneNET 数据结构 |
| 缓存 | 腾讯云 Redis | T1 出现共享缓存、限流、会话或锁需求后启用，不作为主数据库 |
| 异步消息 | MySQL Outbox 起步，T2 升级腾讯云 CKafka | 可靠任务、遥测流、事件消费、积压和重放 |
| 遥测与分析 | MySQL 聚合起步，T2/S2 升级腾讯云 TCHouse-C（ClickHouse） | 大规模遥测历史、趋势分析和运营统计；不承载业务事务 |
| 文件与媒体 | 腾讯云 COS + CDN | 图片、音频、视频、固件和导出文件 |
| 搜索与向量检索 | 腾讯云 Elasticsearch | T2 统一承载社区搜索、知识检索和向量召回，早期不部署 |
| Agent | TypeScript 状态机 + OpenAI-compatible Provider Adapter | 对话、工具调用、人格和记忆编排；权限与设备动作仍由业务后端控制 |
| AI 数据处理 | Python + FastAPI | 仅用于知识处理、离线评估和确需 Python 生态的 AI 服务 |
| 实时通信 | WSS WebSocket + 托管 ASR/TTS | 文字、状态和硬件语音流式互动 |
| 当前计算平台 | 腾讯云 SCF | API、webhook、Agent 和定时任务 |
| 后续计算平台 | Docker + TCR + TKE Serverless | T2 承载常驻、长连接或需要独立扩缩的服务 |
| API 契约 | OpenAPI 3.1 + AsyncAPI | 客户端、服务、事件和设备团队的协作边界 |
| 可观测性 | OpenTelemetry + 腾讯云 CLS/云监控 | 日志、指标、Trace、告警和 SLO |
| 基础设施管理 | Terraform | 云资源、环境和权限的可重复部署 |
| CI/CD | GitHub Actions | 检查、测试、构建、制品和环境发布 |
| 测试 | Vitest + Supertest + Testcontainers + miniprogram-automator + k6 | 单元、API、真实依赖、小程序 E2E 和压测 |
| Monorepo | pnpm workspaces | 管理小程序、后端、契约和共享 TypeScript 包 |

## 3. 当前实际部署

现在只部署：

1. 原生微信小程序；
2. `auth-scf`、`api-scf`、`ingest-scf`、`agent-scf`；
3. 历史清理定时任务；
4. 现有 MySQL；产品化环境统一到 TDSQL-C MySQL 8；
5. OneNET；
6. API 网关、CLS、云监控和备份。

当前不部署 Redis、CKafka、TCHouse-C、Elasticsearch、TKE、Temporal、独立向量数据库和独立 Python 在线服务。

## 4. 后续引入顺序

| 顺序 | 引入内容 | 进入条件 |
|---:|---|---|
| 1 | TypeScript、NestJS/Fastify、Drizzle、pnpm Monorepo、CI | 立即建设，作为多人研发前置条件 |
| 2 | Redis | 出现多实例共享缓存、限流、会话或分布式协调需求 |
| 3 | COS + CDN | 正式上线用户图片、语音或社区媒体 |
| 4 | CKafka | Outbox 无法满足吞吐、积压、消费组或重放要求 |
| 5 | TCHouse-C（ClickHouse） | 遥测保留和聚合后，MySQL 仍无法满足写入、历史查询或分析成本目标 |
| 6 | Docker + TKE Serverless | 出现稳定常驻负载、长连接，或 SCF 成本/限制不再合适 |
| 7 | Elasticsearch | 社区和知识数据规模使 MySQL 检索无法达到效果与延迟目标 |
| 8 | Flutter App、Python AI 服务 | 产品进入多端和复杂 AI 阶段 |

## 5. 研发人员按此分配

- 小程序研发：原生小程序 + TypeScript；
- 后端研发：TypeScript、NestJS、Fastify、Drizzle、MySQL；
- IoT 研发：OneNET、设备协议、ingest、数字孪生和命令链路；
- 数据研发：T2/S2 开始负责 CKafka、TCHouse-C、遥测模型和数据生命周期；
- AI 研发：先使用 TypeScript Agent；需要知识处理和评估时再增加 Python；
- Web 研发：React、TypeScript、Vite；
- 测试研发：Vitest、Testcontainers、小程序自动化和 k6；
- 平台研发：SCF、Terraform、GitHub Actions、OpenTelemetry；达到 T2 后再承担容器和 TKE。

## 6. 明确不混用

- 后端只用 NestJS + Fastify，不再同时引入 Express/Koa；
- 数据访问统一 Drizzle，不并行使用 Prisma、TypeORM；
- API Schema 统一 Zod，不再同时维护多套校验模型；
- 事务主库统一 MySQL，不在同阶段增加 PostgreSQL；
- 早期异步统一 Outbox，规模化后统一 CKafka；
- 大规模遥测历史统一 TCHouse-C，不使用 Elasticsearch 代替时序分析库；
- 普通业务统一 TypeScript，Python 只进入 AI 边界；
- OneNET、腾讯云和模型厂商 SDK 只能存在于 Adapter 层。

## 7. 维护与成本结论

该技术栈可以确认用于长期研发。MySQL 始终承载核心事务；Redis 承载可重建缓存；CKafka 承载事件流；TCHouse-C 承载大规模遥测与分析；Elasticsearch 承载全文与向量检索；COS 承载媒体和归档。各数据系统职责不重叠。

成本控制方式也已确定：SCF/MySQL 起步；Redis、CKafka、TCHouse-C、Elasticsearch、TKE 按指标逐项引入；媒体与日志设置保留期和预算；AI 按用户和会话设置配额。详细容量、SLO、安全和验收规则见[产品级技术架构目标](./plant-pet-technical-architecture-target.md)。
