# TRT Nova 植宠产品级技术架构目标

> 文档定位：目标技术架构、代码框架、平台能力、工程规范与产品级验收基线  
> 文档状态：v1.1 / Approved Technical Baseline  
> 基线日期：2026-07-18  
> 最近审阅：2026-07-19  
> 上位文档：[植宠软件系统架构蓝图](./plant-pet-software-system-blueprint.md)  
> 技术栈定版：[植宠产品技术栈定版](./plant-pet-technical-architecture-brief.md)  
> 实施顺序：[植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)  
> 现状文档：[当前系统现状与改进路线](./current-system-status-and-improvement-plan.md)

---

## 0. 文档目的与使用边界

《植宠软件系统架构蓝图》定义产品长期需要具备哪些领域和价值闭环；本文定义如何用可实施、可维护、可验证的技术体系建设这些能力。

快速查阅：模块职责见第 4 节，代码框架见第 5 节，数据分工见第 6 节，已确认技术栈与部署门槛见第 13 节，验收见第 14 节；具体研发顺序统一查阅《植宠系统实施顺序与演进路线》。

本文用于锚定：

1. 目标技术架构和运行时模块；
2. 代码仓库、应用框架和依赖边界；
3. 数据、API、事件、IoT、AI、实时互动和社区技术规范；
4. 已确认技术栈及采用边界；
5. 安全、可靠性、可观测性和研发流程；
6. 产品级系统的验收标准；
7. 从当前 Demo 演进到目标架构的技术阶段。

本文描述的是目标能力，不表示所有模块需要立刻独立部署。逻辑模块、代码模块和部署单元是三个不同概念：

- 逻辑模块：长期职责边界；
- 代码模块：在仓库中的依赖与所有权边界；
- 部署单元：可独立发布、扩缩容和隔离故障的进程或服务。

早期多个逻辑模块可以位于同一个部署单元，但不能因此放弃代码边界和数据所有权。

---

## 1. 技术目标与容量基线

### 1.1 核心质量属性

目标系统按以下优先级设计：

1. 安全与事实正确性；
2. 设备链路可靠性和数据可追溯性；
3. 核心养护功能可用性；
4. 互动响应速度和多端连续性；
5. 可维护、可测试和可发布；
6. 水平扩展和成本效率；
7. 社区内容质量和治理能力。

### 1.2 规划容量分级

以下数字是架构规划基线，不是业务预测。正式立项时应根据硬件上报频率、语音时长和真实增长重新计算。

| 等级 | 使用阶段 | 注册设备 | 在线设备 | 遥测峰值 | 并发互动会话 | 目标 |
|---|---|---:|---:|---:|---:|---|
| S0 | 内测/试用 | 1,000 | 500 | 100 msg/s | 20 | 验证完整闭环 |
| S1 | 商业化 V1 | 50,000 | 20,000 | 2,000 msg/s | 300 | 单地域稳定产品 |
| S2 | 增长阶段 | 500,000 | 200,000 | 20,000 msg/s | 3,000 | 多可用区、服务拆分 |
| S3 | 生态阶段 | 5,000,000+ | 按地域计算 | 按模型计算 | 按地域计算 | 多地域与灾备 |

本文统一使用两套互不替代的标记：`T0—T3` 表示研发与产品阶段，`S0—S3` 表示容量等级。同一 T 阶段可以经历容量增长，但部署升级以实际 S 指标和第 13.1 节门槛为准，不因阶段名称自动采购基础设施。

容量评估必须使用公式而不是只看设备总数：

- 遥测平均吞吐 = 在线设备数 × 每设备每秒平均消息数；
- 峰值吞吐至少按平均值的 5 倍评估；
- 原始历史日增量 = 消息数 × 单消息存储字节数 × 副本/索引系数；
- 语音成本 = 会话次数 × 平均时长 × ASR/TTS/模型单价；
- 社区媒体成本 = 上传量 × 存储周期 + CDN 下行量 + 处理次数。

### 1.3 产品级 SLO

| 能力 | S1 目标 |
|---|---|
| 核心 API 月度可用性 | 不低于 99.9% |
| 登录与鉴权 P95 | 小于 800ms，不含微信外部耗时 |
| latest 查询 P95 | 小于 500ms，端到端目标小于 1s |
| 遥测接收到可查询 P95 | 小于 10s |
| 遥测接入成功率 | 不低于 99.95%，失败可重放 |
| 控制命令派发 P95 | 小于 3s |
| 控制结果 | 派发、平台确认、设备确认分别统计 |
| 硬件语音首包 | 目标小于 1.5s，复杂回答支持流式 |
| 会话降级 | 模型不可用时 5s 内返回安全回退 |
| 核心数据 RPO | 不高于 5 分钟 |
| 核心服务 RTO | 不高于 60 分钟 |
| 高风险安全事件 | 立即告警并进入人工响应 |

SLO 必须配套 SLI、告警阈值和错误预算，不能只写在文档中。

---

## 2. 目标技术架构

### 2.1 逻辑架构

~~~mermaid
flowchart TB
    subgraph Clients[客户端与硬件]
      MINI[微信小程序]
      MOBILE[Flutter App]
      DEVICE[植宠硬件]
      ADMIN[运营/客服后台]
    end

    subgraph Edge[边缘与统一接入]
      CDN[CDN/媒体加速]
      WAF[WAF/防护/限流]
      APIGW[API Gateway]
      REALTIME[WSS WebSocket/实时会话网关]
      IOTGW[IoT Provider / MQTT]
    end

    subgraph ProductServices[产品领域服务]
      IAM[身份与权限]
      CORE[用户/植宠/空间]
      TWIN[设备注册与数字孪生]
      CARE[养护规则/任务/时间线]
      ACTION[动作与自动化]
      NOTICE[通知]
      COMMUNITY[社区/关系/治理]
      OPS[运营后台 API]
    end

    subgraph Intelligence[智能服务]
      AGENT[Agent 编排]
      COMPANION[人格/情绪/关系]
      MEMORY[记忆]
      KNOWLEDGE[知识检索]
      SAFETY[AI/内容安全]
      MODEL[模型/ASR/TTS 路由]
    end

    subgraph IoTServices[IoT 数据面]
      INGEST[接入/验证/归一化]
      STREAM[遥测事件流]
      COMMAND[命令适配/回执]
      JOBS[聚合/离线/清理任务]
    end

    subgraph Data[数据层]
      DB[(关系数据库)]
      REDIS[(Redis)]
      MQ[(消息队列)]
      TS[(时序/聚合数据)]
      OBJECT[(对象存储)]
      SEARCH[(搜索/向量索引)]
      WAREHOUSE[(分析仓库)]
    end

    subgraph Platform[平台层]
      OBS[OpenTelemetry/日志/指标/追踪]
      SECRETS[密钥/KMS]
      CONFIG[配置/功能开关]
      CICD[CI/CD/IaC]
    end

    Clients --> Edge
    Edge --> ProductServices
    Edge --> Intelligence
    IOTGW --> IoTServices
    ProductServices <--> Intelligence
    ProductServices <--> IoTServices
    ProductServices <--> Data
    Intelligence <--> Data
    IoTServices <--> Data
    Platform -.保障.-> ProductServices
    Platform -.保障.-> Intelligence
    Platform -.保障.-> IoTServices
~~~

### 2.2 数据面与控制面

必须把高频设备数据面和低频业务控制面分开：

**设备数据面**

- 设备遥测接入；
- 验签、解密、Schema 校验和归一化；
- latest、时序、事件流和数据质量；
- 高吞吐、可重放、允许最终一致。

**业务控制面**

- 用户、绑定、植宠、权限和配置；
- 任务、日记、社区、内容和运营；
- 动作审批、自动化策略和审计；
- 低吞吐但要求事务一致性。

