# TRT-Nova-Soft

## 版本记录

- 26/9/2 新增 TRT_Nova_MVP_miniprogram_V2（当前版本，完整前后端快照）：前端修复迎新日设备按钮错位、知识库"追问AI"跳转（tabBar 页改用 switchTab）、植物诊所体检结果联动传感器阈值判定（正常/偏干/偏热/待复查/待检测）；后端为拆分后的 6 个 SCF 函数架构（api/auth/agent/admin/ingest/history-cleanup），含 8/28 设备绑定补丁。
- 26/8/28 更新 TRT_Nova_MVP_miniprogram_LastScf：修复 api-scf 设备绑定（设备码无 Nova_ 前缀时回退用原始设备码查询），更新微信开发者工具项目配置，新增 api-scf 的 package-lock.json。
