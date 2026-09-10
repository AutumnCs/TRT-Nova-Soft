# M6 移动端消息长按菜单设计 QA

## Source visual truth

本轮以用户提供的三组真实手机 AI 对话 App 截图为视觉事实，每组前一张是默认态、后一张是长按态：

- ChatGPT：`c0c1171472af8a66a911eff84b23294e.jpg` / `e20c91ac293cf053417e32cfb406c8ac.jpg`；
- DeepSeek：`13b6afe62510df5bc706ecfc228ac7f4.jpg` / `3b1480a8a43135fde9d885a1d20d3b29.jpg`；
- 腾讯元宝：`ede899276077a8218d0cc4f5e4d5e0ff.jpg` / `9a9d211c398e1017f5029b550d55f89c.jpg`。

三组参考的共同模式是：默认态不显示消息动作；长按具体消息后，在消息附近叠加一个临时菜单；菜单为图标加文字，点击动作或外部区域后关闭；菜单不占消息列表布局空间。NOVA 只复用这个交互层级，不复制三款 App 的深色主题、字体或品牌视觉。

## Implementation evidence

同一次微信开发者工具完整 E2E 生成了以下证据：

- 默认态：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\05b-message-actions-default-hidden.png`；
- 长按态：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\05c-message-actions-longpress-menu.png`；
- 纯文字编辑草稿：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-rewrite-e2e-v2\05d-rewrite-draft-compact.png`；
- 已保存图片与配文编辑草稿：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-rewrite-e2e-v2\05ba-image-rewrite-draft.png`；
- 图片编辑新分支：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-rewrite-e2e-v2\05bb-image-rewrite-created-branch.png`；
- 新分支：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\05e-rewrite-created-branch.png`；
- 原会话保留：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\05f-original-conversation-preserved.png`；
- 记忆治理：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\06-ai-memory-governance.png`；
- 八图同画布对照：`D:\植宠项目\验收记录\M6_2026-08-31\m6-longpress-unlimited-e2e-v1\visual-comparison-mobile-message-longpress.png`。

微信开发者工具截图为 546 × 1179 px。三款参考图分辨率和内容长度不同，因此同画布只按整机画面等比缩放，用于判断默认/长按两个状态、菜单层级、密度和遮挡方式；不把跨产品字体与像素坐标差异误报为缺陷。

## Combined comparison result

八图比较确认：

- 四款产品默认态都没有常驻消息操作行；
- 四款产品长按态都由临时菜单覆盖内容，不推动消息、输入框或底栏；
- NOVA 菜单紧邻被长按的用户消息，保持纸张底色、黑色轮廓和蓝色投影；
- NOVA 的复制、重新编辑、撤回本轮均为图标加文字；撤回使用红色危险语义；
- 菜单宽度与三行高度在 546 × 1179 视口内完整可见，靠近底部时会自动翻到触点上方；
- 点击菜单外区域、滚动消息、切换页面、发送或打开附件菜单都会关闭临时菜单。

## Required fidelity surfaces

- **布局**：已删除每条用户消息下方 48 rpx 的常驻操作行，默认消息节奏恢复；菜单使用 fixed overlay，不参与消息流排版。
- **触控**：真实 `longpress()` 打开菜单；透明整屏层负责外部关闭；功能本身仍由后端能力门禁决定。
- **资产**：复制、铅笔、撤回继续使用 Lucide `copy.svg`、`pencil.svg`、`undo-2.svg`，没有用 emoji、CSS 图形或手绘近似图标。
- **语义**：重新编辑仍创建分支并保留原会话；撤回仍只允许当前最后一轮且二次确认；改变的是呈现和触发层，不是删除权限。
- **长会话**：同一 E2E 继续验证长回答、来源、文档、图片、任务与 composer 均可到达；临时菜单没有增加纯色托底或新的滚动 owner。

## Interaction and console checks