两者通过稳定设备 ID、领域事件和数字孪生连接，不能让 webhook 直接修改用户关系，也不能让业务 API 承担高频遥测写入。

### 2.3 同步与异步边界

同步调用适用于：

- 用户正在等待的查询和确认；
- 权限检查；
- 创建动作请求；
- 获取当前设备影子；
- 开始实时互动会话。

异步事件适用于：

- 遥测处理；
- 风险评估和通知；
- 时间线、统计、搜索索引；
- 媒体处理；
- Agent 会话摘要和长期记忆提取；
- 社区审核和 Feed 构建；
- 命令回执和效果验证。

跨服务事务默认使用本地事务 + Outbox + 幂等消费者，不采用分布式两阶段提交。

### 2.4 从成熟开源架构吸收的模式

目标架构参考成熟项目的已验证模式，但不默认引入其完整平台：

- **Eclipse Ditto**：吸收 Gateway、Connectivity、Thing/Twin、Policy 和派生 Search 的职责分离；数字孪生需要 revision、策略绑定、变更事件和可重建搜索索引；
- **ThingsBoard**：吸收协议 Transport 独立扩缩、统一消息进入队列、设备级顺序处理、租户/设备配额和单体到微服务平滑演进；
- **Temporal**：吸收长流程状态必须持久化、失败后从确定位置恢复、外部副作用幂等的思想；达到采用阈值后再引入其运行时；
- **OpenFeature**：功能开关通过厂商无关接口使用，避免业务代码绑定具体开关平台；
- **Open Policy Agent 类策略引擎**：吸收“策略决策点与执行点分离”，但简单 RBAC 阶段仍优先使用应用内强类型策略；
- **LangGraph 类 Agent Runtime**：吸收 checkpoint、durable execution 和 human-in-the-loop；框架不能成为业务权限、设备动作或长期记忆的权威所有者；
- **Pact/Testcontainers**：吸收消费者驱动契约和真实依赖集成测试，减少只靠脆弱全链路测试发现兼容问题。

选型原则是“先采用模式，再评估产品”。任何新增基础设施仍需通过第 12.3 节 ADR 和 PoC。

---

## 3. 推荐部署单元与拆分策略

### 3.1 S0/S1 推荐部署单元

下表是**逻辑上允许独立扩缩的候选部署单元**，不是 S0 必须一次性创建七个服务。部署数量应服从真实负载和团队边界：

| 部署单元 | 包含逻辑模块 | 扩缩容特征 |
|---|---|---|
| edge-api | API/BFF、鉴权接入、限流 | HTTP 请求量 |
| core-service | 用户、植宠、设备注册、任务、日记、知识、社区基础 | 业务请求量 |
| ingest-service | OneNET/EMQX webhook、归一化、latest 写入 | 遥测吞吐 |
| worker-service | 聚合、通知、离线判断、媒体、Outbox 消费 | 队列积压 |
| interaction-service | 实时会话、Agent、人格、记忆编排 | 并发会话 |
| command-service | 动作审批、命令下发和回执 | 控制请求量 |
| admin-web/admin-api | 运营、客服、内容与治理 | 内部用户量 |

S0 延续现有 `auth-scf`、`api-scf`、`ingest-scf`、`agent-scf` 和定时清理任务即可，原则上不再增加常驻基础设施；新领域能力先并入模块化 `api/core`。S1 通常控制在 3 至 5 个主要运行单元，优先只把资源模型差异最大的 ingest 和 interaction 拆出。只有触发第 3.2 节条件后，才逐步形成上表的 5 至 7 个单元。

逻辑模块在代码中保持独立，但 core-service 可以是模块化单体。这样既能清晰协作，也能避免过早微服务化。部署单元少不等于代码可以继续无边界增长。

S0/S1 的长流程先由数据库状态机 + 持久化队列 + worker 实现。只有达到第 6.5 节的触发条件，才增加独立 workflow-service 或 Temporal 集群。

### 3.2 拆分触发条件

只有满足下列至少一项才拆出独立服务：

- 需要独立扩缩容，资源模型明显不同；
- 故障必须隔离；
- 发布节奏和负责人长期独立；
- 数据安全等级不同；
- 单部署单元已造成明显构建、测试或发布冲突；
- 压测或线上指标证明现状无法达标。

禁止仅因为“模块很多”或“微服务更先进”而拆分。

### 3.3 S2 以后候选拆分

- identity-service；
- plantpet-service；
- device-registry-service；
- digital-twin-service；
- telemetry-ingest-service；
- care-assessment-service；
- action-command-service；
- interaction-agent-service；
- companion-memory-service；
- knowledge-service；
- community-service；
- moderation-service；
- notification-service；
- media-service；
- analytics-pipeline。

---

## 4. 运行时模块技术规格

### 4.1 API Gateway 与 BFF

**职责**

- TLS、域名、WAF、CORS 和请求大小限制；
- Token 初步校验、限流、黑名单和路由；
- 小程序/App/后台的轻量响应聚合；
- requestId、traceId 和客户端版本注入。

**禁止**

- 在网关实现复杂领域逻辑；
- 持有设备平台管理密钥；
- 用 BFF 跨过领域服务直接写数据库。

**验收**

- 未认证请求、越权请求和超限请求有统一错误；
- P95 网关自身开销小于 50ms；
- 可按用户、IP、设备、接口和动作类型限流；
- 所有请求可关联到后端 trace。

### 4.2 身份与权限模块

**职责**

- 微信、手机号和其他身份提供方接入；
- Access Token、Refresh Token、撤销和设备会话；
- household、membership、resource ACL；
- 管理员、客服、审核员 RBAC；
- 隐私同意、注销和数据导出。

**技术要求**

- OIDC/OAuth2 思维模型，内部 Token 使用非对称签名优先；
- 资源授权在服务端执行；
- 高风险动作支持 step-up 或二次确认；
- 管理端强制 MFA；
- 权限策略具有自动化测试矩阵。

**验收**

- 伪造 openid/userId 不能访问资源；
- owner、caregiver、viewer 权限差异可重复验证；
- Token 轮换、过期、撤销和密钥轮换通过测试；
- 注销后数据处理符合策略。

### 4.3 用户、植宠与关系模块

**职责**

- User、PlantPet、PlantProfile、CareSpace；
- 植宠与设备的时态关联；
- RelationshipBond、成长、里程碑；
- 多端统一植宠身份。

**技术要求**

- PlantPet 使用稳定 UUID/ULID；
- 设备关联包含 valid_from、valid_to；
- 删除采用业务状态 + 审计，不直接物理抹除关联历史；
- 关系成长由事件驱动，规则版本化；
- 健康值与羁绊值分开。

**验收**

- 植宠换设备后日记、关系和记忆连续；
- 设备换植物后遥测归属边界明确；
- 多用户共同养护权限正确；
- 同一植宠跨端 ID、人格版本和成长一致。

### 4.4 设备注册与数字孪生模块

**职责**

- 设备型号、序列号、能力、固件和生命周期；
- 注册、激活、绑定码和所有权转移；
- reported、desired、pending、connectivity、quality；
- 固件兼容和远程诊断元数据。

**技术要求**

- 设备身份与 IoT Provider 身份解耦；
- 设备能力使用版本化 capability schema；
- latest 更新使用字段级采样时间，避免旧消息覆盖新值；
- desired 与 reported 分库存储语义或明确字段；
- 离线状态由后端持续计算，不依赖客户端轮询。
- 每个 Twin 带单调递增 revision，写入使用乐观并发控制；
- Twin 按 feature/capability 分区表达，避免一个无限增长的 params JSON；
- Twin 变更发布版本化事件，搜索和列表是可重建的派生读模型；
- 同一设备的状态变更按 device_id 分区并串行应用，避免并发覆盖；
- 每设备、每家庭/租户配置遥测、连接、命令和订阅配额，防止噪声设备拖垮系统。

