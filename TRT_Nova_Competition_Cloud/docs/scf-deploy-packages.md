# SCF 部署单元说明

> 文档状态：Current Implementation Reference  
> 核对日期：2026-09-09；竞赛交付入口以 README 与 cloud-initial 为准
> 适用范围：当前 SCF Demo；长期演进顺序见[植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)

## 1. 当前部署单元

源码和部署内容以 `dist/scf` 下实际目录为准，不再使用已经删除的 `reference/*Scf.example.js` 作为部署来源。

| 目录 | 入口 | 职责 | 触发方式 |
|---|---|---|---|
| `dist/scf/auth-scf` | 源入口 `index.main` / `index.main_handler`；云候选入口 `cloud-entry.main_handler` | 微信登录、openid、JWT | SCF Event Function + Function URL + SCF 自定义域名路径映射（待 D 层实测） |
| `dist/scf/api-scf` | 源入口 `index.main` / `index.main_handler`；云候选入口 `cloud-entry.main_handler` | 设备、用户、植宠、任务、日记、知识、天气、AI 记录与控制 | SCF Event Function + Function URL + SCF 自定义域名路径映射（待 D 层实测） |
| `dist/scf/ingest-scf` | 源入口 `index.main` / `index.main_handler`；云候选入口 `cloud-entry.main_handler` | OneNET/EMQX webhook、latest/raw/aggregate | SCF Event Function + Function URL；仅开放 webhook 精确路径（待 D 层实测） |
| `dist/scf/agent-scf` | 源入口 `index.main` / `index.main_handler`；云候选入口 `cloud-entry.main_handler` | `/agent/session`、`/agent/chat`、`/vision/analyze`、只读业务上下文、知识增强、记忆、无限状态与用量观测 | SCF Event Function + Function URL + SCF 自定义域名路径映射（待 D 层实测） |
| `dist/scf/history-cleanup-scf` | 源入口 `index.main_handler`；候选入口 `cloud-entry.main_handler` | 遥测保留与有账本的 COS 清理重试 | 候选每分钟定时；真实时区/触发待验 |

当前仍保持 4 个业务 SCF + 1 个清理任务，不因目标架构中的逻辑模块增加而立即拆出更多函数。

## 2. 配置入口

小程序 SCF 地址当前配置在：

- [services/config/runtime-profile.js](../services/config/runtime-profile.js)：本地/占位配置
- [deployment/cloud-initial/tools/render-config.mjs](../deployment/cloud-initial/tools/render-config.mjs)：目标云配置与 AppID

当前客户端通过 runtime-profile 读取配置，云客户端从 candidate.config.local.json 生成；不是直接改 app.js 中的三个旧 URL。调整环境后同步核对微信合法域名，在 staging 实测 Function URL 事件、完整路径、登录及业务接口。精确路由合同见 [function-url-routes.template.yaml](../deployment/cloud-initial/function-url-routes.template.yaml)；本轮不切换旧网关或线上入口。

## 3. 环境变量分类

这里只记录变量名，不记录任何真实值。`.env.example` 必须只包含占位符；数据库、微信、JWT、OneNET 和模型凭证通过部署环境或密钥管理注入。

| 部署单元 | 必需变量 | 条件/可选变量 |
|---|---|---|
| auth | `WECHAT_APPID`、`WECHAT_SECRET`、`JWT_SECRET`、`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` | `TOKEN_EXPIRES_IN_SECONDS`、`DB_CONN_LIMIT` |
| api | `JWT_SECRET`、数据库变量 | `DB_CONN_LIMIT`、OneNET 鉴权与风扇字段配置；`ALLOW_LEGACY_OPENID_FALLBACK=1` 与 `DEBUG_OPENID` 只能用于隔离测试 |
| ingest | 数据库变量、`ONE_NET_TOKEN` | `ONE_NET_AES_KEY`、EMQX 兼容变量、`DB_CONN_LIMIT` |
| agent | `JWT_SECRET`、数据库变量 | `LLM_API_ENABLED`、`LLM_API_BASE_URL`、`LLM_API_PATH`、`LLM_API_KEY`、`LLM_MODEL`、`VISION_MODEL`、`VISION_IMAGE_DETAIL`、Chat/Vision 超时与 Token 限制；M7 Shadow 与受控灰度各自的显式开关、HMAC 密钥、采样率、步数/工具预算、超时和输出上限；比赛阶段不设置 Chat/Vision 每日阻断变量，`ALLOW_LEGACY_OPENID_FALLBACK=1` 与 `DEBUG_OPENID` 只能用于隔离测试 |
| cleanup | 数据库变量 | `RAW_RETENTION_DAYS`、`AGG_5M_RETENTION_DAYS`、`AGG_1H_RETENTION_DAYS`、`AGG_1D_RETENTION_DAYS`、`DB_CONN_LIMIT` |

