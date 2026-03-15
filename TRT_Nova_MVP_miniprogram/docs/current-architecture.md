# 当前架构

本文档只描述当前项目的实际结构、数据流和页面/数据职责分工，不写开发规则。

## 1. 项目定位

本项目是一个基于微信小程序云开发的智能花盆 MVP。

当前目标不是做通用平台，而是稳定跑通以下闭环：

1. 开发者登记设备
2. 用户通过实体设备码绑定设备
3. OneNET 推送设备数据
4. webhook 将数据写入小程序云数据库
5. 小程序按用户和设备读取并展示数据

## 2. 主数据链路

当前真实数据链路如下：

**设备/模拟信号 -> OneNET -> 腾讯云 SCF webhook -> 小程序云数据库 -> 小程序前端**

明确约束：

- 小程序前端不直接请求 OneNET
- OneNET 数据入口是外部 SCF webhook
- 小程序只从云数据库和云函数读取业务数据

## 3. 运行环境

### 3.1 小程序主环境

- 本项目主环境是微信小程序云开发环境
- 小程序业务数据库、云函数、页面逻辑都以当前小程序云开发环境为准

### 3.2 外部 webhook 环境

- OneNET webhook 运行在腾讯云 SCF
- 它不属于小程序前端运行时
- 它承担 OneNET 到小程序数据库之间的外部桥接职责

## 4. 责任分层

### 4.1 SCF webhook

SCF webhook 负责：

- OneNET GET 验证
- OneNET POST 推送接收
- 解析 `req.body.msg`
- 提取 `productId / deviceName / params`
- 生成 `latestRecord / historyRecords`
- 写入小程序云数据库

SCF webhook 不负责：

- 小程序用户权限判断
- 决定哪个用户可以看哪个设备
- 小程序页面逻辑

### 4.2 小程序云函数

小程序云函数负责小程序业务侧逻辑，例如：

- `login`
- `bindDevice`
- `unbindDevice`
- `registerDevice`
- `getDeviceData`
- `updateBoundDeviceInfo`

说明：

- 这些云函数不是 OneNET 的 webhook 入口替代品
- 它们只处理小程序业务逻辑

### 4.3 小程序前端

小程序前端负责：

- 页面展示
- 用户交互
- 调用云函数
- 展示设备数据

前端不负责：

- 直接访问 OneNET
- 保存 OneNET token / aesKey 等敏感信息

## 5. 设备身份设计

### 5.1 逻辑设备键

当前逻辑设备键固定为：

`logicalKey = productId + "::" + deviceName`

这是当前设备逻辑主键。

### 5.2 用户侧可见设备标识

用户侧应主要接触：

- `physicalCode`

用户不应直接感知：

- `productId`
- `deviceName`
- OneNET 内部标识

## 6. 当前数据库集合

当前主集合如下：

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_data`
- `todos`

### 6.1 `users`

用户资料集合。

当前代码统一只读写 `users`。

旧集合说明：

- `user_profiles` 已视为废弃旧集合
- 运行时代码不再引用

### 6.2 `devices`

开发者登记设备主数据集合。

典型字段：

- `physicalCode`
- `productId`
- `deviceName`
- `logicalKey`

职责：

- 维护实体设备码与逻辑设备的映射关系

### 6.3 `device_acl`

用户与设备的绑定关系集合。

典型字段：

- `openid`
- `logicalKey`
- `role`
- `status`
- `alias`
- `location`
- `plantType`
- `bindTime`
- `unbindTime`

职责：

- 保存用户能访问哪些设备
- 保存用户侧个性化配置

说明：

- `alias / location / plantType` 属于用户配置
- 它们不属于 `devices` 主数据

### 6.4 `device_latest`

设备最新状态快照集合。

职责：

- 首页实时数据
- 花园页卡片状态
- 设备详情页实时指标

### 6.5 `device_data`

设备历史数据集合。

职责：

- 历史趋势图
- 不同时间范围内的历史指标读取

### 6.6 `todos`

待办事项集合。

当前规则：

- 待办必须绑定到用户：`openid`
- 待办必须绑定到设备：`logicalKey`

## 7. 当前页面结构

### 7.1 底部 Tab

当前底部 Tab 为：

1. 首页
2. 社区
3. 我的

### 7.2 “我的”页

当前“我的”页承载：

- 用户资料
- “我的花园”入口
- 开发者平台入口
- 通知/设置/关于

### 7.3 “我的花园”页

“我的花园”不是 Tab 页面，只从“我的”页进入。

职责：

- 展示当前用户绑定的设备卡片列表
- 点击卡片进入设备详情页
- 右下角 `+` 进入设备管理页

### 7.4 设备管理页

职责：

- 用户绑定设备
- 用户解绑设备
- 初始化用户设备信息：
  - `alias`
  - `location`
  - `plantType`

### 7.5 设备详情页

职责：

- 展示设备卡片
- 展示实时数据指标
- 切换历史趋势图
- 进入设备信息设置页

### 7.6 设备信息设置页

职责：

- 修改 `alias`
- 修改 `location`
- 修改 `plantType`

解绑不在该页处理。

### 7.7 开发者平台页

职责：

- 开发者登记设备
- 查看已登记设备
- 建立

`physicalCode <-> productId <-> deviceName <-> logicalKey`

的后台映射关系。

## 8. 当前环境初始化策略

### 8.1 小程序侧

- `app.js` 可从 `envList.js` 读取显式环境配置
- 若未显式指定，则 `wx.cloud.init` 使用当前小程序默认云环境

### 8.2 云函数侧

- 小程序云函数统一使用 `cloud.DYNAMIC_CURRENT_ENV`

这样做的目的是减少运行时与固定 envId 的硬耦合。

## 9. webhook 参考文件说明

`reference/onenetWebhook.example.js` 的定位是：

- SCF webhook 参考实现
- 数据契约协作参考
- 便于和线上 webhook 行为保持对齐

说明：

- 它不是小程序运行时代码
- 它也不等于线上真实部署文件本体
- 线上真实部署版本可能维护在仓库外部

## 10. 当前关键约定

### 10.1 绑定逻辑

用户通过 `physicalCode` 绑定设备：

1. 输入实体设备码
2. 在 `devices` 中查到开发者预登记设备
3. 建立 `device_acl`
4. 后续按 ACL 读取该设备数据

### 10.2 重复绑定逻辑

同一用户解绑后再次绑定同一设备时：

- 优先复活已有 `inactive` ACL
- 不再无上限新增重复 ACL