**验收**

- 重复上报幂等；
- 乱序上报不回退最新状态；
- 携带旧 revision 的并发写入被拒绝或显式合并；
- 设备离线、重连和固件变化有事件；
- desired 不会被展示成 reported；
- 单设备诊断能追踪最近消息、命令和错误。

### 4.5 遥测接入模块

**职责**

- OneNET、EMQX 和未来 Provider 适配；
- webhook 验签、解密、防重放；
- 原始消息落点、Schema 校验、字段映射和单位归一；
- latest 写入、时序写入、事件发布和死信。

**处理流水线**

~~~mermaid
flowchart LR
    A[Provider 消息] --> B[验签/解密/防重放]
    B --> C[保存接收元数据]
    C --> D[协议识别与 Schema 校验]
    D --> E[字段/单位/时间归一]
    E --> F[幂等与乱序处理]
    F --> G[更新数字孪生]
    F --> H[写入时序]
    F --> I[发布 TelemetryReceived]
    D --> J[死信/隔离区]
~~~

**技术要求**

- 每条消息有 ingest_id、provider_message_id、device_id；
- 原始消息短期保留用于重放和取证；
- Provider 适配器实现统一接口；
- 消费至少一次，业务效果幂等；
- 背压时优先保护数据接入，不同步执行 Agent 或通知。

**验收**

- 官方样例、真实样例、bool、null、异常字段全部有契约测试；
- 同一消息重复 10 次只产生一次业务效果；
- 错误消息进入隔离区且可重放；
- 达到 S1 峰值两倍压测仍不丢数据；
- Provider 故障有明确告警和恢复步骤。

### 4.6 养护评估与规则模块

**职责**

- 数据质量门；
- 品种、季节、阶段、趋势和组合规则；
- Assessment、风险、建议候选和效果评估；
- 规则发布、灰度、回滚和历史复现。

**实现建议**

- 初期采用代码规则 + 配置化阈值；
- 规则输入输出使用 JSON Schema；
- 复杂规则增长后再评估 Drools、规则 DSL 或决策表；
- LLM 不作为高风险判断唯一来源。
- 若未来允许运营者编写表达式或脚本，必须放入隔离执行器，限制 CPU、内存、时间、网络和可调用 API；禁止在 core-service 进程内执行任意脚本。

**验收**

- 同一输入 + 同一规则版本得到同一输出；
- 品种缺失、数据陈旧和质量低有保守降级；
- 每个 Assessment 保存 facts、reasonCodes、ruleVersion；
- 有黄金样例集验证误报和漏报。

### 4.7 动作、命令与自动化模块

**职责**

- 业务动作目录和参数 Schema；
- 权限、设备能力、当前状态和安全策略校验；
- 二次确认、幂等、下发、回执、验证、补偿与审计；
- 用户授权的有限自动化。

**状态机**

proposed → confirmed → dispatched → acknowledged → verified。

异常状态：rejected、failed、timed_out、cancelled、expired。

**验收**

- 客户端和 LLM 不能提交任意底层 JSON；
- 相同 idempotency_key 不重复控制；
- 派发成功不展示为设备已执行；
- 超时、晚到回执和状态冲突有确定规则；
- 每次动作可追溯到用户、Agent/规则、设备和结果。

### 4.8 任务、日记、时间线与通知模块

**职责**

- CareTask、CareAction、JournalEntry、TimelineEvent；
- 一次性/周期计划、提醒和升级；
- 微信订阅消息、App Push、站内通知；
- 周报、里程碑和自动时间线。

**技术要求**

- 调度任务使用持久化队列，不依赖进程内定时器；
- 通知具有去重键、静默期、频率和渠道偏好；
- 发送成功不代表用户已处置；
- 媒体引用对象存储 ID，不在业务库保存二进制。

**验收**

- 重试不重复创建任务和通知；
- 时区、夏令时和跨日场景通过测试；
- 取消、跳过和完成语义清晰；
- 一次风险可追踪到建议、任务、行动和恢复。

### 4.9 Agent 编排模块

**职责**

- 意图、工具、知识、记忆和上下文装配；
- 模型路由、流式回答、结构化输出和降级；
- 工具调用审计和评估数据；
- 不拥有最终权限和设备执行。

**代码框架**

- 在线 Agent 编排统一使用 TypeScript 显式状态机，与业务后端共享契约和观测能力；
- 知识处理和离线评估确需 Python 生态时，使用独立 Python + FastAPI 服务，不复制业务领域逻辑；
- 与领域服务通过稳定 Tool API，不直接查询业务表；
- 使用 Provider Adapter，避免锁定模型厂商；
- 输出通过 Zod/生成的 JSON Schema 校验。
- 每次 Agent Run 有稳定 run_id、thread_id、当前节点、输入摘要和 checkpoint；
- 需要用户确认的工具调用先持久化 ProposedAction，再暂停 Run；恢复时重新检查用户、权限、动作版本和有效期；
- checkpoint 只保存恢复所需状态，不替代领域数据库和长期记忆；
- 产生外部副作用的节点必须幂等，恢复执行不得重复创建任务或下发命令。

**验收**

- 设备事实问答标注采样时间和来源；
- 缺少事实时明确回答未知；
- Prompt 注入不能绕过工具权限；
- 模型超时、限流、无余额时安全降级；
- 服务重启后可从 checkpoint 恢复待确认 Run；
- 确认前权限撤销或动作过期时，恢复执行必须拒绝；
- 黄金评估集覆盖事实、工具、人设、安全和拒答。

### 4.10 情绪陪伴与实时互动模块

**职责**

- Persona、EmotionState、RelationshipBond 和 Memory；
- 主动互动策略和多端会话连续；
- ASR/TTS/LLM 流式编排；
- 表情、灯光和动作计划；
- 人格资源发布、灰度和回滚。

**实时技术**

- 设备控制和低频状态优先 MQTT；
- 双向文本事件使用 WebSocket；
- 连续音频使用流式 WSS WebSocket；目标硬件和弱网测试未达标时，才通过 ADR 评估 WebRTC/TRTC；
- 会话网关负责鉴权、心跳、重连、顺序号和流量控制；
- TTS/动作支持分段输出，避免等待完整回答；
- 端侧可缓存安全寒暄和离线表达，但不形成第二套长期记忆。

**验收**

- 硬件和 App 显示同一人格版本与关系状态；
- 会话中断重连不重复执行动作；
- 主动互动遵守免打扰和频率；
- 用户可查看、删除和关闭记忆；
- 人格一致性、安全和延迟达到评估门槛。

### 4.11 知识、搜索与记忆模块

**职责**

- 植物结构化知识、文档、版本和审核；
- 关键词/结构化/向量混合检索；
- 会话摘要、用户偏好、植宠事件和关系记忆；
- 记忆提取、冲突、衰减、删除和可见范围。

**技术要求**

- 结构化数据库是植物阈值权威来源；
- 向量索引是检索副本，不是权威主库；
- 知识片段保留 source、version、review_status；
- Memory 有来源、置信度、敏感级别和过期策略；
- 删除主数据后同步删除搜索/向量副本。

**验收**

- 知识发布可灰度和回滚；
- 检索结果可追溯来源；
- 过期知识不参与正式回答；
- 记忆删除在所有副本内按 SLA 完成。

### 4.12 社区、媒体与治理模块

**职责**

- Post、Comment、Follow、Favorite、Report、ModerationCase；
- Feed、搜索、推荐和活动；
- 图片/音视频上传、转码、缩略图和 CDN；
- 机器审核 + 人工审核 + 申诉；
- 隐私范围、版权、反垃圾和未成年人保护。

**技术要求**

