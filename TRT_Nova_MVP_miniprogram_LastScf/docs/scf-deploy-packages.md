# SCF 部署单元说明

> 文档状态：Current Implementation Reference  
> 核对日期：2026-07-19  
> 适用范围：当前 SCF Demo；长期演进顺序见[植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)

## 1. 当前部署单元

源码和部署内容以 `dist/scf` 下实际目录为准，不再使用已经删除的 `reference/*Scf.example.js` 作为部署来源。

| 目录 | 入口 | 职责 | 触发方式 |
|---|---|---|---|
| `dist/scf/auth-scf` | `index.main` / `index.main_handler` | 微信登录、openid、JWT | HTTP/API 网关 |
| `dist/scf/api-scf` | `index.main` / `index.main_handler` | 设备、绑定、用户、待办、日记、植物库与控制 | HTTP/API 网关 |
| `dist/scf/ingest-scf` | `index.main` / `index.main_handler` | OneNET/EMQX webhook、latest/raw/aggregate | HTTP webhook |
| `dist/scf/agent-scf` | `index.main` / `index.main_handler` | `/agent/chat`、只读工具、知识增强与可选 LLM | HTTP/API 网关 |
| `dist/scf/history-cleanup-scf` | `index.main_handler` | 清理超过保留期的遥测历史 | 每日定时触发器 |

当前仍保持 4 个业务 SCF + 1 个清理任务，不因目标架构中的逻辑模块增加而立即拆出更多函数。

## 2. 配置入口

小程序 SCF 地址当前配置在：

- [app.js](../app.js)
- [services/config/runtime.js](../services/config/runtime.js)

`app.js` 当前分别配置 API、Agent 和 Auth 地址。调整环境或重新部署后，应同步更新微信小程序合法域名，并在 staging 完成登录、查询、控制和 Agent 冒烟测试。文档不复制具体 URL，避免配置变更后出现两套答案。

## 3. 环境变量分类

这里只记录变量名，不记录任何真实值。`.env.example` 必须只包含占位符；数据库、微信、JWT、OneNET 和模型凭证通过部署环境或密钥管理注入。

| 部署单元 | 必需变量 | 条件/可选变量 |
|---|---|---|
| auth | `WECHAT_APPID`、`WECHAT_SECRET`、`JWT_SECRET`、`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` | `TOKEN_EXPIRES_IN_SECONDS`、`DB_CONN_LIMIT` |
| api | `JWT_SECRET`、数据库变量 | `DB_CONN_LIMIT`、OneNET 鉴权与风扇字段配置；`DEBUG_OPENID` 只能用于隔离测试 |
| ingest | 数据库变量、`ONE_NET_TOKEN` | `ONE_NET_AES_KEY`、EMQX 兼容变量、`DB_CONN_LIMIT` |
| agent | `JWT_SECRET`、数据库变量 | `LLM_API_ENABLED`、`LLM_API_BASE_URL`、`LLM_API_PATH`、`LLM_API_KEY`、`LLM_MODEL`、超时/温度/Token 限制；`DEBUG_OPENID` 只能用于隔离测试 |
| cleanup | 数据库变量 | `RAW_RETENTION_DAYS`、`AGG_5M_RETENTION_DAYS`、`AGG_1H_RETENTION_DAYS`、`AGG_1D_RETENTION_DAYS`、`DB_CONN_LIMIT` |

生产环境不得启用身份回退。所有看起来曾经可用的示例凭证都应按泄露处理并轮换，具体风险记录见[当前系统现状与改进路线](./current-system-status-and-improvement-plan.md)。

## 4. 当前部署与验证顺序

1. 备份数据库，确认 migration/Schema 版本；
2. 部署 `auth-scf`，验证真实微信登录和非法 Token；
3. 部署 `api-scf`，验证绑定、latest、待办、日记和控制 ACL；
4. 部署 `ingest-scf`，用测试设备验证 OneNET webhook、latest 和历史写入；
5. 部署 `agent-scf`，验证只读事实、无 LLM 回退和鉴权；
6. 部署 `history-cleanup-scf` 及每日触发器，先在 staging 或受控测试数据上验证保留边界；
7. 更新小程序地址与合法域名，执行完整冒烟/E2E；
8. 保存函数版本、环境变量名清单、触发器、commit 和回滚版本到 deployment manifest。

当前部署包尚未完全实现统一 lockfile、运行时声明和 CI 构建；这些属于实施路线 R1—R2 的必做项。现阶段重新部署前必须记录实际安装命令和 Node.js 运行时，不能假设不同目录依赖一致。

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
