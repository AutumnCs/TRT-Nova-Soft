# 云函数构建与本机演练

本目录从**本项目自己的** `dist/scf` 与小程序源码生成交付物，不读取同仓库其他版本。产品入口见[项目 README](../../README.md)，真实资源操作见[部署指南](../../docs/local-to-cloud-deployment-guide.md)。

## 常用命令

在包含 app.js、package.json 的项目根目录运行：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
$env:NOVA_TEST_MYSQL_PORT = '3308'
npm run cloud:rehearse
```

完整演练会构建 5 个函数 ZIP；需要可用的本机 MySQL，账号通过 NOVA_TEST_MYSQL_USER / NOVA_TEST_MYSQL_PASSWORD 安全注入。每轮创建独立 nova_cloud_test_时间戳 数据库并保留，不删除现有数据。可用本项目 scripts/local-db/isolated-mysql.ps1 启动仅用于合成测试的实例。

`-SkipBuild` 只复用源码、锁文件、策略均一致的当前包；`-NodeExecutable` 可指定兼容测试 Node。构建用调用方 npm，业务/微信 HTTP 测试用指定 Node。外部服务使用受控替身，不访问真实微信、模型或 CloudBase；依赖安装和漏洞审计需要联网。

## 输出和源码归属

- `artifacts/`：auth、api、agent、ingest、history-cleanup 的 ZIP，RELEASE_MANIFEST.json 与 PACKAGE_POLICY_REPORT.json。
- `build/`：参加测试的函数目录与生成客户端。不能复制整份本机 node_modules 代替构建。
- `state/verification/时间/result.json`：每步真实退出码与日志；失败停在当步。
- `locks/`：每个函数的生产依赖锁。
- `overlays/`：cloud-runtime 在原 index.main_handler 内校验配置；cloud-media 管理附件登记与清理；cloudbase-storage 通过微信 HTTP API 操作云开发存储。
- `tools/migrate-database.mjs`：空库、基线增量、只读校验；`tools/seed-reviewed-content.mjs` 导入现有已审核示例知识。
- `scf-manifest.template.yaml`、`function-url-routes.template.yaml`：函数与路由合同。

ZIP 不包含管理后台、本地服务器、测试替身、环境文件、数据库或密钥；ingest 与设备命令默认关闭。客户端快照也排除 local-runtime.js 和测试文件。

## 配置与客户端

```powershell
npm run cloud:render -- --config deployment/cloud-initial/candidate.config.example.json --allow-placeholders
npm run cloud:client -- --config deployment/cloud-initial/candidate.config.example.json --allow-placeholders
```

占位配置只验证结构，不能登录或扫码访问云服务。实际使用时复制为被忽略的 candidate.config.local.json，填资源 ID、三个函数地址及模型名；秘密只在 SCF 配置，去掉 --allow-placeholders。

AppID 只从 auth-scf.WECHAT_APPID 生成；天气关闭不依赖天气秘密，开启须补全参数。网络沿用旧 LastScf 实際控制台设置，不要求新建 NAT。生成文件只列秘密变量名，不带值。最终环境字节数、目标运行时、路由、层大小与权限以真实云核验为准。

生成目录已存在则拒绝覆盖，重复生成用新的 --out build 子目录。发布前运行：

```powershell
node deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.local.json
```

本机演练对未填写示例的预期退出码是 1，代表正确阻断，不是发布通过。当前证据入口见[竞赛交付记录](../../docs/competition-delivery.md)；不引用原工作树的历史生成文件作为本目录新验收。

## 云端维护注意

图片和文档沿用 LastScf 的小程序云开发存储，业务仍是 SCF + MySQL。media.mode=cloudbase；/media/upload 校验并准备路径，wx.cloud.uploadFile 上传，/media/complete 验证后登记。CloudBase 不承接业务云函数或数据库。

media.envId/region/prefix 必须明确指向本项目环境。前端 mediaStorageProvider=cloudbase 与业务 useCloudBase=false 分离。cloudbase-media.sql 为清理账本补齐 provider、上传元数据和删除触发器。

- 各函数按 LastScf 方式直接读取 SCF 环境变量，处理函数为 index.main_handler。渲染器只生成公开值、秘密变量名和公开值字节数；最终 4 KiB 配额须包含控制台实际秘密值。
- SCF 文件操作使用同一小程序 AppID/AppSecret 调用 stable_token 及微信 tcb 文件 API。正常模式 token 仅缓存在当前服务端实例，不传客户端。
- 云开发环境必须绑定当前 AppID；验证存储规则、微信服务端 IP 白名单要求和 SCF 对该环境的文件访问。不能用公开读写来解决权限问题。
- 会话和已引用附件没有 20 轮/30 天自动删除。未完成上传保留 24 小时宽限；旧 local:// BLOB 或其他旧存储数据不自动迁移。
- MySQL 当前使用 legacy-direct，沿用已核实的旧实例直连方式，不传入 SSL 配置；按用户要求复用现有数据库账号，不新建账号或修改授权，新旧业务分库。private-network 和 required 保留但暂不选用：前者仅用于已核实的可信私网，后者启用 TLS 并保持证书与主机名校验。主机填入 candidate.config.local.json；公网非 TLS 不是私网或 TLS 验收通过，同账号分库也不代表数据库账号权限隔离。
- Auth/API/Agent 服务端预算为 30/45/90 秒，客户端仍为 60 秒；需实测冷启动和慢模型，重试沿用幂等键。
- 本机测试不代表真实云网络、权限、模型、天气或手机通过。服务分工见[部署架构](../../docs/lastscf-deployment-reuse.md)。