- 客户端使用临时签名直传对象存储；
- 上传后异步扫描、转码和审核；
- 未审核内容不进入公开 Feed；
- Feed 初期可 fan-out-on-read，规模增长后按指标演进；
- 推荐特征与在线业务数据隔离；
- 删除和封禁传播到 CDN、搜索和缓存。

**验收**

- 私人日记无法被越权读取；
- 敏感内容进入隔离或人工队列；
- 举报、处置和申诉全程审计；
- 媒体上传失败可续传或安全重试；
- 删除内容在规定时间从公开入口和缓存消失。

### 4.13 运营与管理后台

**职责**

- 设备诊断、用户支持、内容发布、人格版本；
- 规则、消息模板、功能开关和灰度；
- 社区审核、工单和审计；
- 只读报表与有限受控操作。

**验收**

- 管理端强制 MFA、RBAC 和审计；
- 敏感数据默认脱敏；
- 高风险操作二次确认；
- 不允许通用 SQL 控制台作为日常运营工具；
- 每个变更可查操作者、前后值和原因。

---

## 5. 代码框架与仓库结构

### 5.1 推荐语言策略

| 场景 | 推荐 | 原因 |
|---|---|---|
| 小程序 | TypeScript + 原生小程序框架 | 与现有项目接近、类型安全 |
| 移动端 | Flutter / Dart | 跨平台和复杂互动 |
| Web 后台 | React + TypeScript | 生态成熟、组件化 |
| 业务后端 | TypeScript + Node.js 活跃 LTS | 团队统一、迁移现有 JS |
| AI/RAG/评估 | Python + FastAPI | 仅用于确需 Python 生态的知识处理和离线评估 |
| 高吞吐 IoT | TypeScript 起步 | Go 不是基线；仅在压测证明瓶颈且有长期 owner 时通过 ADR 引入 |
| IaC/脚本 | Terraform + TypeScript/Shell | 可审计和可重复 |

Node.js 运行时必须选择仍受官方安全维护的 LTS 分支，并建立季度升级和高危安全补丁流程，不在蓝图中永久锁死具体小版本。

### 5.2 业务后端框架

业务后端统一采用 TypeScript strict + NestJS（Fastify Adapter）：

- NestJS 用于模块、依赖注入、Guard、Interceptor 和 OpenAPI 组织；
- Fastify 作为高性能 HTTP Adapter；
- Zod 统一承载 API、事件、配置和环境变量 Schema；
- Drizzle ORM + drizzle-kit + mysql2 统一承载数据访问和 migration；复杂查询允许在仓储层使用参数化 SQL；
- 数据库迁移由代码仓库管理；
- OpenTelemetry 从框架入口统一注入。

Express、Koa、Prisma、TypeORM 和第二套 Schema 框架不进入主线。更换上述基础框架属于架构变更，必须通过 ADR、迁移成本和兼容性验证。

### 5.3 推荐 Monorepo

~~~text
repo/
  apps/
    mini-program/
    mobile-app/
    admin-web/
    edge-api/
    core-service/
    ingest-service/
    interaction-service/
    command-service/
    worker-service/
  packages/
    domain-identity/
    domain-plantpet/
    domain-device/
    domain-care/
    domain-action/
    domain-companion/
    domain-community/
    contracts-api/
    contracts-events/
    device-protocol/
    observability/
    security/
    test-fixtures/
    ui-design-system/
  ai/
    agent-service/
    evaluation/
    knowledge-pipeline/
  infrastructure/
    terraform/
    kubernetes/
    environments/
    dashboards/
    runbooks/
  docs/
    architecture/
    adr/
    api/
    operations/
~~~

推荐以 pnpm workspaces 管理 TypeScript 包；当项目数量和 CI 时间证明有需要时，引入 Nx 或 Turborepo 做依赖图、affected build 和远程缓存。Nest CLI Monorepo 只负责 Nest 后端子项目，不能替代包含 Flutter、Python 和 IaC 的仓库级工作区。

仓库必须生成机器可读的模块依赖图，并在 CI 阻止领域越层与循环依赖。若未来拆成多个仓库，contracts 通过版本化制品发布，不使用复制粘贴共享。

### 5.4 模块内部结构

每个领域模块采用 Hexagonal/Clean Architecture：

~~~text
domain-device/
  domain/
    entities/
    value-objects/
    policies/
    events/
  application/
    commands/
    queries/
    use-cases/
    ports/
  infrastructure/
    persistence/
    providers/
    messaging/
  interface/
    http/
    consumers/
  tests/
~~~

依赖方向：

- domain 不依赖数据库、HTTP、云 SDK；
- application 依赖 domain 和抽象 port；
- infrastructure 实现 port；
- interface 负责协议转换，不包含核心规则；
- 跨模块只依赖 contracts 或公开 application port。

### 5.5 依赖规则

- 禁止页面直接调用数据库 Adapter；
- 禁止模块 import 其他模块 infrastructure；
- 禁止共享一个无限增长的 common/utils 包；
- 公共包必须有明确所有者和兼容策略；
- 使用静态依赖检查防止循环引用和越层；
- 云 SDK 只能出现在 Provider/Infrastructure 层。

---

## 6. 数据与一致性技术规范

### 6.1 数据库分工

**关系数据库**

- 用户、权限、植宠、设备注册、任务、动作、社区和运营配置；
- 强事务、唯一约束、外键或应用层引用完整性；
- S1 建议主从/多可用区、自动备份和时间点恢复。

**Redis**

- 缓存、Session、限流、短锁、幂等窗口和实时连接状态；
- 不作为核心事实唯一存储；
- 缓存丢失不能导致事实错误。

**消息队列**

- 遥测事件、Outbox、通知、媒体处理、搜索索引和分析；
- Topic、分区键、保留期和重试策略文档化；
- 设备事件按 device_id 分区以维持单设备顺序。

**TCHouse-C（ClickHouse）**

- T2/S2 后承载大规模原始遥测、趋势分析、聚合查询和运营统计；
- MySQL 继续保存业务事务、设备 latest、关键结果和 ClickHouse 数据引用；
- 数据经 CKafka/批处理写入，按时间和设备维度分区，具备保留、降采样、重放和对账策略；
- 不在 T0/T1 为预期增长提前部署，进入门槛见第 13.1 节。

**对象存储**

- 图片、音频、视频、固件和导出文件；
- 临时签名、内容类型、大小和病毒/内容扫描；
- 生命周期、CDN 和删除传播策略。

**搜索/向量**

- 植物知识、社区和记忆检索副本；
- 可从主数据重建；
- 索引版本和重建流程明确。

### 6.2 Schema 规范

- 表名、字段名使用 snake_case；
- API 使用 camelCase；
- ID 不暴露自增序列时使用 UUIDv7/ULID 等稳定 ID；
- 金额使用整数最小单位；
- 时间存 UTC，字段明确 occurred_at、received_at、created_at；
- 软删除字段不能替代完整生命周期状态；
- JSON 字段必须有 JSON Schema 和演进策略；
- 遥测值保留 value、unit、sampledAt、quality、source。

### 6.3 迁移规范

- 所有 Schema 变更通过版本化 migration；
- 采用 expand → migrate → contract；
- 先增加兼容字段，再迁移数据和消费者，最后删除旧字段；
- 大表迁移有耗时、锁表和回滚评估；
- 生产 migration 由 CI/CD 执行并记录；
- 禁止手工修改生产表后不补 migration。

### 6.4 一致性模式

- 单服务写入：本地数据库事务；
- 跨服务通知：Transactional Outbox；
- 消费者：Inbox/幂等键；
- 长流程：Saga/状态机；
- 读模型：允许最终一致，展示更新时间；
- 钱款、权限和设备动作审批：强一致优先；
- 缓存：Cache Aside + 明确 TTL 和失效事件。

