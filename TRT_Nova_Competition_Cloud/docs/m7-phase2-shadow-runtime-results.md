# M7 Phase 2 只读 Shadow Runtime 结果

> 历史/目标文档提示（2026-09-08）：本文保留该阶段的配置、调研或实施记录，不作为当前能力与验收状态清单。旧记忆、额度、rollout 和云端结论如与后续版本不同，以当前入口为准。 当前产品见[先看这里](./先看这里.md)，技术事实见[当前架构](./current-architecture.md)。

> 日期：2026-09-03
> 状态：Phase 2 本地代码与真实模型探针通过；未接管生产回复
> 路线：标准 SCF Node 20 + PI 语义兼容的最小 `PlantPetRuntime`

## 1. 本轮实现边界

Phase 2 在 `dist/scf/agent-scf/runtime` 新增每请求运行一次的最小 Agent loop，并通过 `AGENT_SHADOW_ENABLED` 接到现有 `chatHandler` 外层。开关默认 `false`。开启后，Shadow 与 legacy 请求并行开始，等待二者完成后只记录脱敏差异，HTTP 返回仍是原 legacy 对象。

当前只允许三个工具：

| 工具 | 数据范围 | 副作用 |
|---|---|---|
| `get_account_nickname` | 当前 JWT/openid 对应账号；模型参数不含 openid | 无 |
| `get_selected_plant` | 当前会话已选植宠；owner 和 ID 由后端闭包注入 | 无 |
| `search_published_knowledge` | `published` 植物图鉴和知识文章 | 无 |

工具 schema 不含任意账号 ID、任意植宠 ID、SQL、任务写入或设备控制。正式任务、档案、日记、诊断、记忆和设备动作没有注册为 Shadow 工具。

植物知识检索当前采用每轮策略预检，而不是等待模型自行选择。这保证植物知识问题不会因模型漏调工具而跳过 RAG，但也会让问候和简单常识多一次本地只读检索；Phase 3 前必须结合真实 P50/P95 决定是否保留全量预检或换成不切断模型的低成本能力选择器。

账号昵称只对一小组明确的“我是谁/我叫什么/账号昵称”问法由窄能力策略强制读取。该策略只决定必须补充的只读事实，不决定 Query 是否允许回答，不删除历史，也不替代 LLM 回复。

## 2. 隐私与审计

Shadow 日志仅包含：

- HMAC Query 指纹；
- legacy route/intent/是否使用模型/知识来源数/候选数；
- Shadow 状态、模型步数、工具名、调用来源、命中计数、耗时和错误类别。

日志不包含原始 Query、openid、昵称、植宠内容、知识正文、模型草稿或密钥。建议配置独立 `AGENT_SHADOW_FINGERPRINT_KEY`；留空时回退 `JWT_SECRET`。没有可用密钥时 Shadow 启动失败关闭，不降级为无盐消息哈希。

## 3. 测试中真实发现并修复的问题

第一次真实 provider 探针失败：thinking 模式的模型在工具调用后要求把 `reasoning_content` 与 assistant tool call 一并回灌。适配器最初只保留 `tool_calls`，第二轮被 API 拒绝。现已按原值回灌，并加入回归测试。

第二次仍失败：策略预检被错误伪装成 assistant tool call，因此也触发了 reasoning 回灌要求。现已把它作为明确标记的非可信策略资料块注入，不再冒充模型行为；真正的模型 tool call 才使用 assistant/tool 消息协议。

协议修复后的第一轮完整探针虽然 5/5 完成，但模型在通用植物知识和身份场景额外读取了不必要的昵称或当前植宠。工具描述和系统策略随后加入最小数据访问约束，评测也增加 `unexpectedPrivateToolCases` 硬失败项。

最终真实探针结果：

```text
total                         5
completed                     5
missingExpectedToolCases      0
unexpectedPrivateToolCases    0
blockedOrFailedToolCalls      0
persistedBusinessWrites       0
```

覆盖场景：问候、账号身份、月季浇水、当前植宠状态和简单算术。使用当前本地真实 Chat provider，但账号、植宠为内存测试夹具，知识只走发布数据/种子回退，不连接业务 MySQL，不保存模型草稿。

单场景本地墙钟约 1.0–5.5 秒，其中当前植宠状态需要两次模型步。它不是腾讯云 SCF P95，也没有包含真实 MySQL 网络延迟；全量知识预检和多步工具循环的性能仍是 Phase 3 前置闸门。

证据：`evals/m7-agent/shadow-provider-probe.latest.json`。

## 4. 验证结果

- Shadow runtime 专项测试：12/12；
- Shadow + 相关 Agent/RAG/身份/legacy 聚焦回归：188/188；
- 产品合同结构测试：5/5；
- legacy 冻结基线：42 条可重复验证；
- 仓库全量单元/合同回归：332/332；
- `node --check`：新增与接入 JS 全部通过；
- 五个 SCF 部署目录构建检查与 AI 上下文检查通过；
- 真实 provider 探针：5/5，0 缺失工具、0 非必要私有工具、0 工具失败、0 业务写入。

## 5. 尚未实现或尚未证明

- Shadow 默认关闭，当前用户体验仍完全由 legacy 正则工作流产生；
- 没有把 Shadow 草稿返回给前端，没有任何流量切换；
- 没有接入 `get_recent_device_facts`、长期记忆或任务候选工具；
- 没有实现新的 Session/Memory 投影，Phase 4 仍未开始；
- 没有在真实腾讯云 SCF、真实云 MySQL或实体设备上测量 P95/冷启动；
- 没有证明五个场景可以代表完整 42 条产品合同，进入 Phase 3 前仍需扩大 shadow corpus；
- `Promise.race` 只负责运行时结算；底层 HTTP 请求仍以 `requestJson` 自身超时销毁连接，不能宣称通用可取消流式运行时已经完成。

## 6. 下一闸门

Phase 3 会让部分真实用户回复改由新 runtime 生成，属于用户可见行为切换，不能由 Phase 2 自动授权。进入前至少需要：扩大真实 Shadow 语料、记录 P50/P95 与模型轮数、决定知识预检成本策略，并明确灰度开关与 legacy 回滚条件。

> 后续状态（2026-09-03）：用户已经单独授权 Phase 3。上述前置项已通过 42 场景真实 provider 探针、按需植物知识预检、稳定会话抽样和单开关 legacy 回滚实现；结果见 `docs/m7-phase3-controlled-rollout-results.md`。本页继续保留为 Phase 2 当时的历史证据。
