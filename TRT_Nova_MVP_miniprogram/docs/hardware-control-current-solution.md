# 当前软件控制硬件方案

## 1. 目标

当前方案的目标是：

- 小程序可以直接控制硬件
- OneNET 作为设备接入与下行平台
- 数据库记录真实设备状态，而不是记录“命令意图”
- 前端能区分“命令已发出”和“设备已执行”

## 2. 控制链路

当前正式控制链路：

- 小程序页面触发控制
- `services/modules/DeviceService.js`
- `api-scf /device/cmd`
- OneNET 物模型属性设置接口
- 设备订阅属性设置主题
- 设备执行后重新上报属性
- `ingest-scf` 入库
- 首页/详情页从 `device_latest` 回显状态

## 3. 风扇控制的当前落地

当前已选择“风扇开关”作为第一轮联调控制项。

物模型属性条件：

- 类型：`bool`
- 权限：`读写`
- 当前临时标识符：`test`

因此当前最小命令是：

开启风扇：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_xxx",
  "params": {
    "test": true
  }
}
```

关闭风扇：

```json
{
  "logicalKey": "Aruv1l24Y6::Nova_xxx",
  "params": {
    "test": false
  }
}
```

## 4. 为什么数据库不先写风扇状态

因为“我发了一个命令”和“设备真的执行成功”不是一回事。

所以当前方案是：

- 命令直接发给 OneNET
- 数据库状态以设备上报为准

这样：

- `device_latest` 代表真实状态
- `device_history_raw` 代表真实历史变化
- 前端不会因为用户点了开关，就误以为设备已经执行成功

## 5. 设备端要求

设备侧需要做到：

1. 订阅：
   - `$sys/{productId}/{device-name}/thing/property/set`
2. 读取下发的 `params.test`
3. 执行风扇开关
4. 回复：
   - `$sys/{productId}/{device-name}/thing/property/set_reply`
5. 再上报一次风扇当前状态

推荐把风扇状态上报回同一属性键：

- 当前：`test`
- 后续正式化：`fan_switch`

## 6. 前端当前职责

前端当前应承担两件事：

1. 发命令
2. 回显最新状态

建议页面上区分三种状态：

- 命令未发出
- 命令已发出，等待设备确认
- 设备已上报最新状态

## 7. api-scf 当前职责

`api-scf /device/cmd` 当前负责：

1. 校验用户是否有权限操作该设备
2. 查出设备 `product_id` 和 `device_name`
3. 生成 OneNET 鉴权
4. 调用物模型属性设置接口
5. 返回 OneNET 回包和实际下发参数

## 8. 后续建议

短期：

- 保持当前风扇属性标识符 `test`
- 优先把整条链路跑通

中期：

- 把物模型标识符改成 `fan_switch`
- 将前端、设备端、环境变量同步切换

后期：

- 如需审计、失败重试、ACK 跟踪，再新增 `device_commands` 表
- 不要在 MVP 阶段为了下发而提前做复杂命令系统
