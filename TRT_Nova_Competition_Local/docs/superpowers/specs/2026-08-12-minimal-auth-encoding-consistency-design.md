# 最小认证与编码一致性修复设计

## 目标

用一个小批次修复已经落盘的中文乱码，统一 `agent-scf` 与 `api-scf` 的旧 openid 回退策略，并把当前手机号入口明确限制为开发体验功能；同步纠正相关文档，但不扩展为认证重构或工程框架迁移。

## 范围

### 1. 中文乱码

- 修复 `services/modules/DeviceService.js` 与 `dist/scf/api-scf/lib/device-command.js` 中已确认的乱码提示。
- 增加一个轻量仓库检查，扫描当前正式源码和文档中的典型 mojibake/Unicode replacement character。
- 排除 `node_modules`、归档目录和默认不在项目范围内的实验目录。
- 中文文件继续使用 UTF-8 without BOM；修改后用 UTF-8 工具链读回验证。

### 2. Agent 身份回退

- `agent-scf` 优先验证 JWT，并维持现有 JWT 请求兼容性。
- 默认拒绝 `x-wx-openid`、`x-openid`、`body.openid` 与 `DEBUG_OPENID`。
- 只有 `ALLOW_LEGACY_OPENID_FALLBACK=1` 时才启用上述旧回退。
- 不改变微信登录、`auth-scf` 签发 JWT 或数据库中的 openid 身份模型。

### 3. 本地手机号体验入口

- 保留当前本地手机号体验逻辑，不把它升级成短信登录或微信手机号绑定。
- 通过明确的运行时配置开关控制入口；默认关闭。
- 关闭时不在登录页展示手机号登录入口，也不允许页面处理函数绕过开关创建 `phone_<number>` 本地身份。
- 文案明确这是开发体验能力，不将其描述为正式手机号认证。

### 4. 文档同步

- 更新当前系统现状：`api-scf` 已有默认关闭的 legacy openid 回退开关、action 白名单和相应测试；`agent-scf` 在本次修改后采用相同策略。
- 记录本地手机号入口是默认关闭的开发体验能力。
- 记录乱码检查的使用方式和边界。
- 不改变长期架构、技术栈或实施路线，只纠正当前完成度和近期风险描述。

## 不在范围内

- 正式手机号验证码登录或微信手机号绑定。
- 删除设备命令兼容代码或重写 `/device/cmd`。
- TypeScript、NestJS、pnpm workspace 或 CI/CD 迁移。
- Redis、消息队列、监控平台或完整 E2E 系统。
- 修改首页、TabBar、设计系统和其他现有未提交改动。

## 验证

- 为 `agent-scf` 身份解析增加测试：有效 JWT 成功、默认拒绝旧 openid、显式开关允许旧回退。
- 为手机号开发开关增加小型纯函数测试，证明默认隐藏/拒绝、显式开启可用。
- 运行乱码扫描，确认正式范围无已知乱码特征。
- 对所有改动 JavaScript 运行 `node --check`，运行相关 `node --test`。
- 文档和检查脚本变化后运行 `node scripts/check-ai-context.mjs`。

## 兼容与回滚

- 生产正常 JWT 链路不变。
- 仍依赖 Agent 旧 openid 回退的本地环境，可临时显式设置 `ALLOW_LEGACY_OPENID_FALLBACK=1`。
- 需要本地手机号体验时，开发者显式打开对应运行时开关。
- 所有变化均为局部开关或提示修复，可按提交回滚，不涉及数据库迁移。
