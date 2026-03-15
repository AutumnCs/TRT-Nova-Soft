# 项目文档

开发前请优先阅读以下两份文档：

- [当前架构](./docs/current-architecture.md)
- [开发规则](./docs/development-rules-and-architecture.md)

## 快速说明

这是一个基于微信小程序云开发的智能花盆 MVP。

当前主数据链路：

**设备/模拟信号 -> OneNET -> 腾讯云 SCF webhook -> 小程序云数据库 -> 小程序前端**

## 当前核心集合

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_data`
- `todos`

## 当前关键原则

- 小程序前端不直接访问 OneNET
- 用户只通过实体设备码 `physicalCode` 绑定设备
- `productId + deviceName` 组成逻辑设备键 `logicalKey`
- `devices` 管设备主数据
- `device_acl` 管用户绑定关系和用户侧个性化配置

