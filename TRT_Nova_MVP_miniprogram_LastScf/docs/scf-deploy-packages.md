# SCF 部署包说明

仓库中当前保留 4 份参考实现：

- `reference/authScf.example.js`
- `reference/scfApi.example.js`
- `reference/ingestScf.lightdb.example.js`
- `reference/historyCleanupScf.example.js`

当前部署包目录：

- `dist/scf/auth-scf`
- `dist/scf/api-scf`
- `dist/scf/ingest-scf`
- `dist/scf/history-cleanup-scf`

每个目录都包含：

- `index.js`
- `.env.example`
- `package.json`
- `README.md`

## 推荐部署顺序

1. `auth-scf`
2. `api-scf`
3. `ingest-scf`
4. `history-cleanup-scf`

## 当前运行时默认地址

当前小程序运行时默认指向：

- `api-scf`: `https://1395114552-hkiu70pwre.ap-shanghai.tencentscf.com`
- `auth-scf`: `https://1395114552-0etc4ugmnu.ap-shanghai.tencentscf.com`

配置位置：

- [app.js](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/app.js)
- [runtime.js](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/services/config/runtime.js)

## 环境变量说明

### `api-scf`

必需：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `JWT_SECRET`

可选：

- `DB_CONN_LIMIT`
- `DEBUG_OPENID`

注意：

- `DEBUG_OPENID` 仅用于临时验证
- 当前真实登录已经跑通，不应长期依赖该值

### `auth-scf`

必需：

- `WECHAT_APPID`
- `WECHAT_SECRET`
- `JWT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

可选：

- `TOKEN_EXPIRES_IN_SECONDS`
- `DB_CONN_LIMIT`

### `ingest-scf`

必需：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `ONE_NET_TOKEN`

可选：

- `ONE_NET_AES_KEY`
- `DB_CONN_LIMIT`

### `history-cleanup-scf`

必需：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

可选：

- `DB_CONN_LIMIT`
- `RAW_RETENTION_DAYS`
- `AGG_5M_RETENTION_DAYS`
- `AGG_1H_RETENTION_DAYS`
- `AGG_1D_RETENTION_DAYS`

## 当前 OneNET 侧结论

当前已验证成功的链路是：

- OneNET 数据推送 -> `NovaTry` -> `ingest-scf`

当前**未**验证成功的链路是：

- OneNET 规则引擎裁剪推送 -> `ingest-scf`
