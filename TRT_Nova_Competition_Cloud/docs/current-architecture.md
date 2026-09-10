# 当前架构

更新：2026-09-10。交付内容与验证状态见[交付说明](./competition-delivery.md)及[环境验证清单](./localization-compromise-register.md)。

## 产品与服务

小程序提供首页、AI助手、日历、我的四个 Tab，知识库为页面入口，形成植宠档案、AI 观察、用户确认的养护任务、打卡和成长日记的闭环。基础功能不依赖硬件。本处校正既有导航名称，不是本轮重组界面。

业务后端使用 SCF，MySQL 保存身份与业务记录，CloudBase 保存图片和文档原文件。Auth、API、Agent 分别使用独立 HTTPS Function URL；函数入口统一为 index.main_handler。环境变量直接在 SCF 配置。函数分工与部署参数见[云端部署架构](./lastscf-deployment-reuse.md)。

代码、依赖锁与构建工具由本目录独立提供，不读取其他项目副本。云客户端按目标配置生成；示例地址不能用于体验版。

## 代码归属

| 功能 | 主要入口 | 数据来源 |
|---|---|---|
| 页面与交互 | pages、components、custom-tab-bar | 页面状态与账号隔离缓存 |
| 登录与请求 | services/modules/AuthService.js、services/core/ScfApiAdapter.js | 微信登录 → auth-scf → JWT |
| 植宠、任务、日记 | api-scf/lib/plant-pets.js、care-tasks.js、plant-journal.js | MySQL 业务表 |
| 天气与节气 | api-scf/lib/weather.js、qweather-client.js、SolarTermService | 天气服务缓存、Asia/Shanghai 日历 |
| 知识与检索 | api-scf/knowledge.js、agent-scf/rag/knowledgeSearch.js | MySQL 已发布内容；JSON 用于种子或数据库错误兜底 |
| 文本对话与执行控制 | agent-scf/agent/chatHandler.js、runtime/rolloutRuntime.js | 已鉴权请求、当前会话与植宠范围 |
| 模型与受限工具 | agent-scf/runtime/plantPetRuntime.js、modelAdapter.js、toolRegistry.js | 请求级运行状态与允许的业务接口 |
| 会话上下文与摘要 | agent-scf/lib/conversation-context.js | 原文、会话摘要、用户已开启的跨会话摘要 |
| 会话与任务候选 | agent-scf/lib/agent-store.js、api-scf/lib/action-proposals.js、care-task-proposals.js | 消息、事件、确认状态和幂等键 |
| 图片与文档 | agent-scf/agent/visionHandler.js、documentHandler.js、api-scf/lib/media-storage.js | 有归属的持久化附件与内容解析 |
| 云适配 | deployment/cloud-initial/overlays | CloudBase 文件接口、内容核验和函数运行配置 |
| 构建、迁移与验证 | deployment/cloud-initial/tools、test-local-candidate.ps1 | 当前源码、依赖锁、隔离数据库及测试样本 |

表中后端短路径均从 dist/scf 起。完整文件定位见[文件地图](./ai-project-map.md)。

## Agent、会话与任务

当前 Agent 使用内部 PlantPetRuntime，在已鉴权的请求内调用模型和允许的工具。普通文本、图片和文档保留各自处理链，共享当前会话上下文。请求结果经过检查后才作为回复或待确认任务候选返回。

正式任务由用户预览、编辑并确认；api-scf 再次校验账号、植宠、候选状态和字段，通过事务及幂等键避免重复写入。模型输出本身不具有正式业务写权限。

会话原文保留到用户删除，页面以 40 条分页。重新编辑复制有效前缀到新会话，原会话保留；撤回只作用于本人当前会话的有效轮次，并同步处理候选与媒体引用。

上下文使用近期最多 8 轮完整原话及约 2 万字符预算，较早内容压缩到 ai_session_context；仍可检索本会话原文。同会话通过数据库命名锁串行处理，跨会话摘要通过短事务合并。

跨会话摘要默认关闭。用户开启后，轮后请求提取有当前用户原话依据的低风险事实，最多 30 项，并生成可读摘要。用户可编辑全文、清除或关闭；旧偏好记录保留兼容展示。

摘要内容 revision 与用户控制 policy_version 分开。编辑、关闭、清除、撤回、分支与来源删除均执行版本或来源校验，防止旧请求写回被删除的信息。摘要请求失败不删除已保存对话，也不报告更新成功。当前没有后台重试队列。

