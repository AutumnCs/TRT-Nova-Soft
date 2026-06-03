# 当前完整方案思路

## 1. 当前结论

当前项目已经从“CloudBase 作为核心主链路”切换到“SCF + MySQL 作为新主链路”。

当前已经验证成功的主链路是：

- 设备 -> OneNET 数据推送 -> `ingest-scf` -> MySQL
- 小程序 -> `auth-scf` -> token
- 小程序 -> `api-scf` -> MySQL

当前没有验证成功并纳入主链路的能力：

- OneNET 规则引擎裁剪后推送 -> `ingest-scf`

也就是说，规则引擎目前可以保留为研究项，但当前生产候选方案应以数据推送为准。

## 2. 当前架构分层

### 2.1 设备接入层

- OneNET 继续作为设备接入平台
- `ingest-scf` 继续作为 webhook 接收入口

`ingest-scf` 当前负责：

- 验签
- 解密
- 解析 OneNET 原始消息
- 归一化 latest/history
- 写入 MySQL

`ingest-scf` 当前不负责：

- 用户身份识别
- 设备归属判断
- ACL 自动绑定

### 2.2 用户认证层

`auth-scf` 当前负责：

- 接收小程序 `wx.login()` 产生的 `code`
- 调微信 `code2Session`
- 获取 `openid`
- 写入或更新 `users`
- 签发 Bearer token

### 2.3 业务 API 层

`api-scf` 当前负责：

- `/health`
- `/device/latest`
- `/device/history`
- `/device/bind`
- `/device/unbind`
- `/device/profile`
- `/user/profile`

`api-scf` 的角色是：

- 校验 token
- 解析 `openid`
- 按 `device_acl` 做权限过滤
- 向小程序返回稳定 JSON

### 2.4 数据存储层

当前 MySQL 作为主数据底座，主要表如下：

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_history_raw`
- `device_history_agg`

## 3. 当前数据分层

### 3.1 `users`

保存用户资料与登录身份落点。

### 3.2 `devices`

保存设备主数据，以及 OneNET 设备与业务设备的映射。

当前策略已经调整为：

- `ingest-scf` 收到新设备消息时，自动最小注册到 `devices`
- 自动注册只补设备主数据，不自动写 `device_acl`

### 3.3 `device_acl`

保存用户与设备的绑定关系，以及用户侧配置：

- 别名
- 位置
- 植物类型
- 角色
- 状态

这张表是业务权限层，不是设备上报层。

### 3.4 `device_latest`

保存每台设备的最新状态，是首页、花园页、详情页的主读取表。

### 3.5 `device_history_raw`

保存原始历史点，用于排查、短期明细和再加工。

### 3.6 `device_history_agg`

保存聚合历史，用于趋势图和长期查询。

推荐粒度：

- `24h -> 5m`
- `7d -> 1h`
- `30d -> 1d`

## 4. 当前 OneNET 侧策略

当前真正跑通的接入路径是：

- OneNET 数据推送 -> `NovaTry` -> `ingest-scf`

当前不能作为已验证能力写进主链路的是：

- OneNET 规则引擎裁剪输出 -> `NovaTry` -> `ingest-scf`

原因不是规则配置页看起来有明显错误，而是：

- 单独依赖规则引擎时，没有形成稳定可复现的推送结果
- `ingest-scf` 日志里持续收到的是原始 `msg/signature/nonce/...` 包装
- 这更符合 OneNET 数据推送的原始格式

因此当前应明确：

- `NovaTry` 只是 HTTP 推送资源实例
- 它只负责“发到哪”
- 它不决定“发什么格式”

## 5. 当前小程序侧策略

小程序不直接操作 MySQL。

小程序只负责：

- 页面展示
- 用户交互
- 调用服务层

服务层当前默认走：

- `auth-scf`
- `api-scf`

运行时配置位置：

- [app.js](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/app.js)
- [runtime.js](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/services/config/runtime.js)

## 6. 当前公网数据库策略

当前数据库访问仍然使用公网地址。

这不是长期偏好，而是当前阶段策略：

1. 先验证后端主链路是否成立
2. 先让 `auth-scf / api-scf / ingest-scf` 全部跑通
3. 后续再视情况收敛到私网/CCN

后续切私网时，主要改的是：

- `DB_HOST`
- SCF 网络配置
- 数据库白名单/网络打通

不会推翻当前业务架构。

## 7. 当前 ACL 策略

`device_acl` 仍然单独处理，原因很简单：

- OneNET 只知道设备消息
- 它不知道设备属于哪个微信用户
- 它不知道用户别名、位置、植物类型

所以正式流程里应通过这些 API 维护 ACL：

- `/device/bind`
- `/device/unbind`
- `/device/profile`

也就是说，正常产品路径里，用户应当从“小程序我的花园”等页面触发绑定，不应长期手工写 SQL。

## 8. 历史数据保留策略

当前项目还没有自动删除旧历史数据的能力。

现状是：

- `device_history_raw` 会持续增长
- `device_history_agg` 也会持续增长

当前建议补上的最小保留策略是：

- `device_history_raw`：保留 7 天
- `device_history_agg` 的 `5m`：保留 7 天
- `device_history_agg` 的 `1h`：保留 30 天
- `device_history_agg` 的 `1d`：保留 365 天

对应补法：

- 新增一个每日执行一次的 `history-cleanup-scf`

## 9. 当前已确认成立的判断

当前可以明确下结论：

1. `auth-scf` 已能完成真实登录
2. `api-scf` 已能返回真实设备最新状态
3. `ingest-scf` 已能接收 OneNET 数据推送并写入 MySQL
4. 小程序 -> `auth-scf` -> token -> `api-scf` 已实测跑通
5. CloudBase 已不再是设备主链路的核心依赖

## 10. 当前最值得继续优化的点

1. 让真实用户通过页面完成正式绑定，而不是依赖手工补 ACL
2. 补 `history-cleanup-scf`，避免历史表无限增长
3. 稳定 `device_history_agg`
4. 继续清理剩余 CloudBase 兼容分支
5. 后续再评估数据库私网/CCN 收敛

## 11. 一句话总结

当前应当明确写成：

**OneNET 数据推送负责设备接入，SCF 负责 webhook、认证与业务 API，MySQL 负责主数据存储，小程序主要通过 API 读写业务数据。规则引擎裁剪推送目前不作为已验证主路径。**