### 6.5 持久化工作流与采用阈值

以下流程必须被视为可暂停、可恢复的长流程，而不是一次 HTTP 请求：

- 设备动作确认、超时和补偿；
- 周期养护计划和跨时区提醒；
- 媒体上传、转码、审核和发布；
- Agent 动作候选、用户确认和恢复执行；
- 数据导出、账号注销和跨存储删除；
- 固件灰度、升级验证和回退。

S0/S1 默认使用数据库状态机、Outbox、持久化队列和幂等 worker。满足以下任一条件时评估 Temporal 等 Durable Execution 平台：

- 单流程跨越多个服务且持续数小时至数月；
- 补偿、重试和人工确认分支明显增加；
- 自研状态机已反复出现恢复、定时器或可观测性缺陷；
- 工作流数量和团队规模足以承担独立平台成本。

无论是否采用框架，都必须保证：状态持久化、定时器持久化、Activity 幂等、版本兼容、可查询进度、可取消和可人工修复。

### 6.6 配额、背压与噪声隔离

- 按 device、user、household/tenant、Provider 设置 API、遥测、命令、WebSocket、通知和模型调用配额；
- 配额配置版本化，可按套餐或设备型号覆盖；
- 遥测超过配额时记录丢弃/采样原因，不能静默消失；
- 单个噪声设备进入隔离或降采样，不影响同分区其他设备；
- 消费者根据 lag 自动扩容或降级非关键处理；
- 关键命令与普通遥测使用不同优先级或队列，防止控制被遥测洪峰阻塞。

---

## 7. API、事件与设备协议规范

### 7.1 HTTP API

- REST + OpenAPI 3.x 作为默认；
- URL 以业务资源表达，不暴露表名；
- 版本通过 /v1 或兼容 Header；
- 统一错误结构：code、message、details、requestId；
- 分页优先 cursor，后台小列表可 offset；
- 写操作接受 idempotencyKey；
- 使用 ETag/version 做并发更新；
- 敏感接口禁止在 URL Query 放 Token 或个人数据。
- 当客户端与 Provider 可独立发布时，除 OpenAPI Schema 校验外增加消费者驱动契约测试；只对消费者实际依赖的字段和行为建约，避免过度严格的脆弱契约。

### 7.2 实时接口

- WebSocket 事件包含 type、version、sequence、sentAt、payload；
- 客户端 ACK 只确认收到，不代表业务动作完成；
- 支持心跳、重连、resume token 和 last sequence；
- 语音流包含 session_id、chunk sequence、codec 和时间；
- 实时消息设置最大大小、速率和背压。

### 7.3 事件规范

- 使用 AsyncAPI 或等价文档；
- 事件包含 eventId、eventType、version、occurredAt、producer、subjectId、traceId；
- 事件是已经发生的事实，命令表达希望发生的事；
- 事件不可原地改语义，新版本向后兼容；
- PII 最小化，敏感负载使用引用 ID；
- 消费失败有重试、死信和重放工具。
- 事件消费者契约覆盖字段缺失、增加可选字段、旧版本和重复消息；发布前验证当前生产消费者仍兼容。

### 7.4 设备协议

- 设备字段由独立协议包维护；
- product/model/firmware 对应协议版本；
- 属性、事件、命令分别定义 Schema；
- 单位、范围、精度、缺省、枚举和时间语义明确；
- 指令包含 command_id、issued_at、expires_at；
- 回执包含 command_id、status、reported_state、error_code；
- 固件必须支持安全升级、版本回退和签名校验；
- Provider topic/字段由 Adapter 转换，领域层只看统一协议。

---

## 8. 安全与隐私技术基线

### 8.1 身份与密钥

- 用户、设备、服务三类身份分开；
- 服务间使用短期身份或 mTLS，避免长期共享密钥；
- 密钥进入 Secret Manager/KMS，禁止进入代码和示例；
- 定期轮换并记录 owner、用途和过期时间；
- 设备凭证按设备唯一，支持吊销；
- 管理端 MFA、最小权限和条件访问。

授权架构区分：

- PEP（Policy Enforcement Point）：API、工具和命令入口，负责执行允许/拒绝；
- PDP（Policy Decision Point）：根据主体、资源、动作和上下文给出决策；
- PIP（Policy Information Point）：提供设备归属、家庭关系、风险等级等决策属性。

S0/S1 可在身份模块内实现强类型 PDP。只有策略跨服务、关系授权或审计复杂度明显上升时，才评估 OPA、OpenFGA、Casbin 等独立策略产品。Feature Flag 不能代替权限判断。

### 8.2 应用安全

- 依据 OWASP ASVS/Top 10 建立检查清单；
- 输入 Schema、输出编码、SQL 参数化；
- CSRF、XSS、SSRF、上传文件和路径安全；
- API 限流、防重放和异常行为检测；
- 依赖 SCA、代码 SAST、镜像扫描和 SBOM；
- 高危漏洞有紧急发布流程。

### 8.3 数据与隐私

- 数据分为公开、内部、敏感、高敏；
- 手机、位置、语音、对话、家庭关系和未成年人数据单独治理；
- 传输 TLS，存储按敏感度加密；
- 日志和分析数据脱敏；
- 用户可以导出、删除和撤回授权；
- 原始语音默认最短保留；
- 非必要数据不发送给模型供应商。

### 8.4 AI 与社区

- Prompt、检索内容和系统指令隔离；
- Tool Schema + 权限 + 策略三重校验；
- 模型输出内容审核和高风险分类；
- 记录模型、Prompt、工具和安全策略版本；
- 社区机器审核失败进入人工队列；
- 举报和管理员操作不可篡改审计。

---

## 9. 可观测性、可靠性与灾备

### 9.1 OpenTelemetry 统一标准

所有服务统一输出：

- Trace：HTTP、消息、数据库、IoT Provider、模型和对象存储；
- Metrics：RED（Rate、Errors、Duration）和 USE（Utilization、Saturation、Errors）；
- Logs：结构化 JSON，包含 traceId、service、environment 和脱敏主体 ID。

禁止只依赖全文日志搜索判断系统健康。

Telemetry 属性必须控制基数：device_id、user_id 不作为无限基数 Metrics label，而放在 Trace/Log 或经过聚合的业务指标中；敏感对话和原始 Prompt 默认不进入普通日志。

### 9.2 核心业务指标

- 遥测接入延迟、丢弃、死信和数据新鲜度；
- 在线设备、离线检测时延；
- 命令派发、平台确认、设备确认和超时；
- Agent 首 Token、总时延、工具错误和降级；
- 实时会话连接、重连、ASR/TTS 错误；
- 通知送达、去重和退订；
- 社区审核积压、举报和处理时长。

### 9.3 告警原则

- 只对可行动、影响用户或将导致数据风险的情况告警；
- P1/P2/P3 分级并有 owner；
- 使用多窗口 Burn Rate 监控 SLO；
- 单设备异常通常进入业务事件，不直接呼叫值班；
- 告警必须链接到 Dashboard 和 Runbook。

### 9.4 容错与降级

- LLM 故障：规则/模板回答，设备查看不受影响；
- 知识搜索故障：只回答设备事实或提示稍后重试；
- 消息队列积压：保护接入、延迟非关键消费者；
- Redis 故障：回源数据库并限流；
- 通知故障：持久化重试；
- IoT Provider 故障：命令标记失败/待恢复，不伪造成功；
- 社区故障：不影响养护和设备功能。

### 9.5 备份与灾备

- 数据库自动备份 + PITR；
- 对象存储版本/生命周期；
- 配置、IaC、Dashboard 和 Runbook 进 Git；
- 定期恢复演练，不只检查备份任务成功；
- S1 至少多可用区；
- S2 评估跨地域只读副本或灾备；
- 明确 RPO、RTO、切换负责人和回切步骤。

