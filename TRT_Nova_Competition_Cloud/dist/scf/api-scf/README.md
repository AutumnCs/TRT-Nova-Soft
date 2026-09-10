# api-scf

微信小程序业务 API -> MySQL / OneNET / 条件性外部服务。

M6 中 `api-scf` 继续作为唯一业务写入边界：

- `/ai/diagnoses`、`/ai/diagnosis-save`、`/ai/diagnosis-correct`、`/ai/diagnosis-delete`
- `/ai/memories`、`/ai/memory-create`、`/ai/memory-update`、`/ai/memory-delete`、`/ai/memory-clear`
- AI 任务候选仍沿既有 `/care/task-create`，且必须由用户确认
- 所有 owner 和 PlantPet 访问权只来自 JWT openid

## Files

- `index.js`: SCF entry file
- `.env.example`: environment variable template
- `package.json`: deploy-time dependencies
- `lib/ai-records.js`: diagnosis and structured-memory persistence

## Deploy

1. Run `npm install` in this folder
2. Fill the SCF environment variables in Tencent Cloud console
3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`

