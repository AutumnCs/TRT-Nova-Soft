# 云端初版本机构建证据（2026-09-03）

> 证据边界：以下只证明云端候选在本机可以审查、安装冻结依赖、构建并打包；不证明腾讯云资源已创建、SCF Nodejs20.19 已运行、云 MySQL/Function URL/SCF 自定义域名/COS 已联通或真实微信端已通过。

## 1. 运行环境

- 工作区：`TRT_Nova_MVP_miniprogram_LastScf`
- 本机构建 Node：`v24.16.0`
- 本地 Node 20 兼容复核：`v20.20.2`（通过 `npx --yes node@20`）
- 目标腾讯云运行时：`Nodejs20.19`
- 最终重建时间：`2026-09-03 21:42:43 +08:00`

## 2. 候选自身测试

命令：

```powershell
node --test deployment/cloud-initial/test/cloud-candidate.test.mjs
npx --yes node@20 --test deployment/cloud-initial/test/cloud-candidate.test.mjs
```

结果：两种 Node 环境均为 `11 passed / 0 failed`。覆盖：

1. 5 个 SCF 单元和 lockfile/源依赖一致；
2. 高置信秘密扫描的正反例；
3. map、类型声明、依赖说明文档和 test/spec/fixture/sample/example 路径的精确分类；
4. 裁剪若命中 `.wasm/.node/证书/词典/二进制数据` 会在删除前失败，普通运行时资产保持不变；
5. `.env*`、开发期路径、本地媒体和绝对本机路径策略的负向样例；
6. 旧 API Gateway 路由模板不存在，Function URL + SCF 自定义域名 route contract 与 auth/api/agent handler 的真实方法和路径逐项一致；
7. 未填写的示例配置不能误过 release 门禁；
8. 即使填完资源元数据，`secret://` 解析未实现时仍不能通过 release 门禁；
9. Event Function、`cloud-entry.main_handler`、ZIP/Layer/环境变量/调用载荷配额合同均为机器可审计固定值；
10. 每函数逻辑与最终环境变量均按 UTF-8 字节计算，超过 4096 会失败，并明确逻辑模板计数不是最终渲染证据；
11. 云端入口阻断未实现的媒体能力、拒绝危险配置并能委派普通请求。

## 3. Build preflight

命令：

```powershell
node deployment/cloud-initial/tools/preflight.mjs
npx --yes node@20 deployment/cloud-initial/tools/preflight.mjs
```

结果：两次退出码均为 `0`。Node 20 输出 `ok: true`，确认 5 个函数均为 Event、统一入口 `cloud-entry.main_handler`、Nodejs20.19 目标契约、Function URL 路由模板、配额、白名单和锁文件可构建。主任务已清空源函数 `.env.example` 中先前的 9 个凭据式具体样例值，因此本轮 build preflight 警告为 0；历史值是否已在云侧轮换仍由 release acknowledgement 单独阻断，不能由“样例清空”代替。

## 4. 生产依赖在线审计

命令：

```powershell
pwsh -NoProfile -File deployment/cloud-initial/audit-dependencies.ps1
```

数据源：`https://registry.npmjs.org` 的 npm audit 接口。

结果：退出码 `0`；auth/api/ingest/agent/history-cleanup 五个生产 lockfile 在本次查询中均为 `info=0, low=0, moderate=0, high=0, critical=0`。

这是时间点结果，不是永久安全证明；真实发布必须重新联网审计并记录结果。

## 5. 干净 staging 与 ZIP 构建

命令：

```powershell
pwsh -NoProfile -File deployment/cloud-initial/build-cloud-candidate.ps1
```

结果：退出码 `0`。5 个 staging 均执行 `npm ci --omit=dev --ignore-scripts`，随后执行依赖裁剪、完整 staging 内容策略扫描、ZIP 根目录与逐文件 manifest 校验。

| 函数 | staging payload 文件数 | staging payload 字节数 | ZIP 字节数 | ZIP SHA-256 |
|---|---:|---:|---:|---|
| auth-scf | 168 | 1,338,168 | 523,191 | `319521a60bf003521a8965389d1861fb62c3b74b9aa357d76cd7e09fed404435` |
| api-scf | 945 | 5,473,030 | 1,798,593 | `71a40c5e03ca7b3db3c979243325b96c479baa3dd7bf84dd8c56f1af595d2882` |
| ingest-scf | 168 | 1,354,816 | 526,976 | `d04de1ca93e93ebb4304931c26eba4d71abab948b104e555ed3606a9665ae477` |
| agent-scf | 1,771 | 19,451,800 | 6,620,085 | `d54bc1d6acdfdd6bff3558c0ae86b7e65e8a12dcf52b07d0cc9f125b20251260` |
| history-cleanup-scf | 168 | 1,335,224 | 522,050 | `4e14731de58b9fe95e398e473536f5d6b949240ab976e07b4547bc720265f097` |

本次 `source-policy.json` SHA-256：`48bff8fb651bec136100ebf531edf7e926a808584c190a26eb7a02ef89db10bd`。

这些值来自被 Git 忽略的 `artifacts/RELEASE_MANIFEST.json`。重新构建会因为 manifest 时间戳和 ZIP 元数据产生新哈希，发布记录必须使用实际上传批次的新值。

### 5.1 独立审计缺口与裁剪结果

构建前的独立 ZIP 审计发现：

| 函数 | 第三方 source map | 明显 test/tests/spec/fixture/sample/example |
|---|---:|---:|
| auth-scf | 0 | 1 |
| api-scf | 243 | 49 |
| ingest-scf | 0 | 1 |
| agent-scf | 20 | 77 |
| history-cleanup-scf | 0 | 1 |
| **合计** | **263** | **129** |

