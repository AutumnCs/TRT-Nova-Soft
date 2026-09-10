# M4 知识内容审核包

更新日期：2026-09-10

当前状态：全部内容已获批并在本地 MVP 发布；2026-09-10 按用户本次明确要求发布到当前独立 staging，知识发布专项复验通过。临时 MVP 数据定位不变，双账号与手机验收仍待进行。

获批内容：17 个植物档案、10 篇跨植物养护/可见问题文章

## 审核结论

- 审核结论：批准全部 M4 内容草稿发布。
- 审核人：`dola`。
- 审核记录时间：`2026-08-27 18:23:54`（Asia/Shanghai）。
- 授权范围：当前只作为临时数据完成本地 MVP 闭环；未来保留、修订或整体替换需要另行讨论，但不阻塞当前 MVP。
- 边界：本次批准允许在当前本地 MVP 中标记为 `published`，不等于已经确定长期内容资产方案，也不构成线上部署授权。

## 2026-09-10 staging 发布补充

用户本次明确要求先补齐“已审核知识发布”和“真实后台清理”，专项复验通过后再做双账号与手机验收。因此本次获得向当前独立 staging 发布的授权；不追溯扩大上面的原审核范围。

复用原审核记录与现有导入器，核对源文件和实际部署包内容一致后，先事务 dry-run/回滚，再于 20:17 提交。当前云端为 10 篇 published 文章、17 个 published 植物档案；审核人、审核时间、来源和正文未变。真实列表、详情、搜索命中、无匹配返回空结果、图鉴页面及真实模型知识引用已通过；普通知识问答未创建任务。完整脱敏证据保留在本机 2026-09-10 云端验收的专项复验目录。

下表 ID 为原审核包中的条目标识，不是此次云数据库自增主键；跨环境按 slug/sourceId 关联。当前发布不意味着长期内容资产方案或手机验收已完成。

## 发布门槛

- 只有人工审核通过并标记为 `published` 的内容，才会出现在知识页、搜索结果和 Agent RAG 中。
- 审核人需要确认中文表述、事实边界、来源可追溯性和图片授权说明。
- 没有匹配到已发布依据时，系统必须回答“当前已发布知识库中没有足够依据”，不得返回排序靠前但不相关的内容。
- 当前内容没有使用或热链外部图片；界面统一使用仓库内默认占位图。每条内容的图片说明均为“未使用外部图片；界面使用仓库内默认占位图”。
- 具体正文和结构化字段以 [articles.json](../data/knowledge/articles.json) 与 [plants.json](../data/knowledge/plants.json) 为准。本文件是审核索引，不替代原始内容。

## 10 篇知识文章

| ID | 标题 | 核心表述 | 来源机构与标识 |
|---|---|---|---|
| 101 | 浇水先看盆土和植株，不按固定天数 | 日历只能提醒检查；浇水要结合盆土、盆重、植株和排水，湿土萎蔫不能直接继续补水。 | University of Minnesota Extension · `UMN-SHPC-2026` |
| 102 | 增加光照要循序渐进，避免突然暴晒 | 室内植物转到更强光照时逐步适应，并区分灼伤与长期缺光表现。 | University of Minnesota Extension · `UMN-HOUSEPLANTS-OUTSIDE-2026` |
| 103 | 提高湿度时也要保留空气流动 | 提湿不等于让叶面长期潮湿；植株拥挤、通风不足可能增加病害风险。 | Clemson Cooperative Extension HGIC · `CLEMSON-HGIC-2251` |
| 104 | 换盆先确认根系和排水，不盲目换大盆 | 根系挤满、排水变差或盆土异常快干才是常见换盆信号；新盆只略大一号。 | University of Minnesota Extension · `UMN-SHPC-2026` |
| 105 | 黄叶是现象，不是单一诊断 | 黄叶可能来自浇水、光照、根系、虫害、肥盐或自然老化，需结合新老叶和盆土判断。 | Clemson Cooperative Extension HGIC · `CLEMSON-HGIC-2251` |
| 106 | 盆土湿却萎蔫时，先检查根系 | 萎蔫也可能来自积水、根腐、肥盐或低温；湿土情况下连续补水可能加重问题。 | University of Maryland Extension · `UMD-DIAGNOSE-INDOOR-2025` |
| 107 | 施肥配合生长状态，少量开始 | 肥料不能替代光、水和健康根系；弱光、休眠或根部异常时不应靠加肥“抢救”。 | University of Minnesota Extension · `UMN-SHPC-2026` |
| 108 | 发现虫害先隔离、观察和确认 | 先检查叶背、嫩梢、叶腋和盆缘，隔离受影响植株，确认对象后再选择处理方法。 | Clemson Cooperative Extension HGIC · `CLEMSON-HGIC-2252` |
| 109 | 叶斑先记录形态和扩散，再决定处理 | 记录位置、形态、是否扩散及叶面干湿；清洁、隔离和改善通风是低风险起点。 | Penn State Extension · `PENNSTATE-INDOOR-PESTS-DISEASES` |
| 110 | 月季盆栽养护先抓光照、排水和巡检 | 月季通常需要充足光照、排水良好基质和持续巡检；浇水按盆土而非固定天数。 | NC State Extension Plant Toolbox · `NCSU-PLANT-ROSA` |

