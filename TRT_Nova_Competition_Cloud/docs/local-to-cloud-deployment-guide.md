# 云端部署指南

部署路线按 2026-09-09 最新确认：复用 LastScf 的独立 SCF 函数地址、index.main_handler、环境变量和 MySQL 连接方式；图片与文档都使用小程序 CloudBase 云存储。CloudBase 不运行本项目业务云函数或数据库。

更新：2026-09-09。竞赛版已拆成独立本地/云端目录；本指南适用于当前目录自带的 cloud-initial，不依赖旧工作树。本机自动验证已完成；真实资源配置、隔离部署与微信端验证正在准备。

交付内容与当前验证状态见[云候选说明](../deployment/cloud-initial/README.md)。

本轮先推进 SCF、MySQL 和基础微信链路。CloudBase 代码与接口保持不变，暂不部署存储环境；附件上传、文档解析及完整媒体生命周期的云验收暂缓。此阶段不属于完整云端发布，不能填写完整 release 通过。

## 先分清三件事

1. **同步代码**：从当前小程序与 SCF 源码生成新候选，使用与当前源码一致的构建包。
2. **部署测试环境**：在已核实的现有资源中配置隔离 staging、空业务库、云开发附件存储和正式身份/环境配置，再用合成样本验收；不默认购买资源。
3. **迁旧数据**：可选且单独批准。本地假身份、图片 BLOB、真实微信账号之间需要对账，不能顺手复制整个本地数据库。

本指南先交付第 1 项和第 2 项的操作方法。第 3 项没有自动迁移工具，也没有真实执行。

## 第一步：在本机跑候选，不碰云

工作目录是小程序项目根目录，也就是同时包含 app.js、dist/scf、deployment 的目录。本机完整路径：

```text
<competition-local-cloud 工作树>/TRT_Nova_Competition_Cloud
```

```powershell
pwsh -NoProfile -File deployment/cloud-initial/test-local-candidate.ps1
```

脚本会从白名单构建 5 个 ZIP，跑当前产品回归、真实独立 MySQL 联测、微信文件 HTTP 协议对本机服务的传输测试、依赖审计和包检查。外部业务服务使用测试替身，不会访问云端。

state/verification/本次时间/result.json 必须 PASS；每一步都附真实退出码。发布检查针对未填写的示例应被阻断，这是负向测试，不是放行。测试库以 nova_cloud_test_ 开头，保留复核，不触碰原验收库。

## 第二步：备齐目标环境

获得部署授权后，由环境负责人准备：

| 资源 | 最低要求 |
|---|---|
| SCF | 独立 staging namespace；5 个 Event 函数；入口 index.main_handler；按模板核对当前支持的 Node 运行时 |
| MySQL | 独立业务库；核对备份/恢复与实际连接方式；当前按用户要求复用现有账号，不新建账号或更改授权 |
| CloudBase 附件 | 绑定当前小程序 AppID 的云开发存储环境；明确环境 ID、地域、附件前缀；验证不能匿名或跨用户读写 |
| SCF 环境变量 | 按生成清单配置 DB_USER/DB_PASSWORD、JWT_SECRET、WECHAT_SECRET 及启用的模型/天气密钥 |
| 网络 | 目标数据库可达；微信、模型、天气及 CloudBase 下载地址出站已验证；沿用旧控制台设置，不要求新建 NAT |
| 微信 | 正式 AppID/AppSecret、HTTPS 域名与证书；配置 request/upload/download 合法域名；体验成员 |
| 外部服务 | 可用的 Chat/Vision 模型；天气默认关闭，启用时再核实天气凭据；硬件写入和 ingest 仍关闭 |

AppSecret 仅在服务端使用。auth-scf 用它换取微信身份；API、Agent 和 history-cleanup 用同一 AppID/AppSecret 调用微信云开发文件接口。核对环境绑定和微信 IP 白名单。

## 第三步：生成配置，不改本地版

```powershell
Copy-Item deployment/cloud-initial/candidate.config.example.json deployment/cloud-initial/candidate.config.local.json
```

只在 local 配置中填非秘密项：region、namespace、database.host/name、media.envId/region/prefix，以及 ingress.functionUrls 中 auth-scf/api-scf/agent-scf 的三个独立 HTTPS 地址。AppID 只填 auth-scf.WECHAT_APPID。天气关闭时不要求私钥，开启后配置完整参数。

