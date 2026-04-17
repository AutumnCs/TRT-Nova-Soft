# OneNET 下行接口与鉴权说明

## 1. 当前使用的 OneNET 接口

当前 `api-scf` 对下行控制采用：

- `POST https://iot-api.heclouds.com/thingmodel/set-device-property`

请求体格式：

```json
{
  "product_id": "Aruv1l24Y6",
  "device_name": "Nova_xxx",
  "params": {
    "test": true
  }
}
```

适合这种“有明确状态值”的控制项，例如：

- 风扇开关
- 灯光开关
- 自动模式开关
- 阈值配置

## 2. 鉴权模式

当前代码已支持三种 OneNET 鉴权模式：

- `product`
- `project`
- `user`

对应资源格式：

- 产品鉴权：`products/{productId}`
- 项目鉴权：`projects/{projectId}`
- 用户鉴权：`userid/{userId}`

鉴权环境变量：

```env
ONENET_AUTH_MODE=product
ONENET_AUTH_METHOD=sha256
ONENET_AUTH_TTL_SECONDS=3600
ONENET_PRODUCT_ACCESS_KEY=<base64-access-key>
ONENET_PROJECT_ID=<project-id>
ONENET_PROJECT_ACCESS_KEY=<base64-access-key>
ONENET_USER_ID=<user-id>
ONENET_USER_ACCESS_KEY=<base64-access-key>
```

兼容变量：

- `ONENET_ACCESS_KEY`

如果某一模式下没有显式配置专属 access key，代码会回退读取 `ONENET_ACCESS_KEY`。

## 3. 签名规则

当前实现遵循 OneNET 新版安全鉴权规则：

- `version=2022-05-01`
- `method=md5 | sha1 | sha256`
- `et=秒级过期时间`
- `res=资源路径`

签名串：

```txt
StringForSignature = et + "\n" + method + "\n" + res + "\n" + version
```

签名方式：

```txt
sign = base64(hmac_<method>(base64decode(accessKey), utf8(StringForSignature)))
```

最终 `Authorization` 中的 `res` 与 `sign` 需要 URL 编码。

## 4. /device/cmd 对前端的约定

前端推荐始终传：

```json
{
  "logicalKey": "product::device",
  "params": {
    "test": true
  }
}
```

当前兼容策略：

- 正式入参：`params`
- 兼容旧方式：`cmd`，但它必须是对象 JSON 字符串

## 5. 风扇属性标识符策略

当前风扇物模型标识符临时使用：

- `test`

后续正式化建议改为：

- `fan_switch`

当前后端已支持风扇标识符别名归一：

- `test`
- `fan_switch`
- `fan_on`

归一目标由环境变量控制：

```env
FAN_SWITCH_IDENTIFIER=test
```

如果后续产品物模型改名，只需：

1. 改 OneNET 物模型标识符
2. 修改 `FAN_SWITCH_IDENTIFIER`
3. 视需要逐步把前端调用从 `test` 迁到 `fan_switch`

## 6. 当前联调时最该看什么

`api-scf /device/cmd` 返回里建议重点关注：

- `success`
- `sentParams`
- `authInfo.mode`
- `authInfo.res`
- `oneNetResp`

这样可以快速判断：

- 传给 OneNET 的属性是否正确
- 当前用的是产品/项目/用户哪种鉴权
- 是权限问题、参数问题，还是设备未执行
