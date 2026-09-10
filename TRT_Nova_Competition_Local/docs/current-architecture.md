# 当前架构：给接手开发的人

最近核对：2026-09-09。当前竞赛交付先读[README](../README.md)与[交付记录](./competition-delivery.md)。本文保留产品实现和历史演进底稿；以下旧阶段的“已通过”不是本目录新增的云端或真机验收。

本目录拥有独立前端、SCF 源码、依赖锁、初始化和云构建工具，不读取同仓库其他版本。本地版生成自己的 loopback 配置与专用新库；云端版默认地址不可用，按目标配置生成 HTTPS 客户端。CloudBase 关闭，旧云地址不沿用。新库初始化不再 DROP，日常启动只检查 schema，进程管理不接管系统 MySQL。

天气默认关闭且不读取天气 SSM 秘密，开启时必须补齐参数；云 AppID 只有 auth-scf.WECHAT_APPID 一个配置源。公网出站可采用经验证的 SCF 公网能力或 VPC NAT，未把配置选择当作连通性证明。Agent 框架、内部 runtime、请求级控制、记忆规则和用户确认边界未改变；测试设施不是后台执行框架。

## 当前版本与边界

参赛版沿用微信小程序 + SCF 后端源代码 + MySQL，软件闭环不依赖硬件。M7 Phase 0—5 已有本地实现；M7 最终人工验收、首次访问性能仍未闭环。云端体验版和真机属于 M8。长期目标见[蓝图](./plant-pet-software-system-blueprint.md)，不要与本版范围混在一起。

当前 Agent 是路线 A 的内部 `PlantPetRuntime`，不是官方 `pi-agent-core` 生产依赖。Phase 4 会话/偏好、Phase 5 任务提案已经实现，不再沿用旧文档“尚未开始”的描述。模型能选择受限工具，但不能因此获得正式业务写权限。

2026-09-07 晚：用户确认新范围后，已替换上下文记忆路径。原文不再自动删除；普通Chat、回退、图片与文档共享本会话上下文；跨会话摘要开启一次后自动整理。真实模型专项已通过，完整页面与人工验收状态看《先看这里》。旧Phase 4的逐条偏好确认只保留兼容接口，不再代表默认记忆系统。

## 从哪里改

| 要改什么 | 主要入口 | 数据由谁负责 |
|---|---|---|
| 页面与交互 | `pages/*`、`custom-tab-bar` | 页面状态与展示缓存 |
| 登录、请求、运行环境 | `services/modules/AuthService.js`、`services/core/ScfApiAdapter.js`、`services/config/runtime.js` | 微信登录 → auth-scf → JWT |
| 植株、任务、日记 | `api-scf/lib/plant-pets.js`、`care-tasks.js`、`plant-journal.js` | MySQL 业务表；JWT owner 校验 |
| 天气、节气 | `api-scf/lib/weather.js`、`qweather-client.js`、`SolarTermService` | 真实天气缓存；Asia/Shanghai 日历 |
| 已发布知识 | `api-scf/knowledge.js`、`agent-scf/rag/knowledgeSearch.js` | MySQL；JSON 仅种子/数据库出错兜底 |
| 普通对话与新旧链切换 | `agent-scf/agent/chatHandler.js`、`runtime/rolloutRuntime.js` | 本轮运行与结果检查 |
| 模型和工具循环 | `runtime/plantPetRuntime.js`、`modelAdapter.js`、`toolRegistry.js` | 临时运行状态，不是长期事实 |
| 模型本轮看什么、自动摘要 | `agent-scf/lib/conversation-context.js` | 完整原文、会话摘要、已开启的跨会话摘要；旧runtime投影器保留兼容 |
| 会话与提案持久化 | `agent-scf/lib/agent-store.js`、`api-scf/lib/action-proposals.js`、`care-task-proposals.js` | 消息快照、追加事件、确认状态、幂等写入 |
| 图片、文档 | `agent/visionHandler.js`、`documentHandler.js`、`api-scf/lib/media-storage.js` | 专用处理链与有归属的永久附件 |
| 本地启动、复测 | `scripts/local-server/manage-m7-manual-runtime.ps1`、`run-m7-full-acceptance.ps1` | 已有专用本地库；独立测试账号 |
| 管理台、旧硬件 | `admin-web`、`dist/scf/admin-scf`、`ingest-scf`、设备 API | 保留边界，不是本轮重构扩展范围 |

表中后端短路径都从 `dist/scf/` 起；runtime 位于 `dist/scf/agent-scf/runtime/`。完整文件地图见 [ai-project-map](./ai-project-map.md)。

## Agent 的实际分工

```text
消息 → 会话有效分支 + 当前账号/植株范围
     → 相关知识、偏好和业务事实 → 模型 ↔ 允许的工具
     → 检查结果 → 回复/待确认候选
     → 用户确认 → 业务 API 重新校验并保存
```