当前数据库链路采用已核实并获准复用的旧实例公网直连，database.tlsMode=legacy-direct，不传入 SSL 配置。主机与端口放在 candidate.config.local.json；DB_NAME 仍指向独立新业务库，不复用旧业务数据。private-network 和 required 保留但暂不选用；前者仅适用于已确认的可信私网，后者保持 TLS 证书与主机名校验，并按需配置 DB_SSL_CA。没有 TLS 失败后自动重试明文的逻辑；现有实例未启用 TLS，不涉及关闭服务端 TLS。

```powershell
node deployment/cloud-initial/tools/render-config.mjs --config deployment/cloud-initial/candidate.config.local.json
node deployment/cloud-initial/tools/snapshot-client.mjs --config deployment/cloud-initial/candidate.config.local.json
```

生成的 candidate.rendered.local.json 供控制台/部署器配置环境；其中 environment 是公开变量，requiredSecretEnvironment/optionalSecretEnvironment 是变量名清单，不含秘密值。客户端在 build/miniprogram，单独导入开发工具，保持 HTTPS 校验开启。本地项目仍指向原本机后端。

配置渲染不等于发布批准。没有真实资源时可以用 --allow-placeholders 看结构，但这种产物不能扫码使用。已有输出目录不会覆盖；改配置后用新的 --out 目录。

## 第四步：迁移数据库并核对

附件配置填 media.envId、region、prefix。前端生成 mediaStorageProvider=cloudbase，仍保留 useCloudBase=false（业务不走 CloudBase）。app.js 只按显式环境初始化附件存储，不回退旧环境。

服务端使用微信官方 [stable_token](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getstableaccesstoken.html) 与 [上传路径](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-http-api/storage/uploadFile.html)、[下载](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-http-api/storage/batchDownloadFile.html)、[删除](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-http-api/storage/batchDeleteFile.html)接口。令牌只缓存服务端；小程序用 wx.cloud.uploadFile。

迁移程序不创建目标数据库。先由 DBA 创建空 staging 库，并通过受控方式向当前终端注入 DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME、DB_TLS_MODE（required 模式按需提供 DB_SSL_CA）。不要把凭据写进命令、报告或仓库。

当前目标的空库创建、bootstrap 和结构核验已完成，继续使用现有账号，未新建数据库账号或改授权。不要对已初始化的库再次执行 bootstrap。此处保留的是通用部署步骤，当前结果见[实际新库准备验证](../deployment/cloud-initial/verification/2026-09-09-database-preparation.md)。同账号分库是业务范围隔离，不是账号权限隔离。

下面的 nova_staging 是示例，必须换成你确认的准确数据库名：

```powershell
# 只适用于空库；非空库会拒绝，不会帮你删表。
node deployment/cloud-initial/tools/migrate-database.mjs --mode=bootstrap --confirm-database=nova_staging

# 对已有且满足 M1-M7 基线的隔离克隆做增量升级。
node deployment/cloud-initial/tools/migrate-database.mjs --mode=incremental --confirm-database=nova_staging

# 发布前再次只读核验列、MIME 长度及删除触发器。
node deployment/cloud-initial/tools/migrate-database.mjs --mode=verify --confirm-database=nova_staging
```

三条不是无脑连跑：按空库/已有库选第一或第二条，再执行 verify。增量入口会检查基线，缺失即停止；它不是任意历史数据库的升级器。云模式必须显式选择 legacy-direct、private-network 或 required，缺失或未知值在连接前报错；本机演练使用受限的 --local-test 和独立测试库名。

覆盖会话事件、提案幂等、媒体关联、会话上下文、跨会话 summary_text/revision，以及 cloud_media_objects 和删除触发器。MySQL DDL 不能靠事务整体撤销：失败立即停，检查已执行部分，再决定修复或恢复备份。不要改成忽略异常继续。

知识种子只代表此前获准的临时 MVP 数据，不意味着云端长期内容定版。上线前重新审核；未发布内容不得进入用户页或 RAG。

新 staging 的空知识库可以导入这批现有内容。下面的确认参数表示部署负责人已经核对这批内容适用于目标环境；第一次先加 --dry-run 检查（事务回滚），确认后去掉它执行。已有知识库会拒绝覆盖。

