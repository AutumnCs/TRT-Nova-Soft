# Legacy 与 CloudBase 清理清单

> 更新日期：2026-07-14。本文用于区分“暂时保留的微信生态辅助能力”和“已经不再属于主链路、可以逐步下线的历史残留”。

## 1. 当前判断原则

- 仍在主链路中被真实调用：保留
- 只承担微信云存储或 `cloud://` 兼容：谨慎保留
- 只用于历史 CloudBase 云函数路径、当前主链路不再调用：进入下线清单
- 文档若只记录迁移过程：保留为历史资料，但不作为当前事实源

## 2. 暂时保留

这些能力虽然不是主业务中枢，但当前仍有明确用途：

- `app.js`
  - 仍会初始化 `wx.cloud`
  - 原因：兼容 `wx.cloud.getTempFileURL`、上传文件等微信生态能力

- `services/modules/CloudStorageService.js`
  - 仍用于头像等文件上传与 `cloud://` 持久化路径

- 页面中对 `cloud://` 的解析逻辑
  - 如首页图片解析等
  - 原因：已有数据可能仍保存为云文件地址

## 3. 可进入下线清单

这些内容不再属于当前正式主链路：

- `services/core/CloudAdapter.js`
  - 旧 CloudBase 数据库适配器
  - 已从当前仓库主运行路径中移除

- `legacy/cloudfunctions/`
  - 历史 CloudBase 云函数实现，仅保留参考

- `services/core/CloudAdapter.js`
- `services/DB.js`
  - 只包了一层旧 `CloudAdapter`
  - 当前已显式标记为弃用，访问时会抛错
  - 不应继续作为新功能入口

## 4. 建议下线顺序

1. 先禁止新增功能继续依赖 `CloudAdapter` / `services/DB.js`
2. 搜索全仓库真实引用，确认是否已无运行时调用
3. 若无调用，先在文档中标记“弃用”
4. 删除 `services/core/CloudAdapter.js`
5. 再删除 `services/DB.js`
6. `legacy/cloudfunctions/` 可在确认不再需要复盘后整体归档到仓库外

## 5. 暂不建议删除

- `wx.cloud.init`
- `CloudStorageService`
- 页面中的 `cloud://` 兼容分支

原因不是它们“很先进”，而是它们仍承接微信生态文件能力。要删也应先完成文件链路替换。

## 6. 完成下线的判断标准

满足下面几项后，才算真正完成 CloudBase 历史残留清理：

- 小程序运行不再依赖 `services/DB.js`
- 设备、用户、Todo、日记、植物库等业务主链路全部只走 SCF + MySQL
- 文件上传与读取路径已经确认稳定
- 文档已明确 CloudBase 仅保留文件能力，或已经完全退出
