# agent-scf

TRT Nova 的受控 AI 养护助手后端。模型可以读取已授权事实，也可以生成待确认 proposal；它不持有正式业务写入或设备控制权限。

## Current Scope

- `POST /agent/session`：读取一盆 PlantPet 的当前会话、已水合 proposal 状态、结构化记忆、无限状态和当日用量
- `POST /agent/chat`：NOVA 连续对话、发布知识 RAG、PlantPet/业务上下文、确认式称呼记忆候选和确认式任务候选
- `POST /vision/analyze`：JPEG/PNG/WebP 图片的结构化植物观察；普通图片建议产生零任务，只有“明确任务意图 + 当前 PlantPet + 图片高置信候选与该 PlantPet 匹配”才生成 `pending` 任务 proposal
- 原始对话最多最近 20 轮且不超过 30 天；裁剪前解除 proposal 的消息引用、使未处理 proposal 过期、清理会话媒体，并将幂等事件脱敏成 tombstone，避免晚到重试复活旧内容
- 文本 Chat、图片 Vision 与文档分析发送均携带 `clientTurnKey`：同一轮网络重试收敛到同一 exchange；已撤回或已按保留策略清理的 key 返回不可重放结果
- `ai_messages` 是可读会话账本，`ai_conversation_events` 是追加式审计记录；Context Projector 只投影当前有效分支和未撤回消息，本实现不是纯事件溯源系统
- 重新编辑在目标消息之前事务性创建分支并复制仍保留的消息/媒体引用；撤回只处理本人当前会话的最后完整一轮，并取消该轮未确认 proposal
- 比赛阶段所有账户 Chat/Vision 无限，仍记录每日次数和 token 用量
- Agent 不执行设备命令，也不直接写正式任务、PlantPet、日记或诊断；任务必须经 proposal 预览/编辑后由 `api-scf` 重新校验并确认写入，称呼偏好也只有用户确认后才进入长期记忆

## Structure

- `index.js`: SCF entry and route dispatch
- `lib/http.js`: HTTP event parsing and JSON response helper
- `lib/auth.js`: JWT/openid resolution
- `lib/db.js`: MySQL pool
- `lib/llmClient.js`: optional OpenAI-compatible chat API client
- `lib/visionClient.js`: OpenAI-compatible multimodal client and image validation
- `lib/agent-store.js`: message ledger, audit events, branches, withdrawals, proposal persistence, idempotent turns, retention, media links, and structured memory storage
- `lib/quota.js`: Asia/Shanghai daily Chat/Vision quota and usage
- `lib/safety.js`: read-only Agent safety metadata
- `tools/device.js`: device snapshot/history read tools
- `tools/plant.js`: plant profile search from `plant_library`
- `rules/plantDiagnosis.js`: sensor threshold diagnosis rules
- `rag/knowledgeSearch.js`: lightweight plant/protocol knowledge retrieval
- `agent/chatHandler.js`: NOVA chat, RAG, memory recall, confirmed-memory proposal, and task-proposal assembly
- `agent/visionHandler.js`: Vision quota, PlantPet/media ownership, structured observation, and strict matched-image task-proposal gate
- `agent/petContext.js`: authenticated PlantPet and business-event context
- `runtime/plantPetRuntime.js`: M7 Node 20-compatible minimal Agent loop seam; PI semantics inspired, not the official PI Core package
- `runtime/turnEnvelope.js`: normalized turn input including `clientTurnKey`
- `runtime/capabilityPolicy.js`: narrow capability preflight and per-turn tool allowlist
- `runtime/contextProjector.js`: current-branch conversation, transient Agent state, confirmed memory, private facts, and published-knowledge projection
- `runtime/sessionAdapter.js`: event-backed session projection; not a second session store and not pure event sourcing
- `runtime/memoryAdapter.js`: relevant confirmed `user_preference` recall only
- `runtime/toolRegistry.js`: current-account-only read/proposal tools, argument schema, owner binding, and proposal-only side-effect enforcement
- `runtime/shadowRuntime.js`: feature-flagged legacy/tool-trace comparison without response takeover
- `runtime/rolloutRuntime.js`: stable-cohort controlled rollout, result gate, legacy fallback, atomic exchange/proposal persistence, and idempotent replay

## Optional Chat API

Chat 和 Vision 通过 OpenAI-compatible Chat Completions 服务调用。未配置或请求失败时返回明确手动路径，不把失败伪装为模型答案。

Required environment variables:

