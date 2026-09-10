# 云端部署架构

业务后端使用腾讯云 SCF，业务数据使用 MySQL；图片与文档使用微信小程序 CloudBase 云存储。

## 服务分工

| 服务 | 作用 | 部署方式 |
|---|---|---|
| auth-scf | 微信登录换码、用户登记、签发 JWT | 独立 SCF Function URL |
| api-scf | 植宠、任务、日记、资料、知识与附件接口 | 独立 SCF Function URL |
| agent-scf | 对话、识图、文档解析、会话与摘要 | 独立 SCF Function URL |
| history-cleanup-scf | 历史数据与未引用附件清理 | 定时触发，不开放公共 HTTP |
| ingest-scf | 可选设备遥测接入 | 默认关闭 |
| MySQL | 业务记录、身份归属、文件引用 | 独立业务库 |
| CloudBase 云存储 | 图片与文档原文件 | 绑定当前小程序 AppID 的环境 |

所有函数使用 index.main_handler。小程序分别配置 Auth、API、Agent 的 HTTPS 地址；环境变量在 SCF 配置。CloudBase 只承担文件存储，业务请求仍由 SCF 处理。

## 配置要点

- 每个函数的公开配置与所需秘密变量名由 candidate.config.example.json 和配置渲染器生成。秘密值直接在受控云环境配置，不进入源码、客户端或交付文件。
- 数据库当前选择 legacy-direct，复用已核实的旧实例公网非 TLS 链路。private-network 与 required 保留但暂不选用；将来切换时只改连接模式与目标网络参数，required 仍校验证书与主机名。按用户要求使用现有账号，不新建账号或修改权限；独立新业务库已初始化，不复用旧业务数据。
- CloudBase 配置必须包含环境 ID、地域和附件前缀，并验证当前 AppID 的绑定与存储权限。
- 测试部署使用独立函数、数据库和附件范围，不覆盖正在运行的旧服务。

## 附件生命周期

1. SCF 校验文件类型、大小与业务归属，并创建待上传记录。
2. 小程序通过 wx.cloud.uploadFile 上传原文件。
3. SCF 校验上传内容后登记到 MySQL，保存永久 fileID 和引用。
4. 读取需校验账号；替换、撤回和删除按业务引用处理，共享文件不会提前删除。

图片最多 2 MiB，文档最多 1 MiB。未完成上传有 24 小时清理宽限，已引用会话附件不按此期限删除。清理失败保留重试记录。

## 当前验证与部署入口

本机自动验证及现有 MySQL 实例上的独立新库创建、初始化和本机实连已完成；SCF 实际出站连接、CloudBase 调用与微信端验证仍待执行。操作步骤见[部署指南](./local-to-cloud-deployment-guide.md)，交付内容与验证状态见[交付说明](./competition-delivery.md)。

四 Tab、会话/摘要、用户确认后创建任务及现有账号权限保持一致。设备写入默认关闭。
