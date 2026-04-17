# 当前架构入口

当前项目请优先以下列文档为准：

- [`scf-lightdb-current-strategy.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-lightdb-current-strategy.md)
- [`scf-lightdb-migration-qa.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-lightdb-migration-qa.md)
- [`scf-onenet-command-path.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-onenet-command-path.md)
- [`scf-onenet-command-api-notes.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-onenet-command-api-notes.md)
- [`hardware-control-current-solution.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/hardware-control-current-solution.md)
- [`scf-deploy-packages.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-deploy-packages.md)

## 当前正式主链路

- 设备 -> OneNET 数据推送 -> `ingest-scf` -> MySQL
- 小程序 -> `auth-scf` -> token
- 小程序 -> `api-scf` -> MySQL / OneNET

## 当前下行控制建议

当前正式下行控制链路：

- 小程序 -> `api-scf /device/cmd`
- `api-scf` -> OneNET 北向 HTTP API
- OneNET -> 设备

不建议当前再新增一层：

- 自建 MQTT client
- 自定义 broker 中转
- 自定义命令转发服务

## 当前已文档化的 OneNET 控制相关内容

- [`scf-onenet-command-path.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-onenet-command-path.md)
- [`scf-onenet-command-api-notes.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/scf-onenet-command-api-notes.md)
- [`hardware-control-current-solution.md`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/docs/hardware-control-current-solution.md)

## 仓库里的 legacy 提醒

以下内容保留作历史参考，但不再视为当前正式主路径：

- [`cloudfunctions/sendDeviceCmd/index.js`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/cloudfunctions/sendDeviceCmd/index.js)
- [`services/core/CloudAdapter.js`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/services/core/CloudAdapter.js)
- [`services/DB.js`](/g:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram/services/DB.js)

当前产品和后端演进以：

- `SCF + MySQL + OneNET`

为准。
