# TRT Nova 竞赛本地版

源码交付只带 Git 可提交文件；不携带 node_modules、.env.local、.runtime、个人开发者工具配置或旧构建产物。接收方按本文重新安装与生成本机/云环境配置。

本目录可以单独复制运行，不依赖同仓库的旧项目或云端版目录。默认连接本机 MySQL 和本地 Node 服务，用于开发者工具演示、接口回归和后续开发。

产品仍是四个 Tab：花园、AI 助手、日历、我的。植宠、养护任务、成长日记、会话、附件和记忆沿用现有实现；AI 建议必须经用户确认才写入正式任务。

## 第一次运行

需要 Node.js 20.19 或更新版本、PowerShell 7、MySQL 8，以及微信开发者工具。在本目录打开终端：

```powershell
npm ci --ignore-scripts --no-audit --no-fund

# 生成本机配置、随机数据库密码和 JWT 密钥；已有配置不会覆盖。
npm run local:setup -- --db-port=3308 --port=3130

# 仅在没有可用的隔离 MySQL 时启动；参数换成你的 MySQL 安装目录。
pwsh -NoProfile -File scripts/local-db/isolated-mysql.ps1 -Action start -MySqlHome 'D:\MySQL\mysql-8.0' -Port 3308

# 只初始化这个新库；已有业务表会拒绝，绝不 DROP/重建。
npm run local:db:init -- --confirm-database=nova_competition_local
npm run local:start
npm run local:status
```

隔离 MySQL 助手只启动绑定 127.0.0.1 的合成测试实例，不安装 Windows 服务、不改系统数据库。数据保留在本目录 `.runtime/isolated-mysql-3308/data`，为兼容 Windows 中文路径使用临时目录中的英文 Junction。该实例的本机 root 为无密码，仅适用于本机合成测试；应用账号仍使用自动生成的随机密码。不要用于真实数据或部署。

如果已有 MySQL，跳过隔离实例启动，`--db-port` 填其端口。初始化管理员由 `NOVA_LOCAL_ADMIN_USER` / `NOVA_LOCAL_ADMIN_PASSWORD` 环境变量提供，默认 root/空密码；用安全提示或凭据管理器注入，不把密码写在命令或报告里。日常业务账号只有该库的 SELECT/INSERT/UPDATE/DELETE 权限。

多个副本同时运行时，同时换数据库名、用户和 HTTP 端口，例如：

```powershell
npm run local:setup -- --database=nova_competition_demo2 --db-user=nova_demo2 --db-port=3308 --port=3131
npm run local:db:init -- --confirm-database=nova_competition_demo2
```

以上第二组只在另一个尚未生成配置的副本运行。数据库名必须以 `nova_competition_` 开头。初始化会建当前 29 张表，导入 17 种植物和 10 篇现有已审核示例文章；不导入旧账号、会话或附件。

## 开发者工具

1. 导入本目录。仓库 AppID 为 `touristappid`，请在项目设置填你有权限的真实小程序 AppID；AppID 不是秘密，AppSecret 不应进入前端。
2. 执行“工具 → 构建 npm”。本地版允许不校验合法域名，只能用于本机开发。
3. 编译后从登录页点击登录。本地后端使用隔离开发身份，不把它当作真实微信 openid。
4. 本地地址由生成的 `services/config/local-runtime.js` 决定；只改变端口时，须同步修改它与 `.env.local` 的 LOCAL_PORT，然后重启服务。

默认 AI/天气服务关闭，因此不产生模型或天气调用；这不代表完整真实 AI 演示已经准备好。需要它们时在被忽略的 `.env.local` 配置：

- 模型：`LLM_API_ENABLED=true`、实际 base URL/path、已验证的 Chat/Vision 模型名，以及 `LLM_API_KEY_FILE` 指向本机受控密钥文件。
- 天气：`QWEATHER_ENABLED=true`、host/project/credential ID 与 `QWEATHER_PRIVATE_KEY_FILE`。
- 不提交密钥文件或本机配置。模型不可用时应显示失败/受控回退，不能用离线测试当真实回答验收。

## 日常启动与验证

```powershell
npm run local:start
npm run local:smoke
npm test
npm run check:context
npm run local:stop
```

日常启动只读核验 schema，不初始化、不重建数据库。停止命令只停止本目录启动的 Node 进程，不停止 MySQL。需要关闭隔离测试 MySQL 时：

```powershell
pwsh -NoProfile -File scripts/local-db/isolated-mysql.ps1 -Action stop -Port 3308
```

`local:smoke` 使用专用测试账号，检查鉴权、双账号隔离、植宠 CRUD、任务生命周期及媒体/日记；会创建并清理这些合成业务记录，日志保留在 `.runtime/competition-smoke/`。AI 提案确认、记忆与云媒体还由单测及云包联测覆盖。接口测试不能代替开发者工具页面、真实模型和实体手机验收。

## 目录与交付

| 位置 | 用途 |
|---|---|
| app.*、pages/、services/、components/ | 小程序源码 |
| dist/scf/ | 本目录自己的后端源码，不是构建缓存 |
| scripts/local-db/、scripts/local-server/ | 新库初始化、本机服务与测试 |
| deployment/cloud-initial/ | 自带云适配及验证工具，便于单目录维护；不依赖云端版副本 |
| .env.local.example、package-lock.json | 配置模板和冻结依赖 |
| docs/competition-delivery.md | 本次改动、证据和未验证范围 |

本地的 trial/release 不再带旧云地址，CloudBase 默认关闭。真正上云使用独立云端版生成的客户端及 5 个函数包，不把本地服务或开发身份上传。

旧 M0–M7 文档和 GUI 验收脚本保留作历史/技术底稿；其中旧机器路径、旧库名和旧验收数字不代表本竞赛副本的现状，相关快捷命令已退出当前 package.json。当前可复现入口是本 README 与[交付记录](./docs/competition-delivery.md)；GUI 验收按本文手动导入，不运行旧机器专用全套脚本。