- `LLM_API_ENABLED=true`
- `LLM_API_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `VISION_MODEL`

Optional:

- `LLM_API_PATH=/v1/chat/completions`
- `LLM_TEMPERATURE=0.4`
- `LLM_MAX_TOKENS=500`
- `LLM_TIMEOUT_MS=12000`
- `VISION_IMAGE_DETAIL=low`
- `VISION_TIMEOUT_MS=30000`
- `AGENT_SHADOW_ENABLED=false`：M7 Phase 2 影子开关，默认关闭
- `AGENT_SHADOW_FINGERPRINT_KEY`：建议配置独立随机密钥；留空时回退 `JWT_SECRET` 生成 HMAC 日志指纹
- `AGENT_SHADOW_SAMPLE_RATE=1`：开启后按稳定指纹采样，范围 `0..1`
- `AGENT_SHADOW_MAX_STEPS=3`
- `AGENT_SHADOW_MAX_TOOL_CALLS=5`
- `AGENT_SHADOW_TIMEOUT_MS=12000`
- `AGENT_SHADOW_MAX_TOKENS=320`
- `AGENT_ROLLOUT_ENABLED=false`：M7 Phase 3 用户可见灰度总开关，默认关闭
- `AGENT_ROLLOUT_COHORT_KEY`：账号 + 会话稳定抽样的 HMAC 密钥；留空时依次回退 Shadow 指纹密钥、`JWT_SECRET`
- `AGENT_ROLLOUT_SAMPLE_RATE=0.1`：开关开启后进入新 Runtime 的稳定会话比例，范围 `0..1`
- `AGENT_ROLLOUT_MAX_STEPS=3`
- `AGENT_ROLLOUT_MAX_TOOL_CALLS=5`
- `AGENT_ROLLOUT_TIMEOUT_MS=12000`
- `AGENT_ROLLOUT_MAX_TOKENS=500`
- 当前没有 `AI_CHAT_DAILY_LIMIT` / `AI_VISION_DAILY_LIMIT` 阻断配置；恢复限额需要另行评审并同时更新前端、服务端与验收合同

影子运行时只登记 `get_account_nickname`、`get_selected_plant`、`search_published_knowledge` 三个只读工具。它不把草稿回复返回给小程序，不写正式任务/档案/日记/诊断，不控制设备，日志只保存 Query 指纹、路由摘要、工具名、结果计数、耗时和错误类别，不保存原始 Query、openid、昵称、植宠内容或模型草稿。

受控灰度在三项只读工具之外登记 `recall_relevant_memories`、`propose_memory_candidate` 和 `propose_care_task`。后两者的副作用等级是 `proposal_only`：只在同一事务内写 `ai_action_proposals`，不写 `ai_memories` 或 `todos`。普通低风险 Query 可以交给 LLM；确定性代码只保留鉴权/owner、知识发布状态、明确任务和记忆意图、参数 schema、工具 allowlist、结果完整性、高风险与确认门禁。任何结果门禁失败都会回落 legacy。

长期记忆闭环是“明确称呼偏好 -> `pending` memory proposal -> 用户确认 -> `ai_memories.user_confirmed=1`”；敏感信息候选会在工具和 API 两侧拒绝。任务闭环是“明确请求 -> `pending` care-task proposal -> 前端预览并编辑 -> `api-scf` 按 owner/状态/过期/PlantPet/字段重新校验 -> 以 proposal key 幂等写入正式任务”。直接调用普通任务创建接口且伪装为 AI 来源会被拒绝。

助手页面对加载会话、文本、图片和文档等异步操作使用 PlantPet + session + epoch scope guard。用户切换 PlantPet、切换会话或离开页面后，旧请求可以在服务端正常收尾，但不得覆盖新页面状态；图片在尚未认领且 scope 已失效时会尝试清理临时媒体。

`AGENT_SHADOW_ENABLED` 和 `AGENT_ROLLOUT_ENABLED` 均默认关闭。以上是本地源码实现状态，不代表已经部署到腾讯云 SCF、体验版或正式版，也不代表完成实体手机或目标云环境验收。

本地聚合服务器可从被 Git 忽略配置中的 `LLM_API_KEY_FILE` 读取仓库外临时凭证；正式 SCF 只使用部署环境中的 `LLM_API_KEY`，不得依赖本机路径。

## Deployment Boundary

本目录不能仅凭“安装依赖、上传文件夹”就宣称完成云部署。目标环境至少还要完成：锁定可复现依赖与 Node 运行时、应用基础 Schema 和 `reference/agent_runtime.m7.sql`、配置正式 JWT/MySQL/模型凭证、迁移私有媒体 provider 及生命周期、设置两个默认关闭的灰度开关，并验证 owner 隔离、proposal 幂等、撤回/裁剪 tombstone、真实 Chat/Vision、冷启动/P95 和回滚。

迁移步骤见 [`docs/local-to-cloud-deployment-guide.md`](../../../docs/local-to-cloud-deployment-guide.md)，初始审查材料见 [`deployment/cloud-initial/`](../../../deployment/cloud-initial/)。二者目前是迁移指南和初版候选，不是已经部署或已通过目标云/体验版/实体手机验收的版本。SCF handler 仍为 `index.main` 或 `index.main_handler`。
