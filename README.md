# TRT-Nova-Soft

## 竞赛交付版（2026-09-09）

- [TRT_Nova_Competition_Local](./TRT_Nova_Competition_Local/README.md)：可单独复制的本地开发与演示版，独立数据库初始化、启动和测试。
- [TRT_Nova_Competition_Cloud](./TRT_Nova_Competition_Cloud/README.md)：可单独复制的云端源码、5 个函数包构建、客户端生成和部署验证工具。

两版位于 competition-local-cloud 分支，各自包含完整源码与依赖锁，不读取另一个目录。原 LastScf、V2 及其他历史目录保持原样。

2026-09-10：云端版已接入隔离 staging，并修复登录时覆盖已选头像昵称的问题。本轮团队手机试测使用云端版，见[团队试测说明](./TRT_Nova_Competition_Cloud/docs/team-testing.md)。本地版保留此前独立演示基线，不自动同步本轮云端客户端修复。后续 UI 优化按[HTML 原型确认流程](./TRT_Nova_Competition_Cloud/docs/ui-taste-and-prototype-workflow.md)进行。

## 版本记录

- 26/9/3 Tomus更新前端V2：首页植宠形象升级——新插画素材（浅色日光 / 深色夜巡两套）、贴合素材轮廓的悬浮光影表现，并优化舞台构图与色彩层次；后端为拆分后的 6 个 SCF 函数架构（api/auth/agent/admin/ingest/history-cleanup）；另修复迎新日设备按钮错位、知识库"追问AI"跳转（tabBar 页改用 switchTab）、植物诊所体检结果联动传感器阈值判定。

- 26/8/28 Tom更新TRT\_Nova\_MVP\_miniprogram\_LastScf：修复 api-scf 设备绑定（设备码无 Nova\_ 前缀时回退用原始设备码查询），更新微信开发者工具项目配置，新增 api-scf 的 package-lock.json。