---

## 10. 测试与质量工程

### 10.1 测试金字塔

- 单元测试：领域规则、权限、状态机、协议归一化；
- 组件测试：数据库 Repository、Provider Adapter；
- 契约测试：OpenAPI、事件、设备协议和 Tool API；
- 集成测试：真实中间件容器和沙箱外部服务；
- E2E：关键用户旅程；
- 硬件在环：真实固件和网络；
- 性能/稳定性：峰值、长稳、故障注入；
- AI 评估：离线黄金集 + 线上反馈；
- 安全测试：SAST、DAST、越权、依赖和渗透。

推荐测试工具模式：

- 使用 Testcontainers 或等价方案启动系统实际采用的 MySQL、Redis、Kafka/队列和对象存储模拟器；未采用的基础设施不为测试而引入；
- 使用 Pact 或等价消费者驱动契约验证独立发布的客户端/服务，不用它替代领域功能测试；
- 使用 Provider 官方 Sandbox 或录制后脱敏的协议 fixture 测试 OneNET、ASR/TTS、LLM 和审核 Adapter；
- 使用 Toxiproxy 或等价故障代理模拟延迟、断连和丢包；
- AI 评估同时保留确定性断言、人工标注和统计阈值。

### 10.2 必测 E2E

1. 微信登录 → 建立用户；
2. 扫码/编码绑定 → 设备归属；
3. 遥测 → latest → 首页展示；
4. 风险 → 建议 → 任务 → 行动 → 恢复；
5. 控制请求 → 派发 → 设备回报 → 状态验证；
6. 硬件语音 → Agent → 人格回答 → 多端摘要；
7. 日记 → 授权分享 → 审核 → 社区互动；
8. 解绑/转移 → 历史和权限正确；
9. Token 过期、网络失败、重复消息、乱序消息；
10. LLM、Redis、队列、IoT Provider 不可用时降级。

### 10.3 测试数据

- 使用工厂和 fixture，不依赖共享脏数据库；
- 设备协议样例版本化；
- 生产数据不得直接复制到测试环境；
- 脱敏样本需通过审核；
- AI 评估集记录来源、期望和风险标签。

### 10.4 覆盖率原则

不以单一行覆盖率作为质量结论。建议：

- 核心领域规则和权限分支覆盖不低于 90%；
- 其他模块按风险设置门槛；
- 所有 P0/P1 缺陷必须增加回归测试；
- 契约和关键 E2E 是发布硬门槛。

---

## 11. CI/CD、环境与发布规范

### 11.1 分支与变更

- 主干开发或短分支；
- PR 必须关联需求/问题、测试和影响模块；
- CODEOWNERS 按领域审批；
- 架构变化提交 ADR；
- Conventional Commits 可作为自动版本工具，但不强制替代清晰说明。

### 11.2 CI 流水线

每次 PR：

1. 格式、Lint、类型检查；
2. 单元和组件测试；
3. 依赖、密钥、SAST 和许可证扫描；
4. 构建不可变制品；
5. 契约兼容检查；
6. 受影响模块集成测试。

合并后：

1. 推送带 commit SHA 的镜像/部署包；
2. 部署 test/staging；
3. migration dry-run；
4. E2E、DAST 和烟雾测试；
5. 生成 SBOM、版本说明和部署证据。

当出现两个以上可独立发布的消费者/Provider 组合时，CI 增加契约 Broker 或等价兼容矩阵，并在部署前执行 can-I-deploy 类检查，阻止破坏生产消费者的发布。

### 11.3 发布

- 同一制品逐环境晋级，不重新构建；
- Feature Flag 隔离未完成功能；
- 采用滚动、蓝绿或金丝雀；
- 数据迁移先兼容再切流；
- 自动健康门槛失败即停止/回滚；
- 发布后验证技术 SLI 和业务 KPI。

Feature Flag 通过 OpenFeature 或等价厂商中立接口访问，并遵守：

- 每个 Flag 有 owner、用途、创建时间、过期时间和默认安全值；
- Flag 失败时使用本地安全默认值；
- 权限、安全和账务判断不能依赖 Flag；
- 实验 Flag、发布 Flag、运维 Kill Switch 分类管理；
- 发布完成后清理过期 Flag，CI 定期报告 stale flag。

### 11.4 环境

| 环境 | 用途 | 数据 |
|---|---|---|
| local | 单模块开发 | fixture/容器 |
| test | 自动集成 | 自动生成 |
| staging | 生产等价验收 | 脱敏/模拟设备 |
| production | 正式用户 | 真实数据 |

每个环境独立账号/项目、数据库、队列、存储、IoT/AI 凭证和域名。

---

## 12. 技术规范化要求

### 12.1 代码

- TypeScript strict；
- ESLint + Prettier 或统一等价工具；
- 禁止 any 无理由扩散；
- 函数和模块限制复杂度；
- 错误使用业务错误类型，不抛裸字符串；
- 日志不使用随意 console 输出；
- 配置启动时校验，缺失则 fail fast；
- 时间、ID、金额和单位使用统一库。

### 12.2 文档

必须维护：

- README 和本地启动；
- OpenAPI/AsyncAPI/设备协议；
- ERD 和数据所有权；
- ADR；
- 部署图和环境矩阵；
- Dashboard、告警和 Runbook；
- 数据迁移与回滚；
- 外部依赖和成本 owner。

### 12.3 架构决策 ADR

以下变更必须有 ADR：

- 新语言、新数据库或新消息系统；
- 拆分/合并服务；
- 身份、权限和密钥模型；
- 设备协议不兼容变化；
- AI 模型/记忆策略重大变化；
- 数据跨境、长期保留或第三方共享；
- SLO、RPO/RTO 变化。

ADR 包含背景、选择、替代、后果、迁移和回退。

---

## 13. 已确认技术栈与采用边界

本节是唯一技术选型基线；简明版只做摘要，其他章节负责说明实现和验收，不再重复列出候选方案。

| 能力 | 已确认主选 | 采用边界 |
|---|---|---|
| 微信端 | 原生小程序 + TypeScript | 渐进迁移现有 JavaScript，不做框架重写 |
| 管理后台 | React + TypeScript + Vite | 用于运营、客服、设备和内容治理 |
| App | Flutter + Dart | T2 再产品化 |
| 业务后端 | Node.js Active LTS + TypeScript strict + NestJS/Fastify | 长期主栈，不并行引入第二套 Web 框架 |
| Schema 与数据访问 | Zod + Drizzle ORM + mysql2 | API、事件和配置统一 Zod；数据库统一 Drizzle/migration |
| 事务数据 | TDSQL-C MySQL 8 | 长期保存核心业务事实和设备 latest |
| 缓存 | 腾讯云 Redis | 只保存可重建缓存和短期协调状态，按门槛引入 |
| 异步与事件流 | MySQL Outbox 起步，规模化使用 CKafka | 先保证可靠性，再按吞吐、重放和消费组需求升级 |
| 遥测与分析 | MySQL 聚合起步，规模化使用 TCHouse-C（ClickHouse） | 保存大规模遥测历史和分析数据，不承载业务事务 |
| 搜索与向量 | 腾讯云 Elasticsearch | 社区全文、知识检索和向量召回共用，按门槛引入 |
| 媒体 | COS + CDN | 图片、音视频、固件、导出和冷归档 |
| IoT | OneNET + 自有 Provider Adapter | OneNET 对象不得进入领域模型和公开契约 |
| Agent | TypeScript 显式状态机 + OpenAI-compatible Provider Adapter | 权限、动作和长期事实仍由业务核心掌握 |
| AI 数据处理 | Python + FastAPI | 只用于确需 Python 生态的知识处理和离线评估 |
| 实时互动 | WSS WebSocket + 托管 ASR/TTS | 硬件协议和弱网结果未达标时才另行评估 WebRTC/TRTC |
| 当前计算 | 腾讯云 SCF | 低频、突发、webhook 和定时任务 |
| 后续计算 | Docker + TCR + TKE Serverless | 常驻、长连接或独立扩缩服务达到门槛后采用 |
| 工程平台 | pnpm workspaces + GitHub Actions + Terraform | 统一仓库、CI/CD 和云资源管理 |
| 可观测性 | OpenTelemetry + CLS/云监控 | 统一日志、指标、Trace、告警和 SLO |
| 测试 | Vitest + Supertest + Testcontainers + miniprogram-automator + k6 | 覆盖单元、API、真实依赖、小程序 E2E 和压测 |