修复没有手工修改 ZIP，而是在每次 `npm ci` 后执行同一份可审计规则。本次实际裁剪统计如下：

| 函数 | 删除文件 | 删除字节 | 其中 map | 开发目录 | 开发文件名 | 类型声明 | 依赖说明文档 | 受保护冲突 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| auth-scf | 196 | 2,821,819 | 0 | 0 | 3 | 181 | 12 | 0 |
| api-scf | 748 | 5,696,487 | 243 | 66 | 12 | 359 | 68 | 0 |
| ingest-scf | 196 | 2,821,819 | 0 | 0 | 3 | 181 | 12 | 0 |
| agent-scf | 342 | 19,631,182 | 20 | 76 | 8 | 189 | 49 | 0 |
| history-cleanup-scf | 196 | 2,821,819 | 0 | 0 | 3 | 181 | 12 | 0 |

`受保护冲突=0` 表示当前依赖没有要求构建器删除落在开发期路径下的 `.wasm/.node/证书/词典/二进制数据`；它不表示构建器会忽略这类冲突，单元测试已经证明一旦出现会在任何删除前失败。

## 6. ZIP 卫生、staging 一致性与包内哈希

命令：

```powershell
pwsh -NoProfile -File deployment/cloud-initial/verify-cloud-candidate-artifacts.ps1
```

结果：退出码 `0`，`artifacts/PACKAGE_POLICY_REPORT.json` 为 `ok: true`。五个 ZIP 的逐包结果均为：

- source map：0；
- test/spec/fixture/sample/example 开发期产物：0；
- 类型声明和依赖说明文档：0；
- `.env*`：0；
- 第一方本地媒体：0；
- 完整 staging 高置信疑似秘密：0；
- 完整 staging 绝对本机路径：0；
- ZIP 条目与 staging 文件路径完全一致；
- ZIP payload 的路径、字节数和 SHA-256 与 `NOVA_PACKAGE_MANIFEST.json` 完全一致。
- 每个 ZIP 均 `<52,428,800` 字节；解压代码加显式 `0` Layer 均 `<=524,288,000` 字节。

逐包解压代码+Layer 字节数：auth `1,369,238`、api `5,649,230`、ingest `1,385,889`、agent `19,786,922`、history-cleanup `1,366,305`。这只证明本地候选明确不含 Layer；发布时仍必须核对目标函数版本未被控制台绑定额外 Layer。

ZIP 条目数（包含包内 manifest）分别为：auth 169、api 946、ingest 169、agent 1,772、history-cleanup 169。

## 7. 构建包入口 smoke

命令：

```powershell
node deployment/cloud-initial/tools/smoke-built-packages.mjs
npx --yes node@20 deployment/cloud-initial/tools/smoke-built-packages.mjs
```

结果：两次退出码均为 `0`。验证到的层级是“ZIP 解压前对应的 staging 包可以加载云入口与真实源 handler”：auth 的未知路径返回 404；api 媒体路由由云入口返回 501；agent 健康检查返回 200；ingest 非 `/ingest` 路径返回 404；history-cleanup 的公开 HTTP 调用返回 403。

这个 smoke 刻意没有访问微信、MySQL、LLM、IoT 或腾讯云资源，因此不能代替集成测试。

## 8. Release 门禁负向验证

命令：

```powershell
node deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.example.json
npx --yes node@20 deployment/cloud-initial/tools/preflight.mjs --release --config deployment/cloud-initial/candidate.config.example.json
```

结果：Node 24 与 Node 20.20.2 退出码均为 `1`，符合预期。阻断原因包括：

- 历史凭据轮换证明尚未确认（受控样例文件中的具体值已清空，当前 build scan 为 0）；
- 地域、namespace、Function URL 自定义 HTTPS 域名、VPC/NAT、云数据库和秘密逻辑引用仍是占位符；
- `secret://` 是 NOVA 逻辑引用，runtime SSM SDK 与授权发布器解析均未实现；
- 每函数最终渲染环境变量的 UTF-8 字节证据与目标版本 Layer 清单未确认；
- Function URL event 兼容、自定义域名 path mapping、同步/异步载荷边界、VPC 私网数据库+公网 Provider 出站、定时触发器时区语义均未在 staging 实测；
- 数据库迁移尚未确认经过空库与存量库克隆验证；
- 云媒体生命周期未验证，当前只能保持 `media.mode=disabled`。

如果示例配置此时返回 0，反而表示发布门禁失效。

## 9. 当前判定

| 判定项 | 结论 |
|---|---|
| 可审查 | PASS |
| 可从干净 staging 构建 5 个 ZIP | PASS |
| Node 20 主版本静态/单元兼容 | PASS（20.20.2） |
| 可上传到隔离腾讯云 staging 继续验证 | YES，仅作 D 层验证输入；须先实现秘密解析并由云管理员配置资源 |
| 可直接部署生产 | NO |
| 腾讯云真实运行验收 | NOT RUN |
| 图片/文档完整云链路 | BLOCKED（COS 服务端生命周期未实现） |
| 数据库迁移/回滚演练 | NOT RUN |
| 真机微信合法域名与 TLS | NOT RUN |
| Function URL event / 自定义域名 path mapping | NOT RUN |
| VPC + NAT 公网 Provider 出站 | NOT RUN |
| 最终环境变量 4096 字节与运行载荷边界 | NOT RUN（逻辑模板计数不替代最终值） |
| 定时触发器时区语义 | NOT RUN |