- 默认态断言 `.message-action-menu` 不存在；
- 对真实用户气泡执行长按，断言菜单出现且包含允许的动作；
- 复制通过受控 `setClipboardData` stub 验证负载为“你好”，不覆盖验收电脑剪贴板；
- 纯文字和已保存图片重新编辑均创建新会话分支，图片编辑先恢复原图/原文字，原会话仍可切回；
- 撤回删除当前分支最后一个用户—助手消息对；
- 页面运行时异常监听为零；完整 M6 开发者工具 E2E 通过。

## Findings

- P0：无。
- P1：无。上一版常驻图标违背最新移动端参考，已删除。
- P2：无。菜单在当前视口没有越界、布局跳动、纯色托底或错位。
- P3：助手回答暂未开放长按复制；本轮保持既有“用户消息复制/编辑/撤回”能力范围，没有擅自扩功能。

## Implementation checklist

- [x] 默认态无常驻图标或文字按钮；
- [x] 长按具体用户消息后打开临时菜单；
- [x] 菜单使用图标加文字且支持外部关闭；
- [x] 菜单按视口自动避让；
- [x] 编辑、撤回的数据语义和所有权边界未改变；
- [x] 三组参考与 NOVA 两种状态进入同一比较图；
- [x] 微信开发者工具真实长按与完整回归通过；
- [x] 已保存图片消息的重新编辑、附件回填和新分支通过真实开发者工具验证；
- [x] 无 P0/P1/P2 剩余问题。

final result: passed

---

# M7 本地 v0.1 完整流程视觉 QA

## Evidence scope

本节只使用 2026-09-01 同一次最终微信开发者工具 E2E 产生的 17 张新截图，目录为：

`D:\植宠项目\验收记录\M7_2026-09-01\devtools-closure-v1`

截图覆盖登录、真实空首页、手动建档与封面、植宠详情、拍照入口、图片加配文草稿、真实 Vision、任务确认、首页今日任务、日历待办/完成、图文日记编辑/时间线/重开、RAG 来源、结构化记忆和系统设置。没有把 M6 旧截图作为 M7 当前画面证据。

## Step-by-step visual health

| 截图 | 健康度 | 视觉检查 |
|---|---|---|
| `01-login-page.png` | PASS | 品牌、登录主按钮和解释层级清楚；无裁切或遮挡 |
| `02-empty-home.png` | PASS | 真实零数据、未设置城市和零任务都可见；固定添加按钮不阻塞滚动 |
| `03-manual-pet-form-with-cover.png` | PASS | 用户选择的月季图、昵称和表单字段同屏；品种横向列表可滚动 |
| `04-pet-detail-after-create.png` | PASS | 自定义封面未被品种图覆盖；关键信息与状态卡清楚 |
| `05-photo-add-entry-menu.png` | PASS | 附件菜单贴近输入框，拍照/相册/文档入口可区分，不推动消息流 |
| `06-image-and-text-draft.png` | PASS | 图片缩略图、移除入口、配文和发送按钮位于同一 composer |
| `07-vision-result-no-task.png` | PASS | 用户原图/问题、结构化观察、保存动作完整可达；没有误任务卡 |
| `08-ai-task-confirmation-form.png` | PASS | AI 候选提示、植宠、类型、标题、说明、日期和确认主动作可见 |
| `09-home-today-task.png` | PASS | 今日任务与对应月季卡并存；固定添加按钮不改变任务事实 |
| `10-calendar-pending-task.png` | PASS | 月视图、日期标记和待办卡层级明确 |
| `11-calendar-completed-task.png` | PASS | 完成后的统计、绿色日期点和完成状态同步变化 |
| `12-journal-photo-text-composer.png` | PASS | 植宠、类型、日期、标题、正文、照片和保存操作完整可见 |
| `13-journal-timeline.png` | PASS | 保存反馈覆盖层短暂出现，时间线、文字、原图与编辑/删除仍可识别 |
| `14-reopened-journal-timeline.png` | PASS | 重开后无反馈遮罩，原图和文字持久恢复 |
| `15-ai-rag-sources.png` | PASS | 长回答末尾、三类来源卡和后续提问完整可达；composer 不截断内容 |
| `16-ai-memory-sources.png` | PASS | 长期偏好与业务来源副本边界清楚，来源对象和时间可见 |
| `17-settings-p0-hub.png` | PASS | 原生/自定义双导航已消除；自定义标题不与微信胶囊重叠；通知依赖和隐私入口首屏可见 |

