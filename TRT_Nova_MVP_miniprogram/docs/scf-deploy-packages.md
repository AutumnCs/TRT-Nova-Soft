# SCF 部署包说明

> 更新日期：2026-07-14。这里描述仓库中的可部署代码，不据此推断云端已经部署或配置完成。

## 当前部署包

| 目录 | 作用 |
|---|---|
| `dist/scf/auth-scf` | 微信登录、用户落库、token 签发 |
| `dist/scf/api-scf` | 业务 API、OneNET/EMQX 设备控制 |
| `dist/scf/ingest-scf` | OneNET/EMQX 遥测接入和 MySQL 入库 |
| `dist/scf/agent-scf` | 只读植物养护 Agent 和可选 LLM |
| `dist/scf/history-cleanup-scf` | 历史数据清理、消息审计保留清理、命令超时巡检 |

部署前应在对应目录安装生产依赖，并按目录 README 确认入口函数。

## 建议部署与验证顺序

1. 数据库表结构和增量 SQL
2. `auth-scf`
3. `api-scf`
4. `ingest-scf`
5. `agent-scf`
6. `history-cleanup-scf` 和每日触发器
7. 微信小程序合法域名与运行时地址
8. 逐条执行登录、绑定、遥测、历史、控制、Agent 和清理验证

## 小程序当前默认地址

`app.js` 当前配置：

- `api-scf`: `https://1395114552-hkiu70pwre.ap-shanghai.tencentscf.com`
- `agent-scf`: `https://1395114552-5acci5kbwy.ap-shanghai.tencentscf.com`
- `auth-scf`: `https://1395114552-0etc4ugmnu.ap-shanghai.tencentscf.com`

这些地址应逐步移出源码，按开发、测试和生产环境管理。

## 环境变量分类

各部署包的 `.env.example` 是字段明细的直接来源。主要分类如下：

### 数据库与认证

- `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`
- `DB_CONN_LIMIT`
- `JWT_SECRET`
- `WECHAT_APPID`、`WECHAT_SECRET`
- `TOKEN_EXPIRES_IN_SECONDS`

`DEBUG_OPENID` 只能用于临时调试，不应在正式环境长期启用。

### 命令链路

`api-scf` 当前已经提供：

- `POST /device/cmd`
- `POST /device/commands`
- `POST /device/command/detail`
- `POST /device/command/retry`

也就是说，当前试运行阶段已经具备：

- 下发命令
- 查询最近命令列表
- 查询单条命令详情
- 按原参数重试命令

### OneNET

- `ONE_NET_TOKEN`、`ONE_NET_AES_KEY`
- `ONENET_AUTH_MODE`、`ONENET_AUTH_METHOD`
- 产品、项目或用户级 Access Key 相关变量
- `FAN_SWITCH_IDENTIFIER`

已记录验证的 OneNET 接入主路径是“数据推送 -> `ingest-scf`”。规则引擎裁剪推送不标记为已验证主路径。

### EMQX

- `EMQX_WEBHOOK_TOKEN`、`EMQX_PRODUCT_ID`
- `EMQX_PUBLISH_URL` 或兼容名称
- `EMQX_APP_ID`、`EMQX_APP_SECRET`
- `EMQX_COMMAND_TOPIC_TEMPLATE`、`EMQX_COMMAND_QOS`、`EMQX_COMMAND_RETAIN`
- `DEVICE_CMD_PROVIDER_DEFAULT`

仓库已经实现 EMQX 兼容代码；是否已完成真实环境验证需要看部署配置和日志。

### Agent / LLM

- `LLM_API_ENABLED`
- `LLM_API_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`
- 可选 path、temperature、max tokens 和 timeout 配置

未配置 LLM 时，Agent 会回退到本地规则与轻量知识增强。

### 历史清理

- `INGEST_RETENTION_DAYS`
- `RAW_RETENTION_DAYS`
- `AGG_5M_RETENTION_DAYS`
- `AGG_1H_RETENTION_DAYS`
- `AGG_1D_RETENTION_DAYS`
- `COMMAND_TIMEOUT_MINUTES`
- `ALERT_OFFLINE_MINUTES`
- `ALERT_COMMAND_LAG_MINUTES`

部署包存在不代表清理任务正在运行；必须确认 SCF 定时触发器、权限和执行日志。
当前建议它至少承担两类巡检：

- 清理 `device_message_ingest` 与历史聚合数据
- 把超时未完成的 `device_commands` 标记为失败

## 发布检查

- 不把 `.env`、数据库密码或平台密钥提交到仓库
- 确认所有 SCF 使用一致的数据库和 JWT 配置
- 检查数据库连接池上限，避免多个 SCF 实例耗尽连接
- 校验微信合法域名、TLS 和接口超时
- 用真实账号验证 ACL，确认无法读取或控制其他用户设备
- 用真实设备验证“下发成功 -> 设备执行 -> 状态重新上报”的闭环
