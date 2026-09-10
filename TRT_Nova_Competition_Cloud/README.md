# TRT Nova 竞赛云端版

源码交付只带 Git 可提交文件；不携带 node_modules、.env.local、.runtime、个人开发者工具配置或旧构建产物。接收方按本文重新安装与生成本机/云环境配置。

本目录是独立的云端源码与部署工具包。小程序、SCF 后端、数据库迁移、依赖锁、配置模板和测试都在本目录内；可单独复制构建，不读取本地版或旧项目目录。

部署路线沿用 LastScf 的混合架构：**业务后端用腾讯云 SCF，业务数据存 MySQL，图片用小程序 CloudBase 云存储**。文档附件也使用同一云开发存储；环境变量直接在 SCF 配置。CloudBase 不承接业务云函数或数据库。

当前已接入隔离 staging，完成单账号真实云业务、模型、附件、已审核知识发布和自然清理检查。2026-09-10 修复登录资料被旧微信资料接口覆盖的问题，进入团队试测；双真实账号和更完整的手机交互仍待验证。入口与已知问题见[团队试测说明](./docs/team-testing.md)。

## 交付内容

| 位置 | 用途 |
|---|---|
| app.*、pages/、services/、components/ | 最新小程序源码，默认云地址为不可用占位域名 |
| dist/scf/ | 本目录自己的后端源码；构建时应用 cloud-initial/overlays |
| deployment/cloud-initial/artifacts/ | 构建生成的 5 个 ZIP、SHA-256 清单及包策略报告 |
| deployment/cloud-initial/build/miniprogram/ | 按目标配置生成的独立云客户端 |
| deployment/cloud-initial/locks/ | 各函数冻结依赖 |
| deployment/cloud-initial/tools/ | 配置、客户端、迁移、知识种子与发布检查 |
| scripts/、各模块的 test/、docs/ | 可复现测试和交接资料；不进入函数 ZIP |

5 个包是 auth、api、agent、ingest、history-cleanup。保留的 admin 源码和本地演练设施不在发布包；ingest 和设备写入默认关闭，不因构建了包就开放硬件能力。

## 本机构建与演练

需要 Node.js 20.19 或更新版本、PowerShell 7 和 MySQL 8。在本目录打开终端：

```powershell
npm ci --ignore-scripts --no-audit --no-fund

# 如没有隔离 MySQL，可用本目录自带助手启动；改为你的安装目录。
pwsh -NoProfile -File scripts/local-db/isolated-mysql.ps1 -Action start -MySqlHome 'D:\MySQL\mysql-8.0' -Port 3308
$env:NOVA_TEST_MYSQL_PORT = '3308'
npm run cloud:rehearse
```

完整演练包含构建、源码比对、产品回归、微信文件 HTTP 协议的本机传输、真实独立 MySQL 场景、包扫描、依赖审计及发布负向检查。外部微信/模型/CloudBase 使用受控测试替身，不会调用真实云服务。安装 npm 依赖与漏洞审计需要网络。

数据库账号可通过 `NOVA_TEST_MYSQL_USER` / `NOVA_TEST_MYSQL_PASSWORD` 安全注入；测试每次新建 `nova_cloud_test_时间戳` 数据库并保留，不覆盖旧库。隔离 MySQL 助手仅供本机合成测试，root 无密码但仅绑定 loopback，不用于真实数据。

只构建使用 `npm run cloud:build`；已有包且源码未变可用 `npm run cloud:rehearse -- -SkipBuild`。源码不一致会被阻断。指定兼容测试 Node 可加 `-NodeExecutable <node.exe>`；本机兼容性不代表腾讯云目标运行时已通过。

## 接上目标云环境

```powershell
Copy-Item deployment/cloud-initial/candidate.config.example.json deployment/cloud-initial/candidate.config.local.json

# 填好资源与三个函数地址后，不使用 --allow-placeholders。
npm run cloud:render -- --config deployment/cloud-initial/candidate.config.local.json
npm run cloud:client -- --config deployment/cloud-initial/candidate.config.local.json
```

只在被忽略的 local 配置填非秘密信息，秘密值直接在 SCF 控制台配置：

- 入口复用 LastScf 的三个独立 Function URL：填 ingress.functionUrls 下的 auth-scf、api-scf、agent-scf；处理函数均为 index.main_handler。
- AppID 以 plainEnvironment.auth-scf.WECHAT_APPID 为唯一来源。WECHAT_SECRET、JWT_SECRET、DB_USER、DB_PASSWORD 及实际启用的模型/天气密钥只填 SCF 环境变量，不填 JSON、源码或客户端。
- 数据库暂按已确认的旧 LastScf 链路直连：DB_TLS_MODE=legacy-direct，不启用 TLS；主机和端口填入本地部署配置，业务仍使用独立新库。不要求新建 NAT。private-network 和 required 保留但当前不选用；恢复 TLS 时设 required 并按需配置 CA，不自动降级。
- 附件配置为 media.mode=cloudbase，加上本项目 envId、region、prefix。图片和文档都由 wx.cloud.uploadFile 上传，SCF 核验后登记；业务仍用 useCloudBase=false。
- 天气默认关闭；启用后补齐 host/project/credential ID，在 API 函数配置私钥。
- render 输出每函数的公开环境值和 requiredSecretEnvironment 变量名清单，不读取秘密。最终环境字节数须在控制台按实际值核对，不能把公开配置字节数当作最终值。

生成客户端分别使用三个目标 HTTPS 函数地址并开启校验。不要直接上传根目录的占位客户端。重复生成需指定新的 `--out deployment/cloud-initial/build/<新目录>`；不会覆盖已有快照。

服务分工见[云端部署架构](./docs/lastscf-deployment-reuse.md)。实际部署顺序与验收表见[云资源接入指南](./docs/local-to-cloud-deployment-guide.md)。先核实可用的现有资源、隔离命名和权限，再部署、运行云上检查；不默认覆盖旧函数、生产库或旧客户端。

## 发布与当前状态

```powershell
node deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.local.json
```

没有真实云证据时，发布检查必须保持失败；不要手填确认项使它通过。构建清单在 artifacts/，每轮演练的真实退出码和日志在 state/verification/本次时间/result.json。当前实测见[竞赛交付记录](./docs/competition-delivery.md)。

真实微信登录、CloudBase 环境权限与生命周期、云数据库连接、Function URL 路由、公网出站、真实模型/天气、微信合法域名及实体手机均不由本机测试代替。历史用户数据与本地 BLOB 没有自动迁移。

保留四 Tab、会话、附件、摘要及确认后创建任务。账号与植宠数据按归属隔离，设备写入默认关闭。
