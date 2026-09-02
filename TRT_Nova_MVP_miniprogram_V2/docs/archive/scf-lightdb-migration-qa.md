# 新方案迁移 Q&A

> **归档说明（2026-07-19）**：迁移阶段已经结束，部分问答与当前代码不同。本文只用于追溯当时为什么保留 SCF、OneNET 和 MySQL，不作为当前部署说明。

## Q1. 现有 SCF webhook 还要不要保留？

要保留。

原因：

- OneNET 当前仍是设备接入平台
- `ingest-scf` 已成功承担 webhook 接收职责
- 它已经实测把 OneNET 数据写入 MySQL

## Q2. 未来业务 API 能不能继续由 SCF 承担？

可以。

当前已验证：

- `auth-scf` 可完成登录换 token
- `api-scf` 可完成用户资料、设备 latest、history、bind 等业务 API

## Q3. 轻量 MySQL 够不够做当前验证版主库？

够。

当前已落地并验证的表：

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_history_raw`
- `device_history_agg`

## Q4. 为什么当前先走公网数据库？

因为当前目标是先把完整主链路跑通，而不是先把网络拓扑做复杂。

当前采用公网数据库的原因：

1. 轻量数据库与 SCF 的私网互通配置复杂
2. 后续私网长期方案大概率涉及 CCN 或同类网络打通
3. 当前先走公网能最快完成验证

## Q5. 以后切私网/CCN，会不会重搞一遍？

不会。

后续主要变化的是：

- `DB_HOST` 从公网地址切回内网地址
- SCF 网络配置调整
- 数据库网络与白名单收紧

不会重写的部分：

- 表结构
- `auth-scf / api-scf / ingest-scf`
- 小程序服务层
- token 方案

## Q6. 为什么 `device_acl` 要单独处理？

因为它属于业务权限层，不属于设备上报层。

OneNET 和 `ingest-scf` 只知道：

- `productId`
- `deviceName`
- `params`

它们不知道：

- 设备属于哪个微信用户
- 用户给设备取了什么别名
- 设备摆在什么位置
- 是否已解绑

所以 `device_acl` 必须由业务接口维护。

## Q7. 为什么这次验证里还出现了手工插 `device_acl`？

因为这次是在做后端链路验证，不是在走完整产品交互。

这次真实测试设备名是：

- `httptest`

而当前 `/device/bind` 默认更适合正式设备命名规则，例如：

- `Nova_<deviceCode>`

所以验证阶段曾通过 SQL 手工补 ACL，用来快速打通真实设备读链路。

## Q8. 正式产品里 `device_acl` 应该怎么维护？

应由业务 API 自动维护：

- `/device/bind`
- `/device/unbind`
- `/device/profile`

也就是说，正式产品里应当从“小程序我的花园”等页面走绑定，不应长期手工写 SQL。

## Q9. 小程序一开始为什么登录不上？

这次真实遇到过两个问题：

1. 小程序请求域名不在 `request 合法域名` 列表中
2. `auth-scf` 里误用了前端环境 API

修复方式：

- 在开发阶段临时关闭合法域名检查
- 正式补 SCF 域名到小程序后台
- 把 `auth-scf` 改成标准 Node.js `https.get(...)`

## Q10. `auth-scf` 返回 500 的根因是什么？

真实根因是：

- `wx is not defined`

也就是 `auth-scf` 在 SCF Node.js 环境里错误使用了前端 API。

## Q11. 为什么 `ingest-scf` 一开始返回 “Device not registered”？

因为之前 `ingest-scf` 采用过“设备需先登记到 `devices` 表”的策略。

现在这条策略已经改成：

- 收到新设备消息时自动最小注册到 `devices`
- 自动注册只补设备主数据，不自动写 `device_acl`

## Q12. 当前自动注册策略的边界是什么？

当前自动注册只负责：

- `logical_key`
- `product_id`
- `device_name`
- `status = active`

当前仍然不会自动处理：

- 用户绑定关系
- 设备别名
- 设备位置
- 植物类型

这些仍然由 `/device/bind`、`/device/unbind`、`/device/profile` 维护。

## Q13. 当前新方案是否已经全链路跑通？

可以认为后端主链路已经跑通。

当前已验证成功：

1. 小程序登录 -> `auth-scf`
2. OneNET 数据推送 -> `ingest-scf`
3. `ingest-scf` -> MySQL
4. `api-scf` -> MySQL
5. 小程序 -> `api-scf`

## Q14. 现在是不是可以说 CloudBase 不再是主链路？

可以这么说。

更准确地说：

- CloudBase 仍可暂时保留兼容能力
- 但设备和用户的新主链路已经转向 `SCF + MySQL`

## Q15. 现在最合理的后续动作是什么？

当前优先级建议如下：

1. 完成小程序页面层真实联调
2. 稳定 `device_history_agg`
3. 补历史清理能力
4. 逐步让设备页、花园页、详情页只走 `api-scf`
5. 继续清理剩余兼容代码
6. 后续再收敛数据库网络为私网/CCN

## Q16. OneNET 规则引擎最终建议怎么配？

当前最初的目标是：

- 不改物模型字段名
- 不改硬件上报字段名
- 只在规则引擎输出层使用短别名

推荐查询字段：

```sql
sysProperty.productId as pid,appProperty.deviceName as dn,appProperty.dataTimestamp as ts,body.soil_percent as sp,body.dht_temp as tt,body.dht_humi as th,body.run_state as rs,body.light_val as lv
```

推荐条件：

```sql
body.soil_percent is not null or body.dht_temp is not null or body.dht_humi is not null or body.run_state is not null or body.light_val is not null
```

短别名映射：

- `pid` -> `productId`
- `dn` -> `deviceName`
- `ts` -> `dataTimestamp`
- `sp` -> `soil_percent`
- `tt` -> `dht_temp`
- `th` -> `dht_humi`
- `rs` -> `run_state`
- `lv` -> `light_val`

## Q17. OneNET 规则引擎短别名推送是否已经验证成功？

没有。

当前必须明确：

- 规则引擎配置页可以保存
- 规则内容表面上看不出明显错误
- 但从实际运行结果看，它没有形成已验证成功的裁剪推送链路

关键证据是：

1. 单独依赖规则引擎时，没有形成稳定可复现的推送结果
2. `ingest-scf` 日志里收到的仍然是原始 `msg/signature/nonce/time/id` 包装
3. 这更符合 OneNET 数据推送的原始格式，而不是规则引擎短别名输出

所以当前不能再写：

- “OneNET 规则引擎短别名输出已验证成功”

当前应改写为：

- “规则引擎配置方向已研究，但裁剪推送链路暂未验证成功”

## Q18. 那当前 OneNET 到 SCF 的真实主链路是什么？

当前已验证成功的真实主链路是：

- 设备 -> OneNET 数据推送 -> `NovaTry` -> `ingest-scf` -> MySQL

这里的 `NovaTry` 是 HTTP 推送资源实例，只负责：

- 保存 URL
- 保存 token
- 保存 aesKey
- 保存校验状态

它不负责：

- 过滤数据
- 重组数据
- 先收再转

## Q19. 规则引擎、数据推送、资源实例三者到底是什么关系？

不是串联关系。

不是：

- 数据推送 -> 实例 -> 规则引擎 -> SCF

而是两条并列关系：

1. 数据推送 -> 实例(URL) -> SCF
2. 规则引擎 -> 实例(URL) -> SCF

实例只负责“发到哪”，不负责“发什么”。

## Q20. 当前有没有自动删除旧历史数据的能力？

没有。

当前还没有：

- MySQL TTL
- 自动清理事件
- 定时清理函数

所以：

- `device_history_raw` 会持续增长
- `device_history_agg` 也会持续增长

## Q21. 当前推荐的历史保留策略是什么？

建议先采用最小保留策略：

- `device_history_raw`：保留 7 天
- `device_history_agg` 的 `5m`：保留 7 天
- `device_history_agg` 的 `1h`：保留 30 天
- `device_history_agg` 的 `1d`：保留 365 天

推荐实现方式：

- 新增每日执行一次的 `history-cleanup-scf`
