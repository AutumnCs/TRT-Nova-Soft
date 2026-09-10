# 竞赛交付工作区

- 当前分支：competition-local-cloud。只在两个竞赛目录及本分支根交付说明中实施本次工作。
- TRT_Nova_Competition_Local/：竞赛本地版，独立安装、配置、启动和测试。
- TRT_Nova_Competition_Cloud/：竞赛云端版，独立包含前端、SCF 源码、SQL、部署工具和测试；不读取兄弟本地目录。
- 先读取所选竞赛目录的 AGENTS.md。旧 LastScf、V2 等目录继承自 main，仅保留，不修改、不同步。
- 不推送、改写历史或合并 main；实际 push 必须在用户审阅最终变更后获得确认。
- 真实云资源变更使用明确的测试目标；本地构建和测试不得写成云端或真机验收。
