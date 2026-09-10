# M4 知识库使用说明

## 目标与边界

M4 提供一条受人工审核约束的知识链路：

- 内容层：17 个植物档案、10 篇养护/可见问题文章、来源和审核字段；
- 运行层：MySQL 是主存储，JSON 只作 seed 和数据库错误时的 fallback；
- 检索层：关键词、分类、标签、植物类型检索，无匹配时明确返回未知；
- 展示层：知识库首页、植物图鉴、文章详情和可复制来源；
- Agent 层：只有人工复核并发布的内容进入 RAG。

当前 17 个植物档案和 10 篇文章已由 `dola` 批准用于本地 MVP 发布。审核结论与临时数据限制见 [`m4-content-review-package.md`](./m4-content-review-package.md)。未来保留或替换该内容集仍需另行讨论。

## 本地准备

全新本地库运行：

```powershell
npm run local-db
```

已有本地库先执行一次 `reference/knowledge-content.m4.sql`，再导入内容：

```powershell
node scripts/import-knowledge-articles.js
```

导入器会校验来源标题、发布机构、来源 URL、来源标识、内容更新时间和图片许可。`published` 条目还必须有 `reviewedAt` 与 `reviewedBy`。

## 数据源约定

- `data/knowledge/articles.json` 与 `data/knowledge/plants.json` 是本地编辑和导入源；
- `knowledge_articles` 与 `plant_library` 是运行源；
- `dist/scf/api-scf/data/knowledge/` 与 `dist/scf/agent-scf/data/knowledge/` 保存部署所需 fallback 副本；
- 数据库查询成功但返回空集时必须保持空集，不得用 JSON 填满页面；
- 数据库异常时，fallback 也只暴露 `published` 条目；缺少状态一律按 `draft` 处理。

## 主要接口

- `GET /knowledge/categories`
- `POST /knowledge/articles`
- `POST /knowledge/article`
- `POST /knowledge/search`
- `POST /knowledge/recommend`
- `POST /knowledge/context`
- `POST /knowledge/plants`
- `POST /knowledge/plant`

## 页面入口

- 知识库首页与植物图鉴：`pages/wiki/wiki`
- 文章详情：`pages/wikiDetail/wikiDetail`
- AI 助手：`pages/assistant/assistant`

## 审核与发布

1. B 起草或修改内容；
2. C、用户或指定审核人确认正文、来源和图片许可；
3. 获批条目填写 `reviewedAt`、`reviewedBy` 并改为 `published`；
4. 重新运行导入器；
5. 执行单元测试、真实接口验证和 `npm run devtools-m4-e2e`；
6. 检查知识页数量、搜索命中、详情来源、植物档案展开、草稿排除和未知回答。

未经明确审核的条目继续保持 `draft`，不能为了页面数量或演示效果提前发布。

## 当前验收状态

- M4 Schema、导入器、页面、API、Agent 发布门禁和来源字段已在本地实现；
- 内容审核已完成，审核人为 `dola`；获批条目已写入审核字段并标记为 `published`；
- 发布前已经通过真实 `/auth/login`、API、Agent 和微信开发者工具验证草稿不可见、不可检索；
- 发布后已经通过真实 `/auth/login`、API、Agent 和微信开发者工具端到端验收，当前等待用户进行 M4 最终验收；
- 本批内容仅为当前 MVP 的临时数据实现，长期保留、修订或替换待后续决定；
- 未部署到体验版或任何线上环境。