OneNET、腾讯云和模型厂商 SDK 只能存在于 Provider/Infrastructure 层。更换主选技术必须提交 ADR，说明收益、三年 TCO、迁移、回退和数据退出方案。

上述结论是目标技术基线，不表示当前代码已经产品化；当前实现差距统一记录在《当前系统现状与改进路线》中，不在本文重复维护。

### 13.1 分阶段部署基线与升级门槛

| 研发阶段 | 目标容量 | 应部署 | 默认不部署 |
|---|---|---|---|
| T0：Demo 收敛 | S0 验证 | 现有 4 个业务 SCF + 1 个清理任务、MySQL、OneNET、最小网关、日志与告警 | Redis、CKafka、TCHouse-C、Elasticsearch、TKE、独立 Python 在线服务 |
| T1：产品 V1 | 完成 S0，验证 S1 | 模块化 core、独立 ingest、Outbox + worker、staging、备份、COS 按需 | 不强制拆完所有服务；Redis、CKafka 和容器按下述门槛引入 |
| T2：互动与社区 | 稳定 S1，验证 S2 | 3 至 5 个主要运行单元；按证据加入 Redis、CKafka、TCHouse-C、Elasticsearch；长连接容器化 | 独立 Temporal、跨地域双活和每模块独立数据库 |
| T3：规模化 | 达到 S2 及以上 | 按资源/故障边界拆分、多可用区、TKE Serverless、规模化数据平台 | 任何没有 owner、容量证据和退出方案的平台 |

具体进入门槛如下：

- **SCF → 容器**：存在稳定常驻 CPU/内存、长连接/流式会话、执行时长限制，或连续两个月“SCF 资源 + 预置并发 + 网关/流量 + 日志”成本比同等托管容器高 20% 以上时，只迁移对应负载；webhook、定时和低频任务仍可保留 SCF。
- **TDSQL-C Serverless → 固定规格**：业务从间歇突发变成全天稳定负载后，使用至少 14 天监控数据和官方成本估算比较；固定规格更低且容量可预测时切换。开发/测试环境可继续自动暂停或按量。
- **引入 Redis**：数据库 P95 已受热点读影响，或多实例确需共享限流、短会话、分布式锁/幂等窗口，且无法由唯一约束、Outbox 或本地缓存可靠解决。引入前先明确 key owner、TTL、最大内存和回源策略。
- **Outbox → CKafka**：Outbox 积压/锁竞争影响事务库，或明确需要独立消费组、设备分区顺序和小时/天级重放。普通低频任务仍可保留 Outbox，不为统一形式全部迁移。
- **托管容器 → TKE Serverless**：通常需要至少 8 至 10 个常驻可独立发布工作负载，并且已有明确平台 owner、Kubernetes 升级、安全、网络、备份和 7×24 故障责任。只为运行两三个容器不得上 TKE。
- **MySQL 遥测 → TCHouse-C**：执行保留、聚合和分区后仍无法满足遥测写入、历史查询或单位存储成本目标，再进行 CKafka/批处理双写、对账和退出演练。
- **MySQL 检索 → Elasticsearch**：社区/知识检索无法通过 MySQL 索引达到相关性、混合搜索或延迟目标时引入；Elasticsearch 不保存唯一业务事实，也不代替 ClickHouse 承载遥测历史。
- **自研状态机 → Temporal 类平台**：严格执行第 6.5 节条件；不得为了少量定时任务部署独立工作流集群。
- **TypeScript → Python/Go 新服务**：必须有库生态或压测证据证明收益，并有明确长期 owner；语言偏好不是拆分理由。

### 13.2 成本治理红线

成本可控不是依赖低单价，而是让每项费用能归属、预测、限额和退出：

1. 所有云资源必须标记 `product`、`env`、`service`、`owner`、`cost-center`；无法归属的资源不得进入生产。
2. 建立月预算和 50%/80%/100% 告警；日成本较过去 7 日均值异常上升时告警。生产资源扩容、购买资源包和新增常驻实例必须有 ADR/变更记录。
3. 每月核算单注册设备、单在线设备、单活跃用户、单互动分钟、每 GB 媒体和每千条遥测成本；业务规划必须使用这些单位成本，而不是只看总账单。
4. 遥测原文不得作为普通 INFO 日志重复写入 CLS；调试采样、字段索引白名单、热日志保留期和 COS 归档必须配置。日志量、索引量和保留天数分别设预算。
5. 原始遥测必须有保留期和降采样规则；latest、小时/日聚合长期保留，原始明细按产品和合规需要分层沉降或删除。
6. LLM/ASR/TTS 按用户、设备和场景设置配额、超时、最大上下文和模型路由；高价模型只处理确需质量的步骤，离线评估不得无预算批量运行。
7. COS 设置生命周期、缩略图/转码复用和上传大小限制；CDN/外网流量设置防盗刷和封顶告警。客户端使用临时凭证直传，避免媒体经业务服务中转产生双倍流量。
8. 开发和测试环境不得照搬生产高可用规格；可暂停的数据库、函数和临时环境自动回收。生产事务主库、备份和安全能力则不能为省成本降级。
9. 每个新平台在采购前提交三年 TCO：云账单、开发接入、值班运维、升级迁移、数据导出和退出成本。没有 owner 和退出方案的基础设施不得上线。

在缺少实际地域、在线率、上报频率、语音分钟数、媒体下行量和高可用等级时，本文不能承诺一个绝对月费数字。进入每个研发阶段前，负责人必须用该阶段容量模型生成 Low/Base/High 三档月费，并在压测后用真实账单校准；偏差超过 20% 时重新评审架构和排期。

---

## 14. 产品级验收标准

### 14.1 架构验收

- 逻辑模块、代码模块和部署单元有文档；
- 每类数据有唯一 owner；
- 客户端、硬件、领域和 Provider 无越层依赖；
- 关键跨模块使用版本化契约；
- 所有重大决策有 ADR；
- 无必须靠某个人口头解释才能运行的核心链路。
- 数字孪生有 revision、并发写规则、变更事件和可重建读模型；
- 配额和背压覆盖 device、user/tenant、Provider 与实时会话；
- 长流程明确使用数据库状态机或 Durable Workflow，进程重启不会丢进度。

### 14.2 功能链路验收

- 登录、绑定、上报、查询、评估、任务、控制、回报、时间线全链路自动验证；
- 硬件和软件互动共享人格、关系和会话摘要；
- 私人内容到社区发布经过显式授权和审核；
- 植宠换设备、设备换植物、多人协作行为正确；
- 所有失败场景有明确用户状态，不伪造成功。
- Agent 待确认动作跨重启可恢复，恢复时重新校验权限与有效期；
- Feature Flag 平台不可用时使用安全默认值，Kill Switch 经演练可用。

### 14.3 安全验收

- 无有效凭证进入仓库、镜像、客户端和日志；
- 越权、伪造身份、重放和任意命令测试通过；
- 管理端 MFA/RBAC/审计通过；
- 高风险 AI 与社区内容策略通过红队样例；
- 依赖和镜像无未接受的高危漏洞；
- 数据导出、删除和授权撤回通过测试；
- 完成第三方渗透测试或等价安全评估。

