# M7 PI Agent Core Spike results

> 执行日期：2026-09-03
> 状态：Phase 0 与 Phase 1 完成；未进入 Shadow Runtime
> 边界：未读取密钥，未调用付费模型，未连接 MySQL，未执行业务写入

## 1. 输入版本与环境

| 项目 | 实测值 |
|---|---|
| PI 官方仓库 `origin/main` | `4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057`，提交时间 2026-09-02 |
| npm `@earendil-works/pi-agent-core` | `0.84.4` |
| 包模块类型 | ESM |
| 包声明的 Node 支持线 | `>=22.19.0` |
| 当前 `agent-scf` | CommonJS，未声明 `engines` |
| 本机默认 Node | `v24.16.0` |
| PI 最低支持版本测试 | `v22.19.0` |
| 腾讯云标准 SCF 对照版本 | `v20.19.0` |

腾讯云官方 Node.js 环境说明当前列出的最新标准运行时为 Node.js 20.19，没有 Node.js 22：
<https://cloud.tencent.com/document/product/583/11060>

## 2. Phase 0：产品合同与 legacy 基线

新增 42 条产品级场景，覆盖：

- 问候、标点变体和伙伴半径；
- 账户昵称、称呼偏好和跨会话记忆；
- 植物知识、当前植宠、知识无命中；
- 明确、模糊、否定和“不要忘了”任务表达；
- 图片与当前植宠不一致；
- 编程、数学、金融等能力边界；
- 农药、误食、跨账号和附件提示词注入。

产品合同校验结果：

```text
tests 5
pass 5
fail 0
```

旧 M6 路由与记忆回归结果：

```text
tests 176
pass 176
fail 0
```

42 条 M7 产品场景在 legacy 路由中的实际分布：

| legacy 调用路径 | 数量 |
|---|---:|
| 固定回答，绕过模型 | 13 |
| 受限 LLM，不携带历史或私有上下文 | 12 |
| 完整 LLM 路径 | 17 |

与 M7 产品合同的结构性差异：

| 差异 | 数量 |
|---|---:|
| 产品要求模型表达，但 legacy 绕过模型 | 13 |
| 产品要求有效会话分支，但 legacy 抑制历史 | 25 |
| 产品目标需要工具循环，但 legacy 不在完整 LLM 路径 | 6 |

这组数据只说明旧合同与新产品合同不同。它不把所有固定回答自动判定为安全漏洞，也不把确定性读取账号昵称误报为“能力不存在”。

复现命令：

```powershell
node --test dist/scf/agent-scf/test/intent-router-corpus.test.js dist/scf/agent-scf/test/m6-chat-memory.test.js
node --test evals/m7-agent/product-contract.test.mjs
node evals/m7-agent/run-legacy-baseline.mjs
```

## 3. Phase 1：隔离 PI Core 行为验证

Spike 共 6 项：

1. CommonJS 入口通过缓存的 ESM bridge 加载 PI Core；
2. 读取当前植宠 → 生成任务候选 → 最终回复的两步工具循环；
3. 非法工具参数在应用工具执行前被 schema 拒绝；
4. 合法参数的正式写工具仍可被 `beforeToolCall` 阻止；
5. runtime 可设置已完成 turn 数上限；
6. runtime deadline 可中止模型响应，并最终发出 `agent_end`。

三组本地运行结果：

| Node | 测试结果 | 总测试耗时 | PI Core + compat 冷导入单次样本 |
|---|---:|---:|---:|
| 24.16.0 | 6/6 | 440–452 ms（温态连续 3 次） | 510 ms（重装依赖后样本） |
| 22.19.0 | 6/6 | 410–438 ms（直接执行，多轮复测） | 307 ms（重装依赖后样本） |
| 20.19.0 | 6/6 | 565–580 ms（温态连续 3 次） | 453 ms（重装依赖后样本） |

Node 20.19 的通过表示当前已测试路径能够执行，不表示 PI 官方支持 Node 20。未覆盖的 provider、streaming、重试和后续版本仍可能使用 Node 22 才支持的能力。

一次通过 `npx` 临时执行包装器启动 Node 22 时，测试报告出现约 21.6 秒的进程尾延迟；重装依赖后的首轮直接测试也出现过约 4.2 秒耗时。随后解析出同一缓存 Node 22.19.0 可执行文件并多轮直接复测，温态测试自身耗时稳定在 410–438 ms，墙钟耗时均低于 0.5 秒。因此当前没有证据表明 Spike 持续遗留活动句柄，但单次本机样本有明显冷态/包装器抖动，不能作为 SCF 冷启动或 P95 指标。

复现命令：

