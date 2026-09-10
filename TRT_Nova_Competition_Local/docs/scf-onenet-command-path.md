# OneNET 下行控制路径

> 文档状态：Current Implementation Reference  
> 核对日期：2026-07-19  
> 说明：本文只描述当前链路，产品级动作白名单、状态机和审计按实施路线 R1、R3 完成

## 1. 当前正式链路

当前推荐的软件下行控制路径是：

- 小程序 -> `api-scf /device/cmd`
- `api-scf` -> OneNET 北向 HTTP API
- OneNET -> 设备

设备与平台之间继续使用：

- MQTT
- OneJSON
- 产品物模型

当前阶段不建议额外自建一层：

- 云函数 MQTT client
- 自定义 broker 中转
- 自定义命令转发服务

因为这样会增加链路长度、排障成本和维护复杂度，但不会明显提升当前 MVP 阶段的收益。

## 2. 前端怎么发

前端统一调用：

- `POST /device/cmd`

推荐请求体：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_xxx",
  "params": {
    "test": true
  }
}
```

说明：

- `logicalKey` 用来定位数据库里的设备
- `params` 是要发给 OneNET 物模型属性设置接口的对象
- 当前风扇开关临时标识符是 `test`
- 后续正式化后建议改成 `fan_switch`

当前后端兼容：

- `test`
- `fan_switch`
- `fan_on`

最终会按环境变量 `FAN_SWITCH_IDENTIFIER` 归一成真正发给 OneNET 的属性键。

## 3. api-scf 当前做了什么

`dist/scf/api-scf/index.js` 当前 `/device/cmd` 的处理流程是：

1. 校验 `logicalKey`
2. 校验当前用户对设备的 `device_acl`
3. 从 `devices` 表查出 `product_id` 和 `device_name`
4. 生成 OneNET `Authorization`
5. 调 `POST https://iot-api.heclouds.com/thingmodel/set-device-property`
6. 将回包透传给前端

当前响应里会补充：

- `logicalKey`
- `productId`
- `deviceName`
- `sentParams`
- `authInfo`

这样联调时能直接看到：

- 实际发给 OneNET 的属性对象
- 使用的是哪种鉴权模式

## 4. 设备侧怎么接

设备应继续订阅：

- `$sys/{productId}/{device-name}/thing/property/set`

收到设置后：

1. 读取 `params.test` 或正式化后的 `params.fan_switch`
2. 执行风扇开/关
3. 回复：
   - `$sys/{productId}/{device-name}/thing/property/set_reply`
4. 最好再重新上报一次当前属性

推荐上报当前真实状态，而不是仅回复 ACK。

## 5. 数据库扮演什么角色

当前数据库不是下发链路的中转站。

数据库的职责是：

- 存用户与设备权限：`device_acl`
- 存设备主数据：`devices`
- 存设备最新状态：`device_latest`
- 存历史数据：`device_history_raw` / `device_history_agg`

当前不建议：

- 因为用户点击了风扇开关，就提前把数据库状态改成开/关

更合理的是：

- 下发命令直接走 `api-scf -> OneNET`
- 设备执行后自己上报
- `ingest-scf` 再把真实状态写入 `device_latest`

## 6. 当前最小闭环

风扇控制的最小闭环是：

1. 首页风扇开关调用 `api-scf /device/cmd`
2. `api-scf` 调 OneNET 物模型属性设置
3. 设备执行风扇动作
4. 设备把最新风扇状态重新上报
5. `ingest-scf` 更新 `device_latest.params_json`
6. 首页从 `device_latest` 回显真实状态

## 7. legacy 提醒

以下内容保留作历史参考，但不再是当前正式主路径：

- `legacy/cloudfunctions/sendDeviceCmd/index.js`

当前正式方向以：

- `SCF + MySQL + OneNET 物模型下行`

为准。
