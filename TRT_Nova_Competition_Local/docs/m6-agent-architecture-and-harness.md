# M6 NOVA Agent 架构与验收 Harness

> 历史/目标文档提示（2026-09-08）：本文保留该阶段的配置、调研或实施记录，不作为当前能力与验收状态清单。旧记忆、额度、rollout 和云端结论如与后续版本不同，以当前入口为准。 当前产品见[先看这里](./先看这里.md)，技术事实见[当前架构](./current-architecture.md)。

> 核对日期：2026-08-29
> 当前结论：NOVA 是受控的单 Agent/LLM 工作流，不是自主 Agent，也没有运行时 Agent harness。  
> 本文范围：当前本地 M6 实现、真实能力边界和可执行验收方法；不把目标架构写成已实现事实，不代表体验版或线上已部署。

## 1. 先统一四个容易混淆的概念

| 概念 | 当前 NOVA 的真实状态 | 含义 |
| --- | --- | --- |
| 产品工作流 | 已实现 | 代码按确定路径校验身份；账号称呼只读昵称并确定性回答，养护主链收集植宠、记忆、知识并记录用量后至多发起一次 Chat 模型调用，再返回回答与只读候选 |
| Agent framework | 未引入 | 没有 LangChain、OpenAI Agents SDK 等模型/工具循环抽象；当前直接调用 OpenAI-compatible API |
| Agent runtime | 未引入 | 没有 durable execution、checkpoint/resume、流式 run、HITL 中断恢复或长任务状态机 |
| 运行时 Agent harness | 未引入 | 没有内建计划、文件系统、shell、子 Agent、自动上下文压缩或模型自主工具集 |
| 评测/验收 harness | 本次形成 | 用真实本地登录/API 和确定性断言复测身份、路由、RAG、记忆与副作用门禁，输出逐场景证据 |

Anthropic 将“固定代码路径编排模型和工具”称为 workflow，将“由模型动态决定过程和工具使用”称为 agent，并建议从足够简单的方案开始；OpenAI 也建议只有当职责、工具或策略确实需要分裂时才增加 specialist；LangChain 则把 runtime、framework 和带计划/子 Agent/文件系统的 harness 明确分层。当前 PRD v0.1 的养护问答、记忆读取和待确认任务具有固定业务边界，因此本轮保持受控工作流，不自行升级为自主、多 Agent 系统。

