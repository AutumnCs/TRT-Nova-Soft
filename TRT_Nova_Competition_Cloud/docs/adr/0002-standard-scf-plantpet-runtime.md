---
status: accepted
---

# 参赛版在标准 SCF 中使用最小 PlantPet Runtime

M7 参赛版继续使用腾讯云标准 Node 20 SCF，在现有 `agent-scf` 内实现与 PI 的 Agent loop、tool、event 和 context 边界兼容的最小 `PlantPetRuntime`，而不直接安装要求 Node 22.19 以上的 PI Core，也不为参赛版新增 Custom Runtime 或镜像部署。该选择保留未来替换 runtime adapter 的边界，同时避免把部署方式、运维面和未使用的 provider 依赖一并扩大。

## Consequences

- Phase 2 先以默认关闭的只读影子轮次验证三个工具和模型协议，不接管回复。
- MySQL、业务对象和已发布知识仍是事实源；runtime 不成为第二份持久化真相。
- 正式任务、档案、记录和设备动作继续留在 Agent 工具权限之外。
- 若以后改用官方 PI Core，必须重新验证 Node 运行时、完整部署包、DeepSeek 协议、冷启动和回滚，不得把本地兼容测试等同于云端支持。
