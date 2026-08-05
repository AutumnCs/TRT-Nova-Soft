# 项目文档

开发前请优先阅读以下文档：

- [植宠软件系统架构蓝图](./docs/plant-pet-software-system-blueprint.md)
- [植宠产品技术栈定版](./docs/plant-pet-technical-architecture-brief.md)
- [植宠产品级技术架构目标](./docs/plant-pet-technical-architecture-target.md)
- [植宠系统实施顺序与演进路线](./docs/plant-pet-implementation-roadmap.md)
- [当前系统现状与改进路线](./docs/current-system-status-and-improvement-plan.md)
- [当前架构](./docs/current-architecture.md)

旧迁移方案和已被替代的专题规划统一放在[历史文档归档](./docs/archive/README.md)，不作为当前研发依据。

## 快速说明

这是一个以微信小程序为客户端、腾讯云 SCF 为业务后端、MySQL 为主库、OneNET 为设备接入平台的植宠 MVP。

当前主数据链路：

**设备/模拟信号 → OneNET → `ingest-scf` → MySQL → `api-scf` → 小程序**

当前控制链路：

**小程序 → `api-scf /device/cmd` → OneNET → 设备**

## 当前核心数据表

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_history_raw`
- `device_history_agg`
- `todos`
- `plant_library`
- `plant_journal`

## 当前关键原则

- 小程序前端不直接访问 OneNET
- 用户只输入设备唯一码，系统自动补成完整 `deviceName`：`Nova_设备唯一码`
- `productId + deviceName` 组成逻辑设备键 `logicalKey`
- `devices` 管设备主数据
- `device_acl` 管用户绑定关系和用户侧个性化配置
