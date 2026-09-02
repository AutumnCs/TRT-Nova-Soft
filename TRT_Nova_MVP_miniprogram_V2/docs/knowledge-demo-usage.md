# 知识库 Demo 使用说明

## 目标

这套 demo 提供一条完整的知识库链路：

- 内容层：文章 seed、数据库表、导入脚本
- 检索层：关键词搜索、分类筛选、标签筛选、植物类型筛选
- 展示层：知识库首页、文章详情页
- AI 层：文章上下文注入到助手对话

## 准备步骤

1. 在 MySQL 中执行 `reference/knowledge.v1.sql`。
2. 通过 `scripts/import-knowledge-articles.js` 导入 seed 文章。
3. 确认 `api-scf` 和 `agent-scf` 已部署到腾讯云。
4. 打开小程序的“植宠知识库”页进行检索和浏览。

## 数据源约定

- `data/knowledge/articles.json` 是编辑源。
- `knowledge_articles` 是运行源。
- 页面和 AI 只依赖接口，不直接依赖表结构。

## 主要接口

- `GET /knowledge/categories`
- `POST /knowledge/articles`
- `POST /knowledge/article`
- `POST /knowledge/search`
- `POST /knowledge/recommend`
- `POST /knowledge/context`

## 页面入口

- 知识库首页：`pages/wiki/wiki`
- 文章详情页：`pages/wikiDetail/wikiDetail`
- AI 助手：`pages/assistant/assistant`

## 维护方式

- 新增文章时，优先修改 `data/knowledge/articles.json`。
- 修改后重新执行导入脚本即可同步数据库。
- 文章分类、标签、植物类型、问题场景都建议保持稳定命名。
- `sourceRef` 用于追踪文章来源，便于后续迁移到正式内容系统。

## 当前验收状态

- 知识库首页已接入文章列表与筛选。
- 文章详情页已可打开并展示正文。
- “去问 AI”会把当前文章作为上下文传给助手。
- `api-scf` 与 `agent-scf` 已新增知识库检索能力。
- 仍需在腾讯云上完成 MySQL 导入和线上联调验证。