```powershell
cd spikes/m7-pi-agent-core
npm install --ignore-scripts
npm test
npx --yes -p node@22.19.0 node --test spike.test.mjs
npx --yes -p node@20.19.0 node --test spike.test.mjs
npx --yes -p node@22.19.0 node measure-import.mjs
npx --yes -p node@20.19.0 node measure-import.mjs
```

## 4. 依赖与部署体积

| 指标 | 实测值 |
|---|---:|
| 安装生产依赖 | 93 个包 |
| 隔离 `node_modules` 文件数 | 10,721 |
| 隔离 `node_modules` 解压体积 | 58.49 MiB |
| Spike 独立 zip 体积 | 14.70 MiB |
| 当前 `agent-scf/node_modules` 解压体积 | 36.93 MiB |

PI Core 会依赖完整 `pi-ai` 包；原始安装树中包含 Anthropic、AWS Bedrock、Google 和 OpenAI 等当前 NOVA 不需要的 provider SDK。引入生产函数前应评估 bundling/tree-shaking，不能把 58.49 MiB 直接当作不可避免的最终增量，也不能假设构建器一定能删除这些依赖。

腾讯云官方限制为单函数压缩前最多 500 MB，控制台直接上传 zip 小于 50 MB；本次隔离 Spike 没有触及限制，但尚未构建包含现有 `agent-scf` 的完整生产包：
<https://cloud.tencent.com/document/product/583/11637>
<https://cloud.tencent.com/document/product/583/73923>

依赖安全审计：

- 默认 `npmmirror` 不实现 npm audit API，第一次返回 404；
- 改用 npm 官方 registry 后退出码为 0，报告 0 个已知漏洞；
- 该结果只覆盖当前 lockfile 和 npm advisory 数据，不代替代码审查。

## 5. 已证实与未证实

已证实：

- PI Core 可以承载 NOVA 所需的多步只读/候选工具循环；
- schema 校验和 `beforeToolCall` 可以阻止应用工具执行；
- CommonJS 可以通过缓存的 ESM bridge 调用 PI Core；
- Node 22.19 是官方支持路径；
- 当前测试子集在 Node 20.19 上也能运行；
- 依赖体积和冷导入成本不可忽略，但低于 SCF 代码体积上限。

未证实：

- 腾讯云标准 SCF 对 Node 22 的支持；官方列表目前没有 Node 22；
- Windows 本地结果等同于 CentOS SCF 结果；当前机器没有可用 Docker CLI，未完成 Linux 容器复现；
- DeepSeek 真实 streaming/tool replay 与 PI 的完整兼容性；本 Spike 故意未调用付费 provider；
- 完整 `agent-scf` 合包后的 zip、冷启动、内存和 P95；
- PI Core 在 Node 20 上的长期、全 API 和升级兼容性；
- Shadow Runtime 的 MySQL 会话投影与业务只读工具。

## 6. Phase 1 结论与下一闸门

不建议在腾讯云标准 Node 20.19 函数中直接把 PI 官方包作为受支持的生产依赖，即使当前 6 项测试通过。原因是它违反上游明确的 Node 支持线，后续升级风险无法由本项目测试完全覆盖。

下一阶段有三条路线：

| 路线 | 说明 | 代价与风险 | 建议 |
|---|---|---|---|
| A. 标准 SCF Node 20 + PlantPet 最小兼容 runtime | 复用 PI 的 Agent/tool/event/context 接口思想，自行实现当前产品所需的窄 loop；保留未来 PI adapter 边界 | 需要维护一小段内部 runtime，但部署路径不变 | **推荐用于参赛 v0.1** |
| B. SCF Custom Runtime/镜像 Node 22 + 官方 PI Core | 直接使用官方包支持线 | 新部署方式、镜像/运行时维护、冷启动与运维面扩大 | 适合后续平台化，当前需单独批准 |
| C. 标准 SCF Node 20 + 官方 PI Core | 依赖当前“测试能跑” | 上游不支持，升级或未覆盖路径可能破坏运行 | 不推荐 |

推荐先选择 A：建立与 PI 心智模型一致、但只包含 NOVA 所需能力的 `PlantPetRuntime` 接口；Phase 2 用只读 Shadow Runtime 验证上下文和工具决策。这样不丢失未来切换到官方 PI Core 的适配点，也不为比赛版本引入新的云部署单元。

用户随后确认路线 A，Phase 2 已在现有标准 SCF 代码中实现 PI 语义兼容的最小只读 Shadow Runtime。该决定和 Phase 2 结果见 `docs/adr/0002-standard-scf-plantpet-runtime.md` 与 `docs/m7-phase2-shadow-runtime-results.md`；本文件中的 PI Core 数据仍是 Phase 1 隔离 Spike 证据。
