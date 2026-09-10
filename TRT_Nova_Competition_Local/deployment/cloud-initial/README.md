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

`-SkipBuild` 只复用源码、锁文件、策略均一致的当前包；`-NodeExecutable` 可指定兼容测试 Node。构建用调用方 npm，业务/SDK 测试用指定 Node。外部服务使用受控替身，不访问真实微信、模型、SSM 或 COS；依赖安装和漏洞审计需要联网。

## 输出和源码归属

- `artifacts/`：auth、api、agent、ingest、history-cleanup 的 ZIP，RELEASE_MANIFEST.json 与 PACKAGE_POLICY_REPORT.json。
- `build/`：参加测试的函数目录与生成客户端。不能复制整份本机 node_modules 代替构建。
- `state/verification/时间/result.json`：每步真实退出码与日志；失败停在当步。
- `locks/`：每个函数的生产依赖锁。
- `overlays/`：cloud-entry 是环境/事件入口，cloud-secrets 读取 SSM，cloud-media 使用 COS。
- `tools/migrate-database.mjs`：空库、基线增量、只读校验；`tools/seed-reviewed-content.mjs` 导入现有已审核示例知识。
- `scf-manifest.template.yaml`、`function-url-routes.template.yaml`：函数与路由合同。

ZIP 不包含管理后台、本地服务器、测试替身、环境文件、数据库或密钥；ingest 与设备命令默认关闭。客户端快照也排除 local-runtime.js 和测试文件。

## 配置与客户端

```powershell
npm run cloud:render -- --config deployment/cloud-initial/candidate.config.example.json --allow-placeholders
npm run cloud:client -- --config deployment/cloud-initial/candidate.config.example.json --allow-placeholders
```

占位配置只验证结构，不能登录或扫码访问云服务。实际使用时复制为被忽略的 candidate.config.local.json，填资源 ID、域名、模型及 secret:// 引用，去掉 --allow-placeholders。

AppID 只从 auth-scf.WECHAT_APPID 生成；天气关闭不依赖天气秘密，开启须补全参数。公网出口按已核实环境选择 scf-public-network 或 vpc-nat，后者要求 NAT ID。SSM 引用不是密码，也不是已授权的证明。最终环境字节数、目标运行时、路由、层大小与权限以真实云核验为准。

生成目录已存在则拒绝覆盖，重复生成用新的 --out build 子目录。发布前运行：

```powershell
node deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.local.json
```

本机演练对未填写示例的预期退出码是 1，代表正确阻断，不是发布通过。当前证据入口见[竞赛交付记录](../../docs/competition-delivery.md)；不引用原工作树的历史生成文件作为本目录新验收。

## 云端维护注意

- SSM 在冷启动时读取，温实例复用；轮换后更新函数版本或实例，不能把永久密钥打包。
- COS 为私有桶，owner 鉴权、字节数与哈希校验沿用现有实现。上传/删除账本保留重试；每分钟清理任务每次最多处理少量对象。
- 会话和已引用附件不按旧“20 轮/30 天”自动删除。旧 local:// BLOB 不会自动变成 COS 对象。
- MySQL 业务账号与迁移 DDL 账号分离，生产连接校验证书和主机名。
- Auth/API/Agent 预算为 30/45/90 秒，客户端仍为 60 秒；记录冷启动与模型耗时，重试沿用幂等键，不假称消除了超时。
- 这里验证的是产品单测、真实 MySQL + 打包业务路径、SDK 对本机服务的传输。真实 CAM、网络、TLS、微信、模型、天气与手机仍需部署后验证。