## 17 个植物档案

| 植物 | 学名 | 档案中的主要养护边界 | 来源标识 |
|---|---|---|---|
| 龟背竹 | *Monstera deliciosa* | 明亮散射光或部分遮阴；上部约 1/4–1/3 基质干后再浇；需要支撑。 | `NCSU-PLANT-MONSTERA-DELICIOSA` |
| 多肉・玉露 | *Haworthia cooperi* | 明亮散射光到柔和日照；基质干后浇透；避免叶心和盆底积水。 | `NCSU-PLANT-HAWORTHIA` |
| 天堂鸟 | *Strelitzia reginae* | 光照充足；直射光需逐步适应；春夏适度水分，冬季稍干。 | `NCSU-PLANT-STRELITZIA-REGINAE` |
| 银斑葛 | *Scindapsus pictus* | 明亮散射光；表层干后浇透；避免长期湿土。 | `NCSU-PLANT-SCINDAPSUS-PICTUS` |
| 月季 | *Rosa* | 多数品种需要充足日照；按盆土浇透；避免积水和反复只浇表层。 | `NCSU-PLANT-ROSA` |
| 绿萝 | *Epipremnum aureum* | 明亮散射光最佳；排水良好的基质在两次浇水间适度变干。 | `NCSU-PLANT-EPIPREMNUM-AUREUM` |
| 吊兰 | *Chlorophytum comosum* | 中等到明亮散射光；适度湿润但不积水。 | `NCSU-PLANT-CHLOROPHYTUM-COMOSUM` |
| 虎尾兰 | *Dracaena trifasciata* | 可耐低光；盆土干后再浇；冬季显著减少水分。 | `NCSU-PLANT-DRACAENA-TRIFASCIATA` |
| 橡皮树 | *Ficus elastica* | 明亮散射光或部分遮阴；规律浇水但避免过量；避冷风。 | `NCSU-PLANT-FICUS-ELASTICA` |
| 白掌 | *Spathiphyllum* | 散射光或部分遮阴；保持适度湿润但根部不长期泡水。 | `NCSU-PLANT-SPATHIPHYLLUM` |
| 金钱树 | *Zamioculcas zamiifolia* | 散射光到较低光照；基质明显变干后再浇；避免频繁少量浇水。 | `NCSU-PLANT-ZAMIOCULCAS` |
| 玉树 | *Crassula ovata* | 明亮光照；增强强光时逐步适应；基质干后浇透。 | `NCSU-PLANT-CRASSULA-OVATA` |
| 芦荟 | *Aloe vera* | 充足光照或明亮散射光；粗颗粒排水基质；基质干后浇透。 | `NCSU-PLANT-ALOE-VERA` |
| 绣球 | *Hydrangea macrophylla* | 斑驳光或半阴；较稳定水分并保证排水；高温盆栽勤观察。 | `NCSU-PLANT-HYDRANGEA-MACROPHYLLA` |
| 薰衣草 | *Lavandula angustifolia* | 充足直射光；快速排水和空气流动；浇透后让基质充分变干。 | `NCSU-PLANT-LAVANDULA-ANGUSTIFOLIA` |
| 常春藤 | *Hedera helix* | 散射光到半阴；适度湿润且排水良好；部分地区具入侵风险，不随意放归户外。 | `NCSU-PLANT-HEDERA-HELIX` |
| 波士顿蕨 | *Nephrolepis exaltata* | 明亮散射光；较高空气湿度；基质均匀湿润但不积水。 | `NCSU-PLANT-NEPHROLEPIS-EXALTATA` |

以上植物档案均引用 North Carolina Extension Gardener Plant Toolbox 的对应物种页面。来源 URL、来源标题、内容更新时间、常见问题、FAQ 和推荐提问均保存在 `plants.json` 中。

## 发布后处理

所有获批条目写入相同的审核时间和审核人，并标记为 `published`。长期方案评审时，应重新决定这批临时 MVP 数据是原样保留、逐条修订还是整体替换；在该决策形成前，不得把当前数据集描述为最终正式知识资产。
