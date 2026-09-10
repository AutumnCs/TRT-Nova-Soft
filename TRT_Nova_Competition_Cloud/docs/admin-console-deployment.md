# TRT Nova 管理后台部署流程

本文对应当前仓库的 `admin-web/` 和 `dist/scf/admin-scf/`。

## 一、部署前状态

本版本包含：

- 静态管理后台：`admin-web/`
- 管理 API：`dist/scf/admin-scf/`
- 知识库 MySQL repository 和 seed fallback
- 管理员密码哈希、JWT 登录和角色字段
- 设备、用户、日志只读接口

现有小程序使用的 `auth-scf`、`api-scf`、`ingest-scf` 不需要因为后台上线而更新。

## 二、数据库初始化

继续使用现有轻量服务器上的 MySQL，先备份数据库，再执行：

```sql
-- reference/admin-console.v1.sql
```

该脚本新增或准备以下表：

- `knowledge_articles`
- `admin_users`

不要删除或重建现有业务表。若 `knowledge_articles` 已经存在，应先对照字段执行迁移，不要直接覆盖。

导入 seed 文章：

```powershell
$env:DB_HOST = '数据库地址'
$env:DB_PORT = '3306'
$env:DB_NAME = '数据库名'
$env:DB_USER = '数据库用户'
$env:DB_PASSWORD = '数据库密码'
node scripts/import-knowledge-articles.js
```

第一次建议先使用脚本的 dry-run 选项确认文章数量，再正式导入。

## 三、创建管理员密码

不要把明文密码写进数据库或代码。用 `dist/scf/admin-scf/lib/auth.js` 的 `hashPassword()` 生成哈希，写入 `admin_users.password_hash`：

```js
import { hashPassword } from './dist/scf/admin-scf/lib/auth.js';

console.log(await hashPassword('替换成管理员密码'));
```

插入管理员：

```sql
INSERT INTO admin_users (username, password_hash, role, status)
VALUES ('owner', '这里填生成的哈希', 'owner', 'active');
```

## 四、部署 admin-scf

函数运行时使用 Node.js，入口为：

```text
index.main_handler
```

上传包的根目录必须直接包含 `index.js`、`package.json`、`lib/` 等文件，不要把整个 `admin-scf` 目录再套一层。根目录的 `index.js` 是 SCF 兼容的 CommonJS 启动适配层，业务模块位于 `lib/`，其中的 `lib/package.json` 保持 ESM 模式。腾讯云 SCF 支持根据根目录 `package.json` 在线安装依赖，也可以先在本地安装后一起上传；当前函数依赖为 `mysql2`。

环境变量：

```text
DB_HOST=轻量服务器数据库地址
DB_PORT=3306
DB_NAME=数据库名
DB_USER=数据库用户
DB_PASSWORD=数据库密码
DB_CONN_LIMIT=5
ADMIN_JWT_SECRET=随机生成的长密钥
ADMIN_CORS_ORIGIN=https://admin.example.com
```

`ADMIN_JWT_SECRET` 不要和小程序 JWT secret 共用。生产环境使用长度足够的随机值，并通过 SCF 环境变量或密钥管理配置，不要写入仓库。

数据库未配置完整时，知识读取会回退 seed，但管理员登录会 fail-closed，不会自动开放。

## 五、函数 URL 和域名

先给 `admin-scf` 配置函数 URL，用于联调：

```text
GET  /admin/health
POST /admin/auth/login
GET  /admin/knowledge/articles
GET  /admin/knowledge/article
POST /admin/knowledge/articles
DELETE /admin/knowledge/articles
GET  /admin/devices
GET  /admin/users
GET  /admin/logs
```

联调成功后，再考虑绑定管理后台专用域名，例如 `admin.example.com`。不要把后台 API 和小程序 API 共用一个域名路径，方便后续做权限和日志隔离。

## 六、部署静态后台

将 `admin-web/` 目录下的文件上传到 COS 或其他静态站点托管服务。

部署前修改 `admin-web/config.js`：

```js
globalThis.__ADMIN_API_BASE_URL__ = 'https://你的-admin-scf-域名';
```

如果使用独立域名，`ADMIN_CORS_ORIGIN` 必须填写静态后台的完整 origin，例如：

```text
https://admin.example.com
```

COS 静态网站配置：

- 索引文档：`index.html`
- 错误文档：`index.html` 或单独的 `404.html`
- 生产环境优先配置自定义域名和 HTTPS
- 不要把数据库密码、JWT secret 或管理员密码上传到 COS

## 七、联调验收

先检查健康接口：

```powershell
curl.exe https://你的-admin-scf-域名/admin/health
```

登录：

```powershell
curl.exe -X POST https://你的-admin-scf-域名/admin/auth/login `
  -H "content-type: application/json" `
  -d '{"username":"owner","password":"你的密码"}'
```

拿到 token 后请求知识库：

```powershell
curl.exe https://你的-admin-scf-域名/admin/knowledge/articles `
  -H "Authorization: Bearer 你的token"
```

验收标准：

- 未带 token 的管理接口返回 `401`
- 错误密码返回 `401`
- 正确登录返回 JWT
- 文章列表来自 MySQL
- MySQL 暂时不可用时只读知识接口可回退 seed
- 前端页面能登录并加载总览
- CORS 预检请求返回 `204`

## 八、暂时不要做的事

- 不需要为 admin-scf 新开 Lighthouse
- 不需要更新小程序现有五个 SCF
- 不要把 OneNET / EMQX 原始控制权放进后台
- 不要把数据库密码写入前端或 COS
- 不要在没有备份的情况下执行破坏性 SQL

## 九、回滚

如果后台部署失败：

1. 静态站点回退到上一版文件。
2. 停用或删除 admin-scf 函数 URL，不影响小程序。
3. 保留 `knowledge_articles` 和 `admin_users` 表，不要直接删除。
4. 恢复数据库前先确认是否已经有正式文章写入。