## Findings and fixes

- P0：无。
- P1：无。
- P2：新设置页首轮截图出现原生导航与自定义导航重复，关闭原生导航后又发现标题/装饰占位可能进入微信胶囊区域；已复用项目详情页的右侧胶囊安全区、删除文字装饰符并重新跑完整 E2E。
- P3：空首页和有植宠首页的固定“添加植宠”按钮会覆盖当前滚动位置下方的一小段内容，但页面底部留有安全滚动空间，主流程元素均可到达；这是既有首页浮动主动作形态，本轮未擅自改为新布局。

## Interaction and console checks

- 主要触控目标使用既有按钮或整行入口，未新增只靠小字触发的核心操作；
- 图片选择后先成为草稿，发送前可配文或移除；
- AI 候选确认按钮固定在任务表单底部，但表单内容仍可滚动；
- 长回答、来源、任务卡与浮动 composer 共用既有安全区，最后内容可达；
- 系统设置入口真实导航且震动计数为 0；
- 完整流程运行时异常监听为 0。

本轮截图和代码检查不能证明完整 WCAG/无障碍合规，也不能替代 M8 实体手机在不同字号、系统缩放和安全区上的复测。

final result: passed for local DevTools visual closure; user acceptance pending

---

# 2026-09-07 深夜：整段摘要与原生行内功能

本节使用用户的 summary 参考 c0360fc0、行内功能参考 346ef9a5，与本次真实渲染截图一起输入视觉检查。目录为 D:/植宠项目/验收记录/M7_2026-09-07/summary-inline-devtools-v10 和 summary-inline-native-keys-v6；没有拿旧 M6 截图充当本轮结果。

| 状态 | 核对结果 |
|---|---|
| 摘要阅读 19-ai-memory-summary.png | 通过视觉检查：标题、更新时间、单段正文及一个编辑入口；不再默认逐条卡片。保留奶油白品牌色与一次启用开关，没有复制参考里与项目无关的个人内容。 |
| 全文编辑 19b-ai-memory-whole-edit.png | 通过视觉及页面操作：整段 textarea、字数、取消/保存同屏；原文保存恢复通过。409/服务失败保留草稿由页面单测及真实 API 专项覆盖，未把故障态单测冒充故障态截图。 |
| 功能与正文 02c-inline-function-with-text.png | 通过视觉及原生文档检查：同一行，去掉外部重复标签、叉号与模板提示词。修正 native 自定义区块强制换段，以及 enable-formats 清除图片尺寸导致巨型图标的问题。最终资产将字形下移到文本基线，重新对照。 |
| 输入框与附件 | 保留加号、真实 Lucide 图标、右侧发送箭头及附件草稿；无植宠/有植宠图文发送与重开恢复均进入104项完整流程。 |
| 实际键盘操作 | 待人工验收，不能标通过。native-keys-v6 的桌面窗口处在登录页、自动化实例处在聊天页；实例/焦点不一致，停止系统按键。程序调用 deleteText 的原子移除测试不算物理 Backspace。 |

有意保留的差异：现有三种只读功能仍共用品牌插件图标；创建任务、管理记忆继续跳现有表单，不增加工具权限。功能在原生 Delta 中是已注册的行内图像原子，不是 HTML 超链接或附件，后端只收到工具键与正文。未引入通用富文本工具栏，未知粘贴样式/嵌入被剥离。

证据：104项完整页面检查、37张截图、0条页面异常；最终字号/异步隔离补丁另经原生输入框专项与470项单测复核。整段摘要真实模型/API专项7项，上下文专项14项。电脑文件选择结果和确认框由测试注入；真机键盘、系统字号、拍照授权、云端均未验。

结论：摘要与输入框视觉/程序操作已复核；实际键盘端到端与用户最终验收仍待完成。本节状态为 partial，不覆盖或擦除此前历史批次结果。