- 会话原文在 `ai_messages` 保留到用户删除，40条只是页面分页大小。分支复制完整前缀；原会话保留。
- `runContextualTurn` 是已鉴权HTTP入口的共同包裹层，用请求独立的 AsyncLocalStorage（异步调用链局部上下文）贯通全部模型路径。客户端不能注入或替换它。近期最多8轮完整原话且预算约2万字符；较早原话增量压缩到 `ai_session_context`，仍可经 `search_session_history` 查原文。没有把MySQL与临时session文件做成两套真相源。
- `ai_context_memory` 默认关闭。用户开启一次后，完成轮次的短模型请求提取有当前用户原话依据的低风险事实，按主题合并，最多30项。用户可在 `pages/aiMemory` 修正、遗忘、关闭。旧 `ai_memories` 保留兼容/业务来源展示，不再注入正常对话作为个人偏好。
- 同一会话用数据库命名锁串行处理，释放由finally保证；不同会话共享摘要时短事务合并。摘要内容revision与用户控制policy_version分开：编辑/删除/关闭会使旧推理失效；AI并发更新按来源消息顺序合并。撤回与永久删除植宠同步清理摘要来源；分支过滤祖先被舍弃后缀的跨会话事实。
- 摘要请求失败不删除已保存对话，不宣称记忆已更新；会话压缩最多每轮3批、每批请求6秒，未完成会标记并保留检索入口。轮后自动记忆单独一次最多6秒，当前没有后台重试队列或失败轮次自动补提取。
- Phase 5 生成任务候选；用户确认前没有正式任务。重试同一轮/同一确认不能重复写入。
- `capabilityPolicy.js` 保留任务和知识访问约束。新上下文模式取消强制昵称候选与逐问句记忆召回；只读账号昵称可由模型在确有需要时选择，身份归属仍固定为JWT用户。普通对话不再被旧身份分支提前截走。
- 当前本机验收配置与 2026-09-08 新云候选显式开启 rollout；shadow 仍关闭，旧样例不代表本轮候选。图片、文档和未迁能力保留专用/legacy 链，不假装全部已迁入。
- 用户资料昵称不等于真实身份。记忆管理、修改个人资料和聊天称呼是不同操作。
- 当前是处理中反馈后返回完整回答，不是 token 逐字流式。没有通用 AgentHarness、多 Agent、后台自治、知识图谱或硬件自主控制。

附件草稿与功能标签由 `pages/assistant/assistant.js` 负责：原生选择器的回调单独校验账号、植株、会话和页面存活状态，允许同会话选择器触发 hide/show；网络请求仍检查 epoch，不能放宽为跨会话回填。功能标签与 `inputValue` 分离，仅显示一处，继续用 `context.selectedFunction` 传意图，不代表工具已经执行；创建任务、管理记忆仍使用原有表单入口。

2026-09-07 深夜补充：`components/conversation-composer` 使用微信原生 editor。Delta（编辑文档）里字符串是正文，一枚已注册的 inline image embed 是功能原子；它显示 Lucide 图标和功能名，不是用户附件，也不上传给模型。发送前 flush 同步文档，再投影为正文与白名单 selectedFunction。未知粘贴嵌入被剥离，保留300字限制。会话切换按 key 重建组件，丢弃旧编辑器撤销栈；异步读取后再次核对账号/会话。Enter 换行、箭头发送由用户明确批准。不能设置空 enable-formats：微信会连图片宽高一起删掉，导致功能块撑满整行。新增内联功能要同步目录、静态 token 资产和后端白名单；构建脚本是 `scripts/render-function-tokens.cjs`，无需在小程序运行 Canvas。

记忆正文存于 `ai_context_memory.summary_text`，内部 `facts_json` 仍负责来源与去重。一次轮后推理同时产出事实和可读正文，没有新增每轮第二次请求。`replace_summary` 原样保存用户编辑段落、重新提取对应事实，以 revision 条件更新；关闭/清除/编辑仍递增 policy_version，让旧推理失效。UI 遇到409保留草稿，先展示新版供对照。撤回/来源删除/分支过滤使正文失效时，由剩余事实生成保守正文，不能留下被删信息。相关页面测试在 aiMemory.test.js，文档原子投影测试在 composer-document.test.js；实际系统按键由可选 M7_NATIVE_KEY_TEST 专项单独验证。

文档适配已修：`lib/llmClient.js` 与Vision/runtime一样对DeepSeek短回复显式关闭thinking；`documentHandler` 区分未启用、空正文、输出截断，并明确本轮文档优先于旧图片观察。空花园和有植宠的真实文档发送/重开已经复测。新增两表见 `reference/conversation_context.m7.sql`，已有本地库运行增量迁移脚本；不能使用重建脚本替代迁移。

