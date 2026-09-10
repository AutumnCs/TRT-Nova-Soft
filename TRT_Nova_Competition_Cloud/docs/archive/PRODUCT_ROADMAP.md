# TRT Nova 产品化路线图

> **归档说明（2026-07-19）**：这是早期页面功能路线和技术债务快照，已由 `../plant-pet-software-system-blueprint.md` 与 `../plant-pet-implementation-roadmap.md` 取代，不再作为当前排期依据。

> 更新日期：2026-04-07

---

## 已完成（本次实现）

| # | 功能 | 文件 |
|---|------|------|
| 1 | 真实天气 API 服务（和风天气）| `services/modules/WeatherService.js` |
| 2 | 传感器告警气泡框架（可配阈值）| `services/config/thresholds.js` |
| 3 | 设备离线检测 + 通知框架 | `services/modules/AlertService.js` |
| 4 | 全局 CSS 变量颜色系统 | `app.wxss` |
| 5 | 设备图标按植物类型显示 | `pages/index/index.js` |
| 6 | 气泡/心情/对话框由传感器驱动 | `pages/index/index.js` |
| 7 | 无设备时隐藏传感器区块，显示引导卡片 | `pages/index/index.wxml` |
| 8 | 错误提示增加"请重试"文案 | `pages/index/index.js` |
| 9 | Wiki 日历日期动态化 | `pages/wiki/wiki.js` |
| 10 | Wiki "加入养护提醒" 写入 Todo | `pages/wiki/wiki.js` |
| 11 | 设备详情图表：平滑曲线+渐变+坐标轴 | `pages/deviceDetail/deviceDetail.js` |

---

## 待实现 — 高优先级

### 1. 天气 API 激活
**文件**：`services/modules/WeatherService.js`，`app.js`

步骤：
1. 注册 [和风天气开发者账号](https://dev.qweather.com/)，创建 Web API 应用
2. 在 `app.js` `globalData.runtimeConfig` 中添加：
   ```js
   weatherApiKey: 'YOUR_KEY_HERE'
   ```
3. 在微信小程序后台「开发」→「服务器域名」→ `request` 合法域名中添加：
   ```
   https://devapi.qweather.com
   ```
4. 在 `app.json` 中声明定位权限：
   ```json
   "permission": {
     "scope.userLocation": {
       "desc": "获取位置以显示当地天气"
     }
   }
   ```

---

### 2. 风扇等设备控制下行指令
**文件**：`pages/index/index.js` → `toggleFan()`

已有 `deviceService.sendDeviceCmd(logicalKey, cmd)` 接口，补全：
```js
toggleFan() {
  const newState = !this.data.fan.isOn;
  const cmd = newState ? 'fan:on' : 'fan:off';  // 根据硬件实际命令调整
  try {
    await deviceService.sendDeviceCmd(this.data.selectedLogicalKey, cmd);
    this.setData({ 'fan.isOn': newState });
  } catch (err) {
    wx.showToast({ title: '指令发送失败', icon: 'none' });
  }
}
```

---

### 3. 传感器告警阈值个性化
**文件**：`services/config/thresholds.js`

- 当前为全局默认阈值
- 后续可在 `deviceSettings` 页面为每个设备单独配置阈值，保存到服务端
- SCF 端点建议：`/device/thresholds` GET/POST

---

### 4. 微信订阅消息（设备离线推送）
**文件**：`services/modules/AlertService.js`

步骤：
1. 在微信公众平台申请订阅消息模板（类目：智能设备）
   - 推荐模板：「设备状态变更提醒」
2. 在 `app.js` `runtimeConfig` 中添加：
   ```js
   offlineTemplateId: 'YOUR_TEMPLATE_ID'
   ```
3. 在用户点击事件中调用：
   ```js
   await alertService.requestSubscribePermission([config.offlineTemplateId]);
   ```
4. 离线检测逻辑已在 `AlertService.checkDeviceOffline()` 中实现，接上推送即可

---

## 待实现 — 中优先级

### 5. 植物成长日记
- 用户可对每个设备拍照并备注
- 照片上传到云存储，时间线展示
- `plantImageSource` 字段已预留，需要 UI + 上传逻辑

### 6. 历史数据时间范围增强
**文件**：`pages/deviceDetail/deviceDetail.js`

- 当前支持日/周/月切换
- 图表已优化为平滑贝塞尔曲线 + 渐变填充 + 坐标轴标签
- 待优化：超过 100 个点时做降采样（每 N 条取均值），避免曲线过密

### 7. 知识库数据告警模板集成
- Wiki 养护提醒已接 Todo，但 `care.water`/`care.light` 字段来自服务端
- 确认服务端 `/plant/library` 返回的植物数据包含这两个字段

### 8. 新用户引导流程
- 首次进入无设备时（`hasDevices === false`），可展示引导弹窗：
  1. 欢迎页 → 2. 绑定设备 → 3. 使用说明
- 引导状态用 `wx.getStorageSync('onboarded')` 判断

---

## 待实现 — 低优先级（增长阶段）

### 9. 分享功能
- Wiki 详情页「📤」按钮已占位
- 实现：`wx.shareAppMessage` 生成带植物图和名称的分享卡片

### 10. 植物健康报告分享
- 定期生成一张「本周植物状态图」（Canvas 绘制）
- 用户可分享到朋友圈，裂变引流

### 11. 社区 / 排行榜
- "谁的植物最健康"功能
- 需要服务端聚合多用户数据，有一定隐私授权成本

### 12. ECharts 升级（可选）
当前图表使用原生 Canvas + 贝塞尔曲线，已有渐变和坐标轴。
若需要交互式图表（点击查看具体数值、缩放等），可升级为 ECharts：

1. 下载 [echarts-for-weixin](https://github.com/ecomfe/echarts-for-weixin) 中的 `ec-canvas` 文件夹放入项目
2. 在 `deviceDetail.json` 中注册组件：
   ```json
   { "usingComponents": { "ec-canvas": "../../ec-canvas/ec-canvas" } }
   ```
3. 替换 `trendCanvas` 为 `<ec-canvas>` 组件，初始化 ECharts 实例

---

## 技术债务

| 问题 | 位置 | 建议 |
|------|------|------|
| 首页 3s 轮询仅在前台生效 | `index.js startAutoRefresh` | 配合订阅消息实现后台告警 |
| 历史数据量大时无降采样 | `deviceDetail.js refreshTrend` | 添加 `downsample(points, 80)` 函数 |
| 设备列表图标硬编码 emoji | `index.js PLANT_ICON_MAP` | 后续改为图片资源，支持自定义 |
| wiki 月度推荐植物硬编码 | `wiki.js _initCalendar` | 从服务端按月下发 |
