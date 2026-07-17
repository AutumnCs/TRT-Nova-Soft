# TRT Nova 产品化路线图

> 更新日期：2026-07-14。状态以仓库代码为依据；“已实现”不等于“已部署并在线验证”。

## 当前已实现

- 原生微信小程序页面和自定义 TabBar
- 微信登录、token 和用户资料 API
- 设备绑定、解绑、用户侧设备资料和 ACL
- 设备 latest、历史趋势和多设备展示
- OneNET 设备接入与下行控制
- EMQX webhook 和下行 Publish 兼容代码
- Todo 列表、添加、完成和紧急状态
- 植物库、收藏和本地回退数据
- 植物成长日记 API 与页面
- 天气服务、传感器阈值和离线判断框架
- 只读植物养护 Agent、轻量知识增强和可选 LLM
- 历史数据清理 SCF 部署包

## 发布前核验

以下事项不能只看仓库代码，需要在真实环境确认：

- `auth-scf`、`api-scf`、`ingest-scf`、`agent-scf` 是否均为最新部署版本
- `history-cleanup-scf` 是否已部署并配置每日触发器
- MySQL 表结构和增量 SQL 是否全部执行
- OneNET、EMQX、微信、天气和 LLM 环境变量是否完整
- 微信小程序 request/downloadFile 合法域名是否配置
- EMQX 上下行链路是否已经完成真实设备验证
- 数据库备份、白名单和网络边界是否满足试用要求

## P0：真实用户试用前

1. 统一开发、测试和生产配置，移除前端硬编码环境地址
2. 为登录、设备绑定、越权访问和设备控制补自动化测试
3. 完善数据库唯一约束、索引、事务和备份恢复流程
4. 为遥测上报补幂等键、重复消息和乱序数据处理规则
5. 上线并监控历史清理任务，避免历史表无限增长
6. 为请求增加 request ID、结构化日志、错误聚合和基础告警
7. 将数据库密码、IoT 密钥、JWT 和 LLM Key 纳入 Secret 管理
8. 明确隐私政策、账号注销和用户数据删除流程

## P1：产品稳定性

1. 建立设备命令状态：`pending/sent/acknowledged/failed/timeout`
2. 将“接口下发成功”和“设备真实执行成功”分开显示
3. 核验并推进数据库私网/CCN 连接
4. 建立原始历史、聚合历史的保留和归档策略
5. 引入 Redis，用于限流、幂等、热点缓存、会话和设备在线状态
6. 流量上升后在 webhook 与历史写入之间引入消息队列
7. 建立 CI/CD、灰度发布和快速回滚流程

## P2：产品体验

- 用户级或植物级告警阈值
- 微信订阅消息和离线推送
- 新用户引导与设备配网指引
- 更丰富的趋势交互和聚合查询
- 植物健康周报和分享卡片
- Agent 工具调用；设备控制必须经过白名单、确认和审计
- Agent 会话持久化与受控长期记忆

## P3：增长能力

- 分享与邀请
- 植物健康报告
- 社区内容和排行榜
- 多语言和跨端能力

## 暂不优先

- 为了“看起来像产品级”而提前拆分大量微服务
- 在没有缓存命中率和数据库瓶颈证据前大规模引入 Redis
- 未建立安全策略前允许 Agent 自主控制设备
- 未完成数据量评估前引入重型向量数据库或完整 RAG 平台
## Capacity staging notes

The next delivery target is not “large-scale high concurrency”.

The next delivery target is:

- move from demo posture into small stable trial
- make the hot path measurable
- keep expansion decisions tied to evidence

Use these repo documents together:

- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./trial-scale-stage-plan.md)

Recommended interpretation:

- `~100 devices`: target range for current stage
- `~1000 devices`: runtime-service should be the default hot-path core
- `~10000 devices`: formal scale architecture work becomes mandatory