回复采用处理中反馈后返回完整回答，不是逐 token 流式。没有多 Agent、后台持续执行或自主设备控制；测试工具不属于生产 Agent 权限。

## 输入框与附件

components/conversation-composer 使用微信原生 editor。正文与功能原子在发送前分别投影为用户文字及白名单 selectedFunction；功能图标不是用户附件。正文上限 300 字，Enter 换行，箭头发送。

附件选择与异步请求核对账号、植宠、会话和页面状态。允许同一会话的原生选择器 hide/show；切换账号或会话后，旧回包不得覆盖新页面。

云端附件流程为 /media/upload 准备 → wx.cloud.uploadFile 上传 → /media/complete 校验登记。图片最多 2 MiB，文档最多 1 MiB。MySQL 保存永久 cloud:// fileID、内容摘要、归属和业务引用；临时显示地址或客户端缓存不是持久化来源。

解析、读取、替换、撤回及删除均检查归属。数据库触发器和 history-cleanup-scf 协同处理引用清理、孤儿文件和失败重试。未完成上传保留 24 小时清理宽限，已引用会话附件不因此自动删除。

当前独立 staging 已启用原有 history-cleanup-scf 的每分钟定时器，每次最多处理 2 个待清理对象，没有公开 HTTP 入口。2026-09-10 自然周期完成 9 个测试对象的物理删除，原头像有效引用与下载保持正常。这是固定后台维护，不赋予 Agent 后台自主执行或新增工具权限；故障注入重试和跨真实账号验证仍待完成。

## 数据与环境

- 服务端身份以 JWT 为准，不信任客户端声明的 owner。云端使用真实微信换码；开发身份只存在于本地测试服务。
- 云 AppID 由 auth-scf.WECHAT_APPID 统一派生。AppSecret 和模型/天气密钥只放服务端环境。
- MySQL 当前按已核实的旧实例链路使用 legacy-direct：直连，不传入 SSL 配置。private-network 与 required 保留但暂不选用，required 仍校验证书与主机名，不自动回退明文。具体端点保留在本地部署配置；本机直连不代表 SCF 出站验证通过。新部署使用独立业务库，旧用户数据不自动迁移。
- 当前按用户要求复用现有数据库账号，不新建账号或修改其权限。目标新库已创建并初始化 30 张表、1 个媒体清理触发器；结构、事务回滚、触发器行为和包内连接模块的实连通过。同账号分库不代表账号权限隔离，SCF/微信端验收仍需继续。
- 知识只返回已发布内容。数据库查询成功但无匹配时返回无结果；原已审核的 17 种植物与 10 篇文章已按用户本次授权发布到当前 staging，列表、搜索、无匹配和真实模型来源引用通过。原审核人和时间保留，仍是临时 MVP 内容，不代表长期内容资产方案已确定。
- 日期、任务重复和日计数使用 Asia/Shanghai。站内提醒已实现；关闭微信后的订阅通知仍不在已完成范围。
- Chat/Vision 不设账号次数上限，继续记录用量。天气默认关闭，开启时核实完整参数和真实服务响应。
- 设备写入与 ingest 默认关闭。保留的设备动作链是小程序 → api-scf → OneNET，命令下发不等于设备已执行。
- Redis 不在当前运行依赖中；只有实际容量或协调需求明确时才另行评估。

## 构建与验证

dist/scf 是部署源码。云构建按白名单生成五个函数包；本地服务器、调试登录与测试替身不进入部署包。数据库迁移覆盖会话事件、任务幂等、上下文摘要、媒体引用与清理触发器；不自动复制本地身份或历史 BLOB。

本机产品回归、包入口、依赖和真实隔离 MySQL 场景已验证；早期自动演练中的外部接口使用测试替身，不能替代真实云验证。2026-09-10 已执行单真实微信账号的云端业务、模型、媒体、知识和自然清理测试；双真实账号及实体手机仍待验。后续准备发现“不创建任务”被错误识别为任务请求，虽未创建正式任务但产生了错误候选，整体验收不能据此宣布通过。

维护文档后运行 npm run check:context；业务变更按影响运行相应单元、数据库、云端或页面检查。迁移步骤见[部署指南](./local-to-cloud-deployment-guide.md)，本地与云端差异见[环境验证清单](./localization-compromise-register.md)。