### 14.4 性能与容量验收

- S1 峰值 2 倍压力下遥测不丢失；
- 关键 API、命令和互动延迟达到 SLO；
- 72 小时长稳测试无持续内存泄漏和队列失控；
- 数据库、连接池以及已部署的 Redis/队列有容量余量；
- 媒体上传、语音并发和社区 Feed 分别压测；
- 有容量模型和扩容 Runbook。

### 14.5 可靠性验收

- 数据库以及系统实际使用的 Redis、队列、LLM、IoT Provider 完成故障演练；
- 重试、幂等、死信和重放验证；
- 备份恢复演练达到 RPO/RTO；
- 多可用区切换验证；
- 告警能在用户投诉前发现关键故障；
- 每项 P1 告警有 Runbook 和值班 owner。

### 14.6 质量验收

- PR 质量门全部启用；
- 核心规则、权限、状态机达到覆盖目标；
- OpenAPI/Event/设备协议兼容检查通过；
- 关键 E2E 和硬件在环测试通过；
- Agent/陪伴黄金集达到既定阈值；
- P0/P1 缺陷为零，P2 有接受记录和解决计划。
- 独立发布消费者具备消费者驱动契约或等价兼容验证；
- 数据库、缓存和队列集成测试使用真实协议实现而非全部 Mock；
- 配置脚本/规则若允许运营扩展，隔离执行与资源上限测试通过。

### 14.7 运维与交付验收

- 可从空环境通过 IaC 和流水线部署 staging；
- 制品可追溯到 commit、依赖、SBOM 和配置版本；
- Dashboard、告警、Runbook、备份和联系人齐全；
- 灰度、回滚和数据库兼容发布演练通过；
- 新成员依据文档可在一天内启动核心开发环境；
- 常见客服/内容/设备运维不依赖直接改生产数据库。
- 云资源具备统一标签、预算告警、自动回收和成本 owner；
- Low/Base/High 月费模型已用压测和真实账单校准，偏差不超过 20%；
- 单设备、单活跃用户、单互动分钟和每千条遥测单位成本达到立项预算；
- 新增常驻基础设施均满足第 13.1 节进入门槛，并具备退出方案。

---

## 15. 实施路线入口

从当前 SCF Demo 到产品级系统的阶段顺序、每一步改动、退出条件、并行关系和基础设施进入时机，统一维护在[植宠系统实施顺序与演进路线](./plant-pet-implementation-roadmap.md)。本文只保留目标规范和验收基线，避免两处维护不同的施工计划。

---

## 16. 采用边界与剩余验证

技术栈已经在第 13 节定版，不再把框架、ORM、数据库和消息产品作为开放多选题。团队只需继续验证以下产品参数：

1. OneNET 与腾讯云之间的生产网络、限额、故障和退出方案；
2. WebSocket 硬件语音在目标网络下的首包、断线恢复和成本，未达标时再评估 TRTC/WebRTC；
3. Redis、CKafka、TCHouse-C、Elasticsearch 和 TKE Serverless 的实际进入时间，以第 13.1 节指标为准；
4. ASR/TTS、LLM 和内容审核供应商的效果、合规、价格与降级组合；
5. Flutter 正式产品化时间，以 API、设计系统和 App 独有需求稳定为前提。

默认不做全量微服务、事件溯源主库、自建 AI/语音平台、跨地域双活和独立向量数据库；禁止 Redis 成为事实主库、社区经验直接成为养护规则、LLM 直连数据库或 IoT Broker。突破这些边界必须提交 ADR。

---

## 附录 A：官方资料入口

- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
- [腾讯云 SCF 计费概述](https://cloud.tencent.com/document/product/583/17299)
- [TDSQL-C MySQL Serverless 计费](https://cloud.tencent.com/document/product/1003/73002)
- [TDSQL-C Serverless 成本估算](https://cloud.tencent.com/document/product/1003/113045)
- [腾讯云 Redis 计费概述](https://cloud.tencent.com/document/product/239/30822)
- [腾讯云 TKE 计费概述](https://intl.cloud.tencent.com/zh/document/product/457/45157)
- [腾讯云 CLS 计费概述](https://cloud.tencent.com/document/product/614/45802/)
- [腾讯云 COS 按量计费](https://cloud.tencent.com/document/product/436/36522)
- [腾讯云 TCHouse-C（ClickHouse）产品概述](https://cloud.tencent.com/document/product/1299/47756)
- [腾讯云 Elasticsearch 向量搜索](https://cloud.tencent.com/document/product/845/128816)
- [NestJS Documentation](https://docs.nestjs.com/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [AsyncAPI Specification](https://www.asyncapi.com/docs/reference/specification/latest)
- [腾讯云产品与 API 文档中心](https://cloud.tencent.com/document/api)
- [腾讯云 TDMQ for CKafka](https://intl.cloud.tencent.com/document/product/597/48712)
- [OneNET 开放平台](https://open.iot.10086.cn/)
- [Eclipse Ditto Architecture](https://eclipse.dev/ditto/2.4/architecture-overview.html)
- [ThingsBoard Architecture](https://thingsboard.io/docs/reference/architecture/)
- [Temporal Documentation](https://docs.temporal.io/)
- [OpenFeature](https://openfeature.dev/docs/reference/intro/)
- [Open Policy Agent](https://www.openpolicyagent.org/docs)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Pact Contract Testing](https://docs.pact.io/)
- [Testcontainers](https://testcontainers.com/)

第 13 节产品是已确认的目标主选，但不等于当前立即采购。达到采用门槛后，仍须在实际开通前核对地域、配额、价格、合规、网络和最新产品状态；若主选不可用，再通过 ADR 启动替代方案评估。

---

## 附录 B：外部架构参考

| 参考项目/规范 | 已吸收 | 当前不直接采用 | 重新评估触发条件 |
|---|---|---|---|
| Eclipse Ditto | Connectivity/Twin/Policy/Search 分离、Twin revision | 整套 Ditto 集群与 MongoDB 模型 | 自研 Twin 成为主要维护瓶颈 |
| ThingsBoard | Transport 隔离、统一消息、队列、配额、设备级顺序 | 整个平台替换现有产品后端 | 需要大量标准 IoT 平台能力且定制收益不足 |
| Temporal | 持久化长流程、恢复、幂等 Activity | S0 即部署独立 Temporal 平台 | 自研状态机恢复和定时器复杂度持续上升 |
| OpenFeature | 厂商中立 Flag API、Hook、上下文 | 立即采购复杂实验平台 | 灰度/实验/Kill Switch 进入多个服务 |
| OPA 等 Policy Engine | PDP/PEP 分离、Policy as Code | 用 Rego 替代所有应用权限 | 跨服务关系授权和审计难以维护 |
| LangGraph | checkpoint、HITL、可恢复 Agent Run | 让框架拥有权限、动作和长期记忆真相 | Agent 流程出现多步暂停、分支和恢复需求 |
| Pact | 消费者驱动契约和部署兼容门 | 小团队单体阶段部署 Broker | 客户端/服务开始独立发布 |
| Testcontainers | 真实依赖、隔离、可重复集成测试 | 用容器测试替代全部单元/E2E | 从 T0 起即可逐步采用 |
| Backstage | Service Catalog、TechDocs、模板化脚手架 | 当前立即建设开发者门户 | 服务和团队数量导致发现/所有权成本明显上升 |

本次评审结论是“补强而不重构”：现有模块化单体起步、数据面独立、Provider Adapter、Outbox/幂等和按触发条件拆服务的总方向与成熟项目一致，不需要改成现成 IoT 平台或全量微服务。修订重点是补齐此前容易在产品化阶段暴露的运行细节和采用门槛。