参考：

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [OpenAI: Orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [LangChain: Runtimes, frameworks, and harnesses](https://docs.langchain.com/oss/python/concepts/products)

本轮又对照了客服型对话平台的官方做法。Dialogflow CX 用置信度阈值区分 intent match 与 no-match，并提醒持续堆叠相近训练表达会产生偏置或过拟合；Microsoft Copilot Studio 的 Fallback topic 允许在固定 topic 无法可靠理解用户时调用生成模型，同时强调不要让两条生成路径重复回答；Rasa 也把高置信 `out_of_scope` 与低置信 fallback 后续路由分开。NOVA 因而采用“角色语气”和“三态职责路由”分离的客服型结构：规则只拥有高置信放行/拒绝，规则不确定时进入无业务权限的生成回退；人设决定怎么说，但模型不能借回退获得 RAG、私有上下文或写权限。

参考：

- [Google Dialogflow CX: Intents and no-match](https://docs.cloud.google.com/dialogflow/cx/docs/concept/intent)
- [Google Dialogflow CX: Agent design best practices](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent-design)
- [Microsoft Copilot Studio: Fallback topic](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/fallback-topic)
- [Microsoft Copilot Studio: Generative orchestration instructions](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-mode-guidance)
- [Microsoft Copilot Studio: Custom knowledge sources](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/custom-knowledge-sources)
- [Rasa: Default actions and out-of-scope routing](https://rasa.com/docs/reference/primitives/default-actions/)

## 2. 当前上层架构

```text
微信小程序页面
  pages/assistant + pages/aiMemory + pages/taskForm
        │
        ▼
客户端领域服务与运行时适配
  AgentService / MediaStorageService / ScfApiAdapter / runtime profile
        │
        ├───────────► api-scf：确认后的任务、诊断、记忆和媒体业务写入
        │
        ▼
agent-scf：单请求、确定性工作流
  JWT 身份 → 无限策略下的用量记账 → 账号称呼短路或会话/植宠上下文 → 三态职责路由
  → 昵称只读确定性回复、简单社交直接回复、高置信域外直接拒绝、规则不确定走无权限语义回退
  → 明确植物主题/子意图 → 记忆或 published-only RAG
  → 确定性回复或至多一次模型调用
  → 确定性错配/来源/任务门禁 → 保存会话与允许的摘要
        │
        ├───────────► MySQL：会话、消息、记忆、业务事实、发布知识、用量
        └───────────► OpenAI-compatible Chat/Vision Provider
```

### 2.1 表现层与交互壳

- `pages/assistant` 只负责会话展示、PlantPet 切换、输入、图片附件草稿、来源与待确认任务入口。当前一次只允许一张待发送图片；图片 Base64 只保留在页面实例中，不进入 `setData`、前端持久存储或结构化记忆。
- 页面是一个固定视口的 flex shell；`message-scroll` 是唯一消息滚动 owner，并延伸到自定义 Tab 栏下方；`input-panel` 是覆盖在消息历史上的透明固定浮层，不再参与 flex 高度分配。
- `message-list` 持有足以越过 composer 和 Tab 栏的末尾滚动安全区；这样中间滚动状态可以看到历史位于浮层下方，滚到底部时最后一条消息仍停在 composer 上方，不会被遮挡。
- 加载占位被长回答替换时，先清空 `scroll-into-view`，再锚定 `message-end`，强制微信按回答的新高度重算滚动位置。
- 图片入口保留在 composer 旁的“+”。选择相机或相册后，页面只做本地读取、实际字节格式校验和缩略图预览，不调用 Vision；用户可以移除附件、继续填写文字，最后由同一个发送动作提交“图片 + 可选配文”。OpenAI ChatKit 和 LangChain Agent Chat UI 也把附件/工具放在 composer，并把消息内容与底部 composer 置于同一个受控聊天壳中。当前实现只借鉴交互结构，不引入它们的框架或视觉系统。
- 消息默认态不显示复制、编辑或撤回控件。只有长按本人用户消息时才创建一次临时菜单；菜单项来自既有 `canCopy/canRewrite/canWithdraw` 能力，不扩大后端权限，并在空白点击、滚动、页面隐藏或执行动作后销毁。`canRewrite` 不再把全部附件机械排除：纯文字和存在本人永久媒体标识的图片/文档消息可恢复到 composer 后创建新分支，无法恢复原件的旧附件消息仍不开放该动作。

参考：

- [OpenAI ChatKit: composer 附件与工具](https://developers.openai.com/api/docs/guides/chatkit-themes)
- [LangChain Agent Chat UI: 单滚动区、stick-to-bottom 与底部 composer](https://github.com/langchain-ai/agent-chat-ui/blob/main/src/components/thread/index.tsx)

### 2.2 客户端服务层

- `AgentService` 负责 Chat、Session、Vision、诊断和记忆的业务级调用；页面不拼接后端 URL。Vision 继续使用现有 `/vision/analyze`，只扩展可选 `message` 字段，使配文和图片进入同一模型请求，不新增通用多模态 Agent 端点。
- `ScfApiAdapter` 负责 JWT、HTTP 和运行时桥接；`runtime profile` 决定本地或未来云端地址。
- 页面请求中的 `options.allowActions=false` 只是调用意图；真正的写入限制必须由后端和业务 API 门禁保证，不能信任前端字段。

### 2.3 身份与 API 边界

- `agent-scf` 与 `api-scf` 从签名 JWT 解析 openid；客户端提交的 owner/openid 不能覆盖身份。
- 账号称呼分支只执行 `SELECT nick_name FROM users WHERE openid = ? LIMIT 1`；不把通用个人资料接口返回的头像、生日、地区、手机号或邮箱交给 Agent，也不允许模型选择查询用户。
- 当前本地 `/auth/login` 因 LC-02 把所有非空微信 code 映射为固定 `LOCAL_DEV_OPENID`；它能验证真实登录页面契约，但不能产生两个真实微信身份。
- 本地跨身份隔离测试只使用 LC-03 的 `/dev/token` 生成第二测试 openid；云端验收必须恢复真实 `code2Session`，并用真实不同账号重新验证。

### 2.4 `agent-scf` 工作流

`POST /agent/chat` 的实际执行顺序如下：

1. 校验消息长度和 JWT 身份；旧硬件 `logicalKey` 路径保持 legacy 兼容。
2. 在全账户无限策略下记录 Chat 当日次数和 token 用量；这一步不阻断合法请求。
3. 先识别高置信账号称呼请求。“我是谁/我叫什么”按 JWT openid 只读 `users.nick_name`；“以后叫我……”只说明去“我的 → 个人资料”显式保存。若请求携带 PlantPet id，只用 `id + openid` 验证会话关联，不读取植宠详情。该分支不加载历史、PlantPet 事实、结构化记忆、RAG 或模型，不修改资料、不写 `ai_memories`，保存原始问答后结束。
4. 非账号称呼请求按 openid、sessionId 和 PlantPet 建立或读取会话与最近 20 轮历史。
5. 加载当前 PlantPet、业务事实与结构化记忆。
6. 执行三态职责路由：明确社交/角色说明、植物定义与养护、记忆治理、养护任务和有效连续追问进入 `in_scope`；明确算式、证明、创作、敏感记忆和非植物任务进入 `out_of_scope`；规则没有足够证据的表达进入 `deferred`。简单问候会先去除尾部中英文问号、感叹号、句号等无语义标点，因此 `你好`、`你好?` 与 `你好？` 属于同一意图。
7. `social` 问候由代码直接返回统一的 NOVA 社交回复，在此处结束；不执行 RAG、Chat 模型、任务候选、养护免责声明或 `ai_summary` 写入。
8. `out_of_scope` 由代码直接说明 NOVA 的职责边界，在此处结束；不执行 RAG、Chat 模型、任务候选或 `ai_summary` 写入。
9. `deferred` 至多发起现有一次 Chat 调用，让模型理解并自然回应；该分支强制使用空历史、空 PlantPet 私有上下文、空 RAG、空任务候选，并且不写 `ai_summary`。
10. 对明确域内请求确定性识别显式植物主题与养护子意图；显式植物优先于当前选中的 PlantPet。
11. 只检索 `published` 的知识文章和植物档案，并保留可读来源。
12. 若用户要求回忆，走结构化记忆分支；若植物主题错配，模型只能获得问题植物知识、当前与本轮植物名称以及自然表述要求，不能获得当前 PlantPet 私有上下文；其余域内情况至多发起一次 Chat 调用。给模型的历史会排除成对保存的 `out_of_scope`、`deferred` 和账号称呼原始问答，避免职责回复、昵称或模糊话题污染后续域内生成。
13. 代码执行错配识别、上下文隔离、来源过滤、任务候选阻断和摘要记忆阻断；现有这一次模型调用只负责自然措辞。若模型不可用，或回答没有同时提到当前与本轮植物，代码才补一条简短兜底说明。这里没有新增第二次 LLM intent/classifier 调用。
14. 所有合法输入都保存原始问答；账号称呼、简单社交、高置信域外、语义回退和植物主题错配不写入当前 PlantPet 的 `ai_summary`。
15. 返回回答、来源、无限状态/用量和待确认任务候选；Agent 本身不调用业务写接口。

这个实现有 routing、retrieval 和 memory，但没有模型自主选择工具、循环观察环境、规划步骤、handoff 或子 Agent。

### 2.5 模型、RAG 与记忆的权责

| 能力 | 模型可做 | 模型不可做 |
| --- | --- | --- |
| Chat | 基于给定上下文生成自然中文 | 改写 JWT 身份、查询任意用户、改变无限策略或用量记录 |
| RAG | 使用后端给出的已发布上下文 | 自己把草稿变成 published、伪造来源 |
| 记忆 | 在给定历史与结构化记忆上回答 | 直接删除、修正或确认记忆 |
| 账号称呼 | 不参与；昵称由代码按 JWT openid 确定性读取和表述 | 看见手机号/邮箱等资料、推断真实身份、修改昵称或声称已记住聊天内称呼 |
| 植物主题 | 对已由后端确认的跨植物错配作自然说明，并回答本轮植物 | 决定是否放行意图、读取当前龟背竹私有记录、把月季任务绑定到龟背竹 |
| 语义回退 | 对规则不确定的表达作一次自然回应或说明职责边界 | 读取 PlantPet 私有上下文、RAG、写摘要或生成任务 |
| 任务 | 参与自然语言说明 | 直接创建、完成、删除或延期任务 |
| Vision | 针对随图配文生成自然的 NOVA 回复，并返回结构化候选、可见迹象和普通建议 | 在用户点击发送前接收图片；自行决定是否保存会话附件、诊断或任务；持久化 Base64、微信临时路径 |

### 2.6 副作用与人工确认

- Chat 路径只产生回答和候选，不拥有业务写权限。
- AI 任务候选必须先通过代码侧明确任务意图门禁，再进入 `pages/taskForm`，由用户修改并确认；`api-scf /care/task-create` 仍要求 `confirmed=true`。模型回答或 Vision `advice` 中出现“浇水、通风、观察”等动作词本身不构成任务意图。
- Vision 选择阶段只形成本地附件草稿；第三方处理告知、私有会话附件上传与模型请求都发生在用户点击发送时。成功分析后，后端在同一事务保存配文、结构化观察和会话媒体引用；Base64 与临时路径永不进入会话表。会话图片与消息共用 20 轮/30 天生命周期，裁剪消息前同步删除。用户主动点击“另存为观察记录”后，客户端才调用诊断写接口；该诊断媒体与会话媒体分开记录，不把本轮配文写成新结构化记忆类型。
- 当前没有模型自主 `tool call`。Chat/Vision 模型只生成文字或结构化分析；确定性代码根据明确任务意图、PlantPet 所有权和（Vision 场景）候选匹配度生成可编辑候选。真正业务写入仍由用户确认后的既有页面与 API 执行。
- 记忆的新增、修正、删除和清空由独立业务 API 执行，并保留用户确认状态与来源。

## 3. 记忆、RAG 与意图识别的具体架构

这三个系统解决的是不同问题，不能互相代替：

- **意图识别**回答“这一轮是否属于 NOVA、应走哪条产品路径”；
- **记忆**回答“这个用户和这盆植宠过去发生过什么、用户确认过什么”；
- **RAG**回答“团队允许用于回答的植物知识是什么、来源在哪里”。

关键顺序是 `意图 -> 记忆/RAG -> 生成`。此前哥德巴赫问题出错，就是因为把这个顺序写成了“未识别意图 -> 默认检索当前植宠 -> 让模型回答”。

### 3.1 记忆系统

#### 两层存储

账号昵称不属于下面两层 AI 记忆。它的唯一事实来源是 `users.nick_name`，由用户在“我的 → 个人资料”维护；身份问句每次重新读取当前 JWT 账号，不把昵称复制到 `ai_memories`。因此更换资料昵称后不会与另一份 AI 身份记忆产生冲突，聊天里单独说“以后叫我……”也不会形成不可见的持久画像。

| 层 | 表与上限 | 用途 | 是否长期事实 |
| --- | --- | --- | --- |
| 会话记忆 | `ai_conversations` / `ai_messages`；每会话最多 40 条消息（20 轮），超过 30 天清理；成功发送图片另有 `media_objects(purpose=conversation_image)` 私有附件 | 让页面恢复文字、会话图片与结构化 Vision 轮次，并给模型最近最多 12 条可用消息作为连续对话上下文；消息裁剪前同步删除其附件 | 否；是有界原始记录 |
| 结构化记忆 | `ai_memories`；按 openid 与 PlantPet 隔离，候选读取最多 80 条 | 保存可治理、带来源的 PlantPet 事实、业务事件与用户确认偏好；旧会话摘要只为历史兼容保留 | 是当前可治理长期上下文，但不等于不可更改事实 |

#### 四种结构化记忆

| 类型 | 产生方式 | 当前例子 | 写入政策 |
| --- | --- | --- | --- |
| `plant_fact` | 从真实 PlantPet 档案派生 | 品种、入室日期、位置、养护备注 | 代码按业务真相同步；用户确认过的同 key 内容不会被派生写覆盖 |
| `business_event` | 从 CareTask 事件、成长日记、已保存图片观察派生 | 某日完成浇水、某日成长记录、某次图片可见迹象 | 只从已落库业务对象派生；仅聊天文字不会伪装成业务事件 |
| `user_preference` | 用户在记忆页明确确认后写入 | “我习惯周六检查月季” | `confirmed=true` 是后端硬门禁，模型不能自行保存 |
| `ai_summary` | 历史实现遗留 | 旧 session 回答摘要 | 已停止新写入和召回；历史副本可见、可删除，但不能被修改后重新确认进入模型上下文 |

#### 读取与治理

1. 所有查询先用 JWT openid 限定账号；有 PlantPet 时只读该植宠和账号级记忆。
2. 候选先排除 `ai_summary`，按用户确认状态、记忆类型、本轮查询词项重合度和更新时间排序，再按规范化内容去重；最多 8 条进入当前 PlantPet 的模型上下文。
3. 记忆回答使用独立确定性分支，来源显示为 `structured_memory`，不把它冒充为模型新发现。
4. 记忆页允许查看来源/时间、逐条删除和按植宠清空；只有 `user_preference + user_confirmed=1` 可以修正。该限制由 `api-scf` 后端强制执行，前端隐藏按钮不能被绕过；档案、任务、日记、诊断等业务事实必须回原业务对象修改。按植宠清空不会删除其他植宠或账号级记忆。

当前没有向量化记忆、相似度检索、重要度/衰减模型、模型自主抽取偏好、跨用户共享记忆或不可见的“人格画像”。账号昵称读取也不把昵称发送给养护回答模型。OpenAI 官方文档区分了无状态模型请求与由应用提供的会话状态；NOVA 当前明确由 MySQL 和后端政策拥有状态，而不是假定模型自己会记住。[OpenAI: Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

当前不引入知识图谱。现有 17 条植物档案与 10 篇审核文章没有需要路径查询的稳定实体关系，用户主问题仍是“当前植宠 + 症状/养护 + 已发布来源”的短查询。此时上知识图谱会先增加实体消歧、关系抽取、版本一致性和运营维护负担，却没有可验证的检索收益。只有当产品出现稳定 ID 的“植株—症状—原因—任务—来源”跨对象关系查询，或语料/评测显示词法检索无法满足关系推理时，才重新立项。

### 3.2 RAG 系统

#### 数据面

- 主存是 MySQL `knowledge_articles` 和 `plant_library`；JSON 只在数据库请求失败时作 seed/fallback。
- 数据库成功返回空集时保持空集，不因为“看起来没有答案”而偷偷换用 JSON。
- 只有 `status=published` 的植物档案和文章可以进入 M6 RAG；每条结果保留标题、发布机构、来源 URL/ID、内容更新时间和审核信息。

#### 检索面

1. 意图门禁先判断请求是否属于植宠养护；域外请求完全不启动检索。
2. `findMentionedPlantProfiles` 识别本轮显式植物；若用户说“月季”，检索主题就是月季，而不是当前选中的龟背竹。
3. 当前检索是轻量词法/字段评分：标题、摘要、别名、标签、适用植物、问题类型和正文分别计分，再按分数与稳定排序取前几条。
4. 植物档案与文章结果合并为 `contextText`，连同来源交给模型；页面只展示后端返回的可读来源。
5. 明确的知识问题没有命中时走“不确定/不知道”回复；其他域内养护分支仍可能基于 PlantPet 业务上下文调用模型，这是当前需要继续用固定评测集监控的边界。

当前没有 embedding、向量库、语义召回、reranker、query expansion、跨库并行检索或模型自主选择数据源。OpenAI Retrieval 文档中的语义检索会通过 embeddings/vector store 找到缺少共同关键词但语义相近的内容；NOVA 目前没有实现这一层，因此不能把现有 RAG 描述为向量 RAG。[OpenAI: Retrieval and semantic search](https://developers.openai.com/api/docs/guides/retrieval)

### 3.3 意图识别系统

当前是“高置信确定性路由 + 无权限语义回退”，不是让大模型给自己分配工具或业务权限：

```text
用户文本
  → 账号称呼：确定性资料读取或显式保存引导
  → 其余职责域：in_scope / out_of_scope / deferred
  → 实体主题：显式植物 / 当前 PlantPet / 知识页上下文
  → 养护子意图：chat / knowledge / watering / trend / status / control / general
  → 路由策略：职责回复 / 无权限语义回退 / 记忆 / RAG / 植物错配 / Chat / 任务候选
  → 确定性副作用门禁
```

#### 第一层：职责域门禁

`intentRouter.js` 使用可测试的证据组合，不再把任一单独关键词直接视为完整意图：

- 植物锚点：已发布植物名称/学名/别名、植物部位、“这盆/这株”等指代；
- 领域意图：养护动作、病虫/生长状态、植物知识、识别/记录等产品动作；
- 一般植物定义（如“月季是什么”“介绍一下月季”）属于明确植物知识，可进入 published-only RAG；只出现“月季/玫瑰”而没有可确定问题时进入 `deferred`，不会自动读取当前 PlantPet 或 RAG；
- “我是谁/我叫什么”属于账号称呼查询，进入确定性资料分支；“我叫/以后叫我/请记住我叫……”属于称呼偏好请求，只引导用户显式维护个人资料，不进入通用记忆或 `deferred`；
- 通用“记住/之前”必须同时具备植物或养护语境；“查看/删除 AI 记忆”作为产品治理入口单独保留；
- 通用“观察任务”只能在明确植物语境，或当前 PlantPet 下的短规范表达中放行；浇水、施肥、修剪、换盆等明确养护任务继续保留；
- 角色说明、问候和简短社交；
- 有当前 PlantPet 时的“这盆怎么样”“土干了”“多久浇一次”等省略表达；
- 上一轮已确认域内时，只允许“那多久一次”“我刚才考虑浇的是什么”等短指代追问继承语境，不能让“为什么哥德巴赫……”借上一轮放行；
- 从知识页进入时对“这篇/这段”的解释请求。

问候识别前先统一去除尾部中英文标点，而不是分别维护“有问号”和“无问号”的正则分支；识别为 `social` 后直接返回固定语义的 NOVA 回复。另有一小组高置信冲突信号拦截明确算式、证明、纯创作、编程、敏感记忆和非植物任务，但它不试图穷举开放语言。规则无法确定时进入 `deferred`：允许现有 Chat 模型作一次自然语义回应，但不给历史、PlantPet 私有上下文、RAG、任务候选或摘要写入。“月季是什么”进入正式植物知识链；“我是谁”读取当前账号昵称并明确它不等于真实身份；“为什么天空是蓝的”由 NOVA 自然说明职责；哥德巴赫与 `1+2 是多少个月季/玫瑰` 仍断言无知识来源、无模型来源、无任务候选、无 `ai_summary`、无当前植物资料。

当前 `intent-router-corpus.test.js` 固化了 158 条黄金/对抗样本，覆盖社交、能力说明、账号身份查询、称呼偏好、一般植物定义、真实养护、省略指代、记忆、任务、跨轮追问、三态历史继承、植物词碰瓷、植物名与公司/电影/乐队/算法等冲突主体、算术、创作、编程和敏感记忆请求。它同时测 false accept、false reject 和应当 `deferred` 的开放表达；真实冒烟曾据此抓出“给这篇文章浇水”误放行、“给月季浇牛奶”误拒绝、“月季是什么”误拒绝和“我是谁”被机械拒答等问题。

#### 第二层：植物主题与子意图

- 植物主题使用已发布植物档案的名称、学名和别名识别；本轮显式植物优先。
- 子意图仍由轻量规则识别浇水、知识、趋势、状态、通风/控制、记忆等产品路径。
- 当前 PlantPet 和本轮植物不一致时，确定性错配门禁优先于任务生成；模型只能自然表述该决定，不能改变上下文、来源、任务或记忆边界。

#### 人设与意图的边界

NOVA 的“温和、耐心、诚实、有陪伴感”属于生成和文案层。它不能把域外问题变成域内，也不能给模型增加工具或写权限。高置信域外结论仍由路由代码拥有；规则不确定时，模型只获得一次“如何自然回应”的机会，权限仍由代码限定。个人身份互动由确定性文案拥有：资料存在时只称为账号昵称，资料缺失时邀请用户去个人资料设置；都必须提示不要提交手机号、证件号或账号密码。聊天内的称呼请求不能声称已长期保存。

当前没有训练式 NLU、embedding intent classifier、单独的 LLM classifier、置信度阈值或自动从线上语料扩充意图。本轮建立了 158 条中文黄金/对抗语料，并把规则从二态白名单改为三态级联，另把账号称呼收敛为确定性资料分支；没有给每条消息增加第二次分类调用，`deferred` 直接复用原本至多一次的回答模型，且不带业务上下文或副作用。固定语料可以做到 158/158，但开放语言不存在可诚实承诺的“百分百准确”；后续应记录真实 false accept、false reject 和 defer rate，再决定是否引入统计分类器，而不是继续围绕单个漏判无限扩大正则。

### 3.4 三者如何协作

| 输入 | 意图层 | 记忆 | RAG | 结果 |
| --- | --- | --- | --- | --- |
| “你好” / “你好?” / “你好？” | 域内/社交 | 只保留原始问答，不写摘要 | 不启动 | 相同的轻量 NOVA 问候 |
| “我是谁？” | 域内/账号称呼 | 只读 `users.nick_name`，不读写结构化记忆 | 不启动 | 返回当前账号昵称；没有昵称时引导去个人资料设置，并提示隐私 |
| “以后叫我小芽” | 域内/称呼偏好 | 不读写结构化记忆，也不修改账号资料 | 不启动 | 说明聊天不会自动持久化，引导去个人资料显式保存 |
| “你记得这盆植物什么？” | 域内/记忆 | 读取当前植宠结构化记忆 | 不必检索 | 带来源回顾 |
| “月季是什么？” | 域内/植物定义 + 月季实体 | 仅在匹配当前植宠时按既有政策写摘要 | 检索月季 published 资料 | 直接介绍月季；错配时隔离当前植宠 |
| “月季怎么浇水？” | 域内/浇水 + 月季实体 | 可带当前会话上下文 | 检索月季 published 资料 | 自然回答 + 可读来源 |
| 当前龟背竹，问“月季怎么浇水并安排任务” | 域内/跨植物错配 | 不写龟背竹摘要 | 只检索月季 | 说明错配，阻断任务 |
| 当前龟背竹，问“1+2 是多少个月季” | 域外/植物词仅为偶然成分 | 不写摘要 | 不启动 | 不拼接跨植物模板，明确职责边界 |
| “帮我记住密码” / “给服务器安排观察任务” | 域外/缺少植宠语境 | 不写记忆或摘要 | 不启动 | 说明植宠记忆/任务边界 |
| “证明哥德巴赫猜想” | 域外 | 只保留原始会话，不写摘要 | 不启动 | 明确职责边界 |
| “为什么天空是蓝的？” | `deferred`/规则不确定 | 不写摘要 | 不启动 | 模型仅按 NOVA 人设自然说明职责，不解答域外知识 |

## 4. 当前没有实现的 Agent 能力

以下项目不是“隐藏在代码里但未测试”，而是当前没有实现：

- 模型自主工具循环和动态工具选择；
- 多 Agent、manager/specialist、handoff 或子 Agent；
- plan/todo、自主拆解和后台持续执行；
- streaming token、tool lifecycle event 和 run trace；
- durable run、checkpoint、失败恢复和跨进程 HITL；
- Agent 直接操作设备、任务、档案、日记、数据库或文件系统；
- LLM-as-judge、线上 trace grading 或大规模黄金集平台。

引入这些能力会改变延迟、成本、权限、审批面、故障恢复和验收方法，属于必须先向用户披露并确认的上层架构变更。仅当出现不可预先写死的多步任务、跨请求中断恢复、不同 specialist 的独立工具/策略，或现有单调用工作流在固定评测集上被证明不足时再评审。

## 5. 评测/验收 Harness

### 5.1 可执行入口

```powershell
npm run agent-harness-m6
npm run devtools-m6-layout-e2e
npm run local-m6-smoke
npm run devtools-m6-e2e
```

- `agent-harness-m6`：工作流架构合同；真实本地 HTTP，生成逐场景 JSON 报告，不调用 Vision。
- `devtools-m6-layout-e2e`：微信开发者工具固定长回答布局回归，不调用 Chat/Vision 模型。
- `local-m6-smoke`：真实 Chat/Vision provider、会话、RAG、记忆、诊断和任务确认的集成冒烟。
- `devtools-m6-e2e`：从小程序页面验证真实用户路径；当前还实际点击两级附件/功能菜单，并真实长按本人消息执行复制、纯文字重新编辑、已保存图片重新编辑和最后一轮撤回。附件重新编辑额外断言原图/原文字回填、生成新分支和原会话保留。

OpenAI 的 eval 指南建议调试阶段先看端到端 trace，再把已知“好结果”沉淀为可重复的数据集与 eval run。当前系统没有 tool/handoff trace，所以本地 harness 记录的是 API 场景、确定性门禁和业务结果；不把它声称为完整 Agent trace grading。

参考：[OpenAI: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)

### 5.2 `agent-harness-m6` 场景合同

| 场景 | 验证层 | 通过条件 |
| --- | --- | --- |
| AUTH-01 | 身份 | `/auth/login` 得到 JWT；无 token 的 Agent 会话为 401 |
| AUTH-02 | 身份隔离 | LC-03 第二测试身份读取第一身份 PlantPet 会话为 404 |
| INTENT-01 | 职责域 | 哥德巴赫请求在 RAG/模型前停止；无来源、任务和摘要记忆，明确说明 NOVA 职责 |
| SOCIAL-01 | 社交意图 | `你好` 与 `你好?` 回复一致；不启动 RAG/模型、不写摘要、不继承域外历史；后续裸“为什么？”进入无权限语义回退，不获得植物话题锚点 |
| INTENT-02 | 意图对抗 | `1+2 是多少个月季/玫瑰`、`帮我记住密码`、`给服务器安排观察任务` 均在 RAG/模型前停止；无来源、任务和摘要记忆 |
| INTENT-03 | 资料身份与三态路由 | “月季是什么”进入 published 植物知识回答；“我是谁”只读当前账号昵称且不调用模型/RAG；“以后叫我……”不静默修改资料，不生成任务或摘要记忆；验收后恢复原资料 |
| MEMORY-01 | 记忆 | 用户确认偏好可跨会话召回，并返回 `structured_memory` 来源 |
| RAG-01 | 检索与人设 | 月季回答具有可读 published 来源，且不暴露内部治理术语 |
| ROUTE-01 | 编排 | 当前龟背竹、本轮月季时触发错配；只保留月季来源，不生成任务、不写龟背竹摘要 |
| ACTION-01 | 副作用 | 只返回 `source=ai` 候选；缺少 `confirmed=true` 的任务写入被拒绝；没有 toolCalls/handoffs |

本次 M6 终局身份与路由报告写到：

`D:\植宠项目\验收记录\M6_2026-08-29\m6-final\m6-agent-workflow-harness.json`

报告不包含源码哈希、部署 manifest、密钥正文或模型隐式推理；它只是当前工作流合同的可读验收证据。

## 6. 这次架构调整的物料边界

### 保留

- 现有单 Agent 工作流、SCF 部署单元、MySQL 数据模型、RAG、记忆、Vision 和人工确认门禁；
- 现有四 Tab、NOVA 视觉语言、输入框“+”、Enter/Shift+Enter 行为；
- 现有 `m6-smoke` 和 `m6-devtools-e2e`。

### 新增

- 一条只用于本地验收的 `agent-harness-m6` 场景 runner 和 JSON 证据；
- 一条不调用模型的长回答开发者工具布局回归；
- 一层在 RAG/模型之前运行的客服型职责域门禁及 `INTENT-01` 负例合同；
- 账号称呼只读分支、最小字段查询，以及真实 API harness 的 `INTENT-03` 资料恢复合同；
- 158 条意图黄金/对抗语料，以及真实 API harness 的 `INTENT-02`/`INTENT-03` 合同；
- 本文的上层架构、能力边界和采用门槛说明。
- 同一 PlantPet 多会话、前缀复制式编辑分支和最后一轮撤回；它们是确定性会话 API，不是运行时 Agent checkpoint。
- 本轮文档解析器、`conversation_document` 媒体用途和 `mammoth`/`pdf-parse` 依赖；文档只进入当前轮次，不授予模型文件系统或知识库写权限。
- 选择功能白名单和 composer chip；它是前端 launcher/请求标记，不是动态 tool calling。
- 用户确认偏好、业务来源事实和旧摘要的记忆分区，以及 published-only 的字段加权/段落级轻量检索。

### 修复

- 把消息内边距从 `scroll-view` 外壳移到内部 `message-list`，移除不可滚动死区；
- 增加 `message-end`，并在相同消息 id 从加载态变成长回答时强制重置滚动锚点。
- 合并顶部重复状态卡，把三个快捷问句和 composer 压缩并贴近自定义 Tab 栏，移除输入区外层纯色托底；
- 高置信域外问题不再默认检索当前 PlantPet，也不进入 Chat 模型、任务或摘要记忆分支；规则不确定的问题进入无权限语义回退，不再被机械拒答。
- 植物实体不再单独构成 RAG 放行条件；一般植物定义作为明确知识意图恢复放行，模糊植物词进入 `deferred`；养护、知识、状态、记忆、任务与连续追问继续使用植物锚点和语义证据组合。
- 个人身份问句从无权限模型语义回退改为确定性账号资料读取；只读当前 JWT 账号的 `nick_name`，不读取其他个人资料、PlantPet 私有内容、RAG 或结构化记忆。聊天内称呼请求只给出显式保存路径，不承诺或执行持久化。
- 跨植物错配不再由代码无条件拼接两段固定文案；现有同一次模型调用自然表述差异，代码保留数据隔离与单句兜底。
- 简单问候先归一化尾部标点，再走确定性社交回复；域外原始问答保留在会话中，但不会进入后续模型生成上下文。
- `input-panel` 从参与 flex 高度分配的透明矩形区域改为覆盖在消息历史上的固定浮层；消息区延伸到其下方，末尾安全区负责把最后一条消息滚到浮层上方。
- 用户消息内常驻“重新编写 / 撤回本轮”实体按钮和随后常驻的纯图标操作栏均已移除；最终按三组手机 AI 产品真实默认态/长按态，改为默认隐藏、长按本人消息后临时显示图标加文字菜单。编辑状态仍缩为 composer 单行 chip。
- Chat/Vision 改为比赛阶段全账户无限；保留 `ai_usage_daily` 次数与 token 观测，不再读取 50/10 限额配置或返回额度耗尽拒绝。
- 结构化记忆上下文增加旧摘要排除、相关性排序、内容去重和最多 8 条上限；偏好修改权限从前端展示约定提升为后端硬门禁。

### 没有扩大的 Agent 权限

- 没有新增云服务、数据库表或部署单元；新增文档解析依赖和窄用途会话/文档 API 已在上文披露；
- 没有删除图片、任务、诊断、知识、记忆或会话业务数据；常驻快捷入口被重组到“选择功能”，消息操作只更换为临时长按触发层；
- 没有引入自主工具、子 Agent、handoff、后台任务或任何资料写权限；新增且仅新增当前 JWT 账号 `users.nick_name` 的只读能力，并已由用户明确批准；
- 没有新增妥协类型；会话文档扩大了已登记 LC-05 的本地媒体用途，云迁移要求已同步更新。

## 7. 当前会话、记忆和 RAG 的准确上层边界

- **会话**：消息历史只服务当前会话；多会话按 PlantPet 分组。编辑采用复制目标消息之前前缀到新会话的分支方式，原路径保留；撤回只允许当前会话最后一轮。
- **记忆**：用户确认偏好是可编辑长期记忆；档案/任务/日记/诊断是带来源的业务事实副本；旧 `ai_summary` 停止新写入和召回。没有自动从每轮对话抽取长期记忆。
- **RAG**：仅从当前 MySQL 已发布知识检索，数据库故障才使用同样 published-only 的 JSON fallback；当前小语料采用确定性字段加权、中文词片与段落选择，不使用向量库或全历史聊天 embedding。
- **升级门槛**：只有当带标签回归集证明出现大量“语义相关但无词项重合”的稳定漏召回，语料增长到数百/数千份异构文档，或业务出现必须沿稳定关系路径查询的问题时，才分别评审 embedding/向量检索或知识图谱；不能只因同类产品使用而引入。
- **意图/功能**：三态职责路由继续决定是否允许 PlantPet/RAG/模型上下文；“选择功能”只给三项只读请求增加白名单上下文，创建任务/管理记忆直接进入既有确认页面。模型既看不到可循环调用的工具清单，也不能执行副作用。
- **文档**：本地后端从用户显式上传的单个文档提取有界文本，并把文档标为不可信参考资料；不执行宏、链接、脚本或附件内指令，不写知识库和长期记忆。
- **Harness**：单元/集成、真实 HTTP smoke 和微信开发者工具 E2E 是评测/验收工具，不参与产品请求运行时，也不赋予 Agent 新能力。