`api-scf` 和 `agent-scf` 的旧 openid 回退均默认关闭；生产环境不得设置 `ALLOW_LEGACY_OPENID_FALLBACK=1`。所有看起来曾经可用的示例凭证都应按泄露处理并轮换，具体风险记录见[当前系统现状与改进路线](./current-system-status-and-improvement-plan.md)。

小程序本地手机号体验入口由 `runtimeConfig.enableDevPhoneLogin` 控制并默认关闭。它不经过服务端手机号验证，不能作为正式手机号认证使用。

## 4. 当前部署与验证顺序

1. 备份数据库，确认 migration/Schema 版本；
2. 部署 `auth-scf`，验证真实微信登录和非法 Token；
3. 部署 `api-scf`，验证绑定、PlantPet、待办、日记、知识、天气、诊断、记忆和控制 ACL；
4. 部署 `ingest-scf`，用测试设备验证 OneNET webhook、latest 和历史写入；
5. 部署 `agent-scf`，验证会话、发布知识来源、结构化记忆、Chat/Vision 全账户无限策略、用量记账、模型失败回退和鉴权；
6. 部署 `history-cleanup-scf` 及候选每分钟触发器，先在 staging 验证时区、媒体账本与保留边界；
7. 更新小程序地址与合法域名，执行完整冒烟/E2E；
8. 以实际上传批次的 `RELEASE_MANIFEST.json` 和 [`release-record.template.md`](../deployment/cloud-initial/release-record.template.md) 记录函数版本、环境变量名、Function URL/自定义域名映射、触发器、commit、ZIP SHA-256 和回滚版本。

当前 `deployment/cloud-initial/` 已为 5 个函数分别冻结生产 lockfile、声明 `Nodejs20.19` 目标合同，并提供可重复的干净 staging、依赖裁剪、内容扫描、ZIP/manifest 逐文件校验和包哈希。它仍是**本地构建的云端初版候选**，不是 CI 发布系统，也没有在腾讯云实际运行；真实部署前仍须按[本地版到云端版迁移与交接指南](./local-to-cloud-deployment-guide.md)完成秘密解析、资源配置、数据库/媒体迁移及 D/E 层验证。

M7 Phase 2 的 `PlantPetRuntime` 位于 `dist/scf/agent-scf/runtime`，会随 `agent-scf` 源码进入部署包，但默认由 `AGENT_SHADOW_ENABLED=false` 关闭。体验版或正式环境不得仅因为代码已存在就开启 Shadow；开启前需要配置 `AGENT_SHADOW_FINGERPRINT_KEY`（或明确接受回退 `JWT_SECRET`）、采样率、步数/工具预算和超时，并验证日志不含原始 Query、openid、昵称、植宠/知识正文或模型草稿。Shadow 只比较 legacy 与三个只读工具的轨迹，不接管 HTTP 回复，也没有正式写工具。

M7 Phase 3—5 另由 `AGENT_ROLLOUT_ENABLED=false` 默认关闭。实际灰度前应配置独立 `AGENT_ROLLOUT_COHORT_KEY`，从 `AGENT_ROLLOUT_SAMPLE_RATE=0.1` 或更低开始，并记录目标环境的接管/回落率、SCF P50/P95、token 与模型/工具错误。抽样按鉴权账号和会话稳定，不按 Query；关闭总开关即可回到 legacy。新 runtime 可处理通过能力、来源、隐私、参数、结果和内容门禁的普通文本，并可调用已发布知识、账号称呼、当前植宠、已确认相关记忆等只读工具；明确的称呼记忆或养护任务意图最多生成 `pending` proposal，模型没有正式资料、记忆、任务、设备或媒体写权限。附件、Vision、正式确认、记忆治理、高风险请求和不满足结果合同的回合继续走受控旧链或 fail-closed。开启前必须在目标环境先演练开关回滚，不能把本地 provider P95 当作 SCF P95。

以上 M7 Shadow/灰度段落保留旧阶段机制说明，不是竞赛版的默认值。当前模板显式设置 AGENT_ROLLOUT_ENABLED=true、采样率 1、AGENT_SHADOW_ENABLED=false；关闭 Shadow 不等于关闭内部 runtime。任务确认和记忆治理仍有独立边界，实际配置以本目录模板与交付记录为准。

## 5. OneNET 当前结论

当前正式接入链路：

> 设备 → OneNET 数据推送 → `ingest-scf` → MySQL

OneNET 规则引擎裁剪推送尚未作为已验证主路径。下行控制使用：

> 小程序 → `api-scf /device/cmd` → OneNET 北向 API → 设备

详细接口与当前控制行为分别见：

- [OneNET 下行控制路径](./scf-onenet-command-path.md)
- [OneNET 下行接口与鉴权说明](./scf-onenet-command-api-notes.md)
- [当前软件控制硬件方案](./hardware-control-current-solution.md)

## 6. 与长期架构的关系

本文件只描述当前部署，不负责规划未来服务拆分。近期在现有 SCF 内建立身份、设备、PlantPet、养护、动作和 Agent 的代码边界；Redis、CKafka、TCHouse-C、Elasticsearch、容器和 TKE 只按实施路线门槛引入。
