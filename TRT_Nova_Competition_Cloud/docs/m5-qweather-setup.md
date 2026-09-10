# M5 和风天气本地配置与验证记录

更新日期：2026-08-28

当前状态：团队和风天气项目、JWT 凭据和本地 Ed25519 密钥对已经由用户本人准备并完成一致性核验；M5 已完成本地后端真实天气读取、30 分钟缓存、数据库最小持久化以及微信开发者工具端到端验证。线上资源仍保持只读，本阶段没有部署或写入腾讯云、CloudBase、微信后台。

## 1. 已确认的非敏感资源标识

- 专属 API Host：`q54nmvxnte.re.qweatherapi.com`
- Developer ID：`Q0A0D6E06A`
- Project ID：`26E5G8CG69`
- Credential ID：`CD5BE79QKH`
- JWT 凭据名称：`1`
- 控制台公钥 SHA256：`611124581bb9b65dbdcd61247eaa7bbbd861f118a1af19719181e37048ef447b`

密钥文件位于仓库外：

- 私钥路径：`C:\Users\wzf666\.plant-pet-secrets\qweather\qweather-ed25519-private.pem`
- 公钥路径：`C:\Users\wzf666\.plant-pet-secrets\qweather\qweather-ed25519-public.pem`

只记录路径，不在本文、源码、Git、聊天或日志中记录私钥正文。侧会话已经只读确认两个文件均存在、私钥导出的公钥与公钥文件匹配，且统一为 LF 后的公钥 SHA256 与控制台值一致。

## 2. 本地配置位置与读取边界

真实标识和私钥路径只配置在被 Git 忽略的项目根目录 `.env.local`。可提交的 `.env.local.example` 只保留空标识和路径格式示例。

本地服务器启动时由 `scripts/local-server/server.js` 读取 `QWEATHER_PRIVATE_KEY_FILE` 指向的仓库外文件，只把私钥交给当前进程中的 Ed25519 JWT 签名逻辑；小程序包、API 响应和日志均不包含私钥。`dist/scf/api-scf/lib/qweather-client.js` 使用专属 API Host、Credential ID 和短期 JWT 调用城市检索与实时天气接口。

本地启用项为：

```dotenv
QWEATHER_ENABLED=true
QWEATHER_API_HOST=q54nmvxnte.re.qweatherapi.com
QWEATHER_DEVELOPER_ID=Q0A0D6E06A
QWEATHER_PROJECT_ID=26E5G8CG69
QWEATHER_CREDENTIAL_ID=CD5BE79QKH
QWEATHER_PRIVATE_KEY_FILE=C:/Users/wzf666/.plant-pet-secrets/qweather/qweather-ed25519-private.pem
QWEATHER_TIMEOUT_MS=5000
```

这里记录的只有路径，没有 PEM 正文；`.env.local` 不进入 Git。

## 3. 真实读取与缓存验证结果

2026-08-27 23:54（Asia/Shanghai）按以下链路完成验证：

1. 通过本地 `/auth/login` 取得受保护接口身份，没有用 `/dev/token` 代替登录。
2. `/weather/cities` 真实检索“北京”，返回北京 `LocationID=101010100`。
3. `/weather/preference` 保存城市后，数据库长期字段只有 LocationID、城市、行政区和选择来源，不保存精确经纬度。
4. `/weather/summary` 从和风天气读取到：阴、23.73°C、体感 24.69°C、湿度 67%、西风 2 级，来源为“和风天气”，并带 1 个来源链接。
5. 紧接着第二次读取的 `fetchedAt` 与第一次完全一致，`cacheState=fresh`、`ageMinutes=0`；数据库缓存的失效时间比抓取时间晚 30 分钟，证明命中服务端 30 分钟缓存。
6. 微信开发者工具从真实本地登录契约开始，首页显示四舍五入后的 24°、阴、湿度 67%、西风 2 级、更新时间和来源；天气城市页显示当前北京并能真实搜索候选，未出现运行时异常。

验收截图：

- `D:\植宠项目\验收记录\M5_2026-08-27\03-real-weather-home.png`
- `D:\植宠项目\验收记录\M5_2026-08-27\04-real-city-settings.png`

此前无凭据降级路径也已单独验证：未设置城市或未配置凭据时不生成示例温度，分别展示明确不可用原因。

## 4. 重复配置方法

如未来需要轮换凭据，可在新的空目录生成 Ed25519 密钥对：

```powershell
cd 'D:\植宠项目\TRT-Nova-Soft\.worktrees\wechat-prd-v0.1\TRT_Nova_MVP_miniprogram_LastScf'
npm run qweather-generate-keypair -- 'C:\Users\<username>\.plant-pet-secrets\qweather-next'
```

脚本只输出生成路径，不输出私钥正文；目标文件已存在时会拒绝覆盖。把新公钥上传到和风天气控制台、创建或更新 JWT Credential 后，再替换本地标识和私钥路径。不要通过删除未知旧私钥来重试。

## 5. 迁移到云后端时必须处理

当前从本机绝对路径读取私钥属于本地化妥协 `LC-09`。进入 M8 或任何更早的云后端切换时必须：

1. 不把 `.env.local` 或本机 `.pem` 文件复制进源码、Git、小程序包、SCF 部署包或普通日志。
2. 在获准的目标云环境中通过环境变量或密钥管理提供 `QWEATHER_PRIVATE_KEY`；同时配置 Host、Project ID、Credential ID 和启用开关，停止依赖 `QWEATHER_PRIVATE_KEY_FILE` 的本机路径。
3. 如果团队不希望在云端复用当前私钥，则先在控制台创建新的 JWT Credential 和密钥对，再切换 Credential ID；不得静默生成或替换线上凭据。
4. 在目标环境重新执行真实登录、城市检索、天气读取、30 分钟缓存、超时/陈旧缓存和来源展示验证。
5. 检查部署包、前端包、Git 历史和运行日志不包含私钥正文，并确认本地密钥文件按团队决定保留、轮换或安全处置。

线上当前仍只读，以上迁移动作尚未执行，也不属于 M5 本地验收的已完成事项。