具体实现选择见 [ADR 0002](./adr/0002-standard-scf-plantpet-runtime.md)、[ADR 0004](./adr/0004-event-backed-session-and-confirmed-proposals.md)。旧阶段报告仅作追溯，默认维护入口就是本文，不必通读历史报告。

## 维护与扩展顺序

| 要扩展什么 | 最小修改范围 | 验证重点 |
|---|---|---|
| 模型或 Provider | modelAdapter、llmClient、visionClient，各专用链分别复测 | 工具协议、结构化返回、错误、上下文与用量；真实模型另测 |
| 新只读工具 | toolRegistry 与 capabilityPolicy，按需增加业务只读 API | 参数白名单、JWT owner、当前会话/植株范围、无副作用 |
| 新写入功能 | 先业务 API 和确认契约，再工具候选与页面 | 用户确认、归属/过期复验、事务、同一请求重试不重复写 |
| 上下文/自动摘要 | conversation-context、agent-store、aiMemory 页面 | 原文保留、分支/撤回、新会话、来源清理、revision/policy_version、故障不丢原话 |
| 知识内容 | 已审核内容导入与发布；页面/RAG 共用来源 | published-only、相关性、来源和图片许可；无命中不伪造 |
| 云配置/依赖/媒体 | cloud-initial 的 overlays、锁文件、迁移和客户端生成器 | 重新构建并本机联测；真实云登录、权限、TLS、对象清理与真机单独验证 |

这次汇报整理没有改动业务代码、Agent 权限或记忆策略。9 月 8 日光标修复已有用户“没问题了”的反馈；早期系统键盘专项失败仍在原证据目录，不代表当前问题仍未修复，也不能推定手机键盘已验收。

## 不能改错的地方

- `dist/scf/*` 是部署源；不能当生成缓存删掉。
- 归属以 JWT 为准，不信客户端 owner。线上正式链是微信换码鉴权；开发版才用 loopback 专用身份。
- 图片保存永久 fileID，不能把微信临时路径当成持久化。当前本地数据库存附件；新云候选通过 COS overlay 存对象，并由事务触发器/清理账本维护生命周期，真实云效果尚未验收。
- 知识只用 published；数据库成功但没查到内容，就返回没查到，不能拿兜底冒充命中。现有 17 种植物、10 篇文章是经用户批准的临时 MVP 内容。
- 四 Tab 共用任务/日记事实。任务重复日期、节气和日计数按 Asia/Shanghai；站内提醒已做，微信关掉后的订阅消息未承诺完成。
- Chat/Vision 所有账号无限次，仍记录用量。旧文档中的 50/10 上限已被用户后续要求覆盖。
- 缓存按账号隔离；清图片缓存不等于删服务器原件。模型/天气凭据不进入客户端或分享包。
- 旧设备动作仍是小程序 → api-scf → OneNET；命令下发不等于设备已执行。不要新增旁路权限。

## 检查与交接

改页面看真实画面；改持久化跑本地 API 与数据库；改文档运行 `npm run check:context`。这个检查只检查结构/编码，不能证明文字描述最新。

全流程脚本的“通过”只覆盖它实际执行的本地环境；不能冒充负责人签字或真机通过。[本地化登记](./localization-compromise-register.md)记录迁云要还的差异，[云候选说明](../deployment/cloud-initial/README.md)明确当前阻断项。旧 M6/Phase 3 报告保留历史，不再描述本轮已迁能力。
## 云端候选适配边界（2026-09-08）

部署路线已确认：SCF + MySQL + COS + SSM，暂不接入 CloudBase。当前处于部署准备阶段。

从当前 dist/scf 白名单打包，不另养一份旧业务源码。cloud-entry 先检查环境、通过临时角色读取 SSM，再载入业务模块；cloud-media 接私有 COS，数据库只存归属、摘要和引用。完整说明见[云候选入口](../deployment/cloud-initial/README.md)。

- 本地/云存储切换只在媒体服务边界；页面、确认任务、会话与摘要共用当前实现。文档在云端从 COS 读取；Vision 保留本轮请求图片字节加持久化 fileID 的现有路径，不冒充服务端取图。
- 新云库迁移包含 ai_session_context、ai_context_memory.summary_text/revision、cloud_media_objects、DOCX MIME 字段扩容和媒体删除触发器。迁移不是数据搬家，不复制本地身份或历史 BLOB。
- api-scf 永久删除植宠会清理消息媒体引用，退役事件/提案正文，并保留幂等标记；PDF 解析对输入做 Uint8Array 规范化，避免首次解析失败。
- 专项入口 test-local-candidate.ps1 使用真实独立 MySQL；外部服务由测试替身隔离。SDK 签名/字节测试也只访问本机，没有云部署或真机结论。