```powershell
node deployment/cloud-initial/tools/seed-reviewed-content.mjs --confirm-database=nova_staging --acknowledge-reviewed --dry-run
node deployment/cloud-initial/tools/seed-reviewed-content.mjs --confirm-database=nova_staging --acknowledge-reviewed
```

## 第五步：部署隔离 staging，先不切正式流量

1. 使用 artifacts/ 的 5 个 ZIP，保存这批 RELEASE_MANIFEST.json；上传前核对 SHA-256 与 PACKAGE_POLICY_REPORT.json。
2. 按生成清单在 SCF 配置环境变量，按已核实的数据库网络配置，并指定 CloudBase 附件环境及前缀，按 scf-manifest.template.yaml 设置入口和超时。
3. 为 auth/api/agent 分别配置各自 Function URL；不增加统一域名路径映射。按 function-url-routes.template.yaml 保留完整路径并转发 Authorization、x-access-token、Content-Type。
4. history-cleanup-scf 只加受控定时触发器，不开放公共 HTTP；先验证时区与触发行为，再按每分钟清理少量对象运行。
5. 不部署本地服务器，不开放 /dev/token，不注入 DEBUG_OPENID，不开启设备写命令或未审查 ingest。
6. 先做下面的真实云验收，拿到证据后再填写 release-record.template.md 和配置 acknowledgements。

```powershell
node deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.local.json
```

这个程序检查配置与确认记录，不能替代人核对证据。没有真实云数据时必须继续阻断；不要只改布尔值让它通过。

## 第六步：云上要验哪些事

| 真实云检查 | 通过标准 |
|---|---|
| 断开本机后端，手机用移动网络登录 | 真实微信换码成功；不依赖这台电脑 |
| 两个真实账号 | 私有植宠、任务、会话、记忆、文件严格隔离；伪造 owner 无效 |
| 空花园选图片/文档再发 | 草稿可见，补文字再发送，只确认一次；冷启动首次 PDF/DOCX 能解析 |
| 重进会话、重新编辑、撤回 | 图片和回复恢复；分支不混历史；共享附件不误删，独占附件最终被清理 |
| 连续对话与整段摘要 | 本会话上下文连续；开启摘要后新会话可引用；关闭/修改不会被旧请求写回 |
| 查看植株、建议、创建任务 | 只读建议不建任务；用户确认才写，重复确认只创建一次 |
| 四 Tab、个人资料、知识库、天气 | 真实数据可读写；正常导航；失败不显示伪造数据 |
| 微信文件接口/CloudBase/数据库故障 | 错误可定位但不泄漏秘密；不偷偷回退本机身份或 BLOB；失败对象可重试清理 |
| 重启函数、网络慢、重复发送 | 会话和摘要仍在数据库；请求重试不重复写入；记录真实等待与超时 |
| 云开发存储规则与清理 | 未授权不能读；替换/永久删除/过期草稿可对账，清理失败留下记录 |

本地验证只能提前排除部分代码问题。真实环境权限、网络、微信事件结构、模型行为和手机键盘问题，必须在本表对应环境再验一次。

## 真要带走本地数据时

这不是本轮自动完成的部分。必须另做：

- 本地开发 openid → 真实微信账号的明确归属映射，不做猜测。
- 如另行批准迁移，图片和文档进入 CloudBase；校验字节数与 SHA-256，生成 old fileID → new fileID 对照。本次没有运行迁移。
- 同步头像、封面、日记、诊断、消息和分支引用；核对每条 owner 和孤儿对象。
- 已确认业务事实和幂等标记一起迁移；旧 pending proposal 默认失效，不重放任务。
- 备份原库与对象清单、抽样比对、失败断点和回滚记录都齐全后才批准切流。

不能把本地测试数据库、假身份和旧 local:// 引用直接作为正式云数据。

## 回滚与后续维护

保留上一批函数版本/别名、环境配置版本、数据库备份和对象清单。先在 staging 验证兼容性，再切别名；数据库有新字段不代表能盲目删列回滚，云开发文件也不能跟着旧代码回退随手删掉。

环境密钥更新后核对函数版本/实例；文件清理积压要监控；新模型换入前复测上下文、文档、任务确认和失败分支。每次改源码重新构建、比对源码、运行本机演练和依赖审计。当前本地验收版不用随云端实验一起切换配置。
