# NOVA 腾讯云候选发布记录模板

> 状态：未发布 / 未验证
> 禁止记录密钥、Token、openid 明文、私密文档或用户内容正文。

## 1. 发布身份

| 字段 | 内容 |
|---|---|
| 环境 | TODO |
| Git commit / branch | TODO |
| 构建编号 | TODO |
| 小程序版本 | TODO |
| 数据库 Schema 版本 | TODO |
| 发布时间窗 | TODO |
| 发布负责人 | TODO |
| 回滚负责人 | TODO |

## 2. 重大变更披露

- 保留：TODO
- 删除或替换：TODO
- 改为非默认：TODO
- 新增：TODO
- 重组：TODO
- 本地化妥协关闭/仍保留：TODO
- 未实现与不在范围：TODO

## 3. P0/P1 门禁

| 门禁 | 结果 | 证据 |
|---|---|---|
| 本次凭据受控来源与仓库/包扫描 | TODO | TODO |
| 云媒体服务端生命周期 | TODO | TODO |
| 数据库备份与恢复演练 | TODO | TODO |
| 版本化迁移的空库/克隆验证 | TODO | TODO |
| 5 个函数可复现构建 | TODO | TODO |
| 5 个 Event Function + `index.main_handler` 一致性 | TODO | TODO |
| Function URL event 结构兼容性（staging 实测） | TODO | TODO |
| 独立 Function URL 路径/鉴权头保留（staging 实测） | TODO | TODO |
| SCF 环境变量就绪、最小权限和脱敏 | TODO | TODO |
| 每函数最终环境变量 UTF-8 总字节 `<=4096` | TODO | TODO |
| ZIP `<50MiB`、解压代码+Layer `<=500MiB`、目标版本 Layer 清单 | TODO | TODO |
| 同步 `<=6MiB` / 异步 `<=128KiB` 边界（staging 实测） | TODO | TODO |
| 沿用 LastScf 实际数据库链路与外部接口连通性（记录 legacy-direct/private-network/required） | TODO | TODO |
| 定时触发器时区语义与 Asia/Shanghai 业务日期（staging 实测） | TODO | TODO |
| 微信身份、HTTPS 与合法域名 | TODO | TODO |
| 已启用 Provider（默认不含 IoT） | TODO | TODO |
| 灰度/回滚演练 | TODO | TODO |

任何 P0/P1 未通过时，发布决策必须为 `NO-GO`。

## 4. 函数构建与部署

| 单元 | handler | runtime | ZIP 大小 | SHA-256 | 函数版本 | 上一版本 | 测试/扫描证据 |
|---|---|---|---:|---|---|---|---|
| auth-scf | `index.main_handler` | TODO | TODO | TODO | TODO | TODO | TODO |
| api-scf | `index.main_handler` | TODO | TODO | TODO | TODO | TODO | TODO |
| ingest-scf | `index.main_handler` | TODO | TODO | TODO | TODO | TODO | TODO |
| agent-scf | `index.main_handler` | TODO | TODO | TODO | TODO | TODO | TODO |
| history-cleanup-scf | `index.main_handler` | TODO | TODO | TODO | TODO | TODO | TODO |

构建机 Node/npm、lockfile、`npm ci --omit=dev` 和源码白名单：TODO

## 5. 独立 Function URL 与客户端

| 项目 | 结果 | 证据 |
|---|---|---|
| Event Function + Function URL | TODO | TODO |
| Auth/API/Agent 三个独立地址与路径 | TODO | TODO |
| 目标函数 HTTPS 地址可用 | TODO | TODO |
| 微信 request/upload/download 合法域名 | TODO | TODO |
| experience/release 地址无 localhost | TODO | TODO |
| `urlCheck` 开启 | TODO | TODO |
| 小程序体验版上传与回滚版本 | TODO | TODO |

真实域名和资源 ID 只记录在受控发布系统；本模板仓库副本保留脱敏引用。

## 6. Provider 与媒体

| 能力 | 成功场景 | 失败/回退 | 隔离/安全 | 证据 |
|---|---|---|---|---|
| 微信 code2Session | TODO | TODO | TODO | TODO |
| Chat | TODO | TODO | TODO | TODO |
| Vision | TODO | TODO | TODO | TODO |
| QWeather | TODO | TODO | TODO | TODO |
| OneNET/EMQX | TODO | TODO | TODO | TODO |
| 图片/文档对象存储 | TODO | TODO | TODO | TODO |

## 7. Agent 灰度

| 阶段 | 开关 | 样本率 | 观察窗口 | 接管/回落 | 错误/越权/副作用 | P50/P95 | 结论 |
|---|---|---:|---|---|---|---|---|
| Legacy only | Shadow=false, Rollout=false | 0 | TODO | TODO | TODO | TODO | TODO |
| Shadow | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| Low-risk rollout | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

必须记录：当前是 Node.js 20 PI 语义兼容内部 runtime，不是官方 PI Core/`pi-coding-agent`/完整 AgentHarness。

## 8. 五层证据

| 层级 | 是否执行 | 通过/失败/跳过 | 证据路径 | 不能支持的结论 |
|---|---|---|---|---|
| A 本地单元/契约 | TODO | TODO | TODO | TODO |
| B 本地 API/MySQL | TODO | TODO | TODO | TODO |
| C 微信 DevTools | TODO | TODO | TODO | TODO |
| D 云端体验版 | TODO | TODO | TODO | TODO |
| E 实体手机 | TODO | TODO | TODO | TODO |

## 9. 缺陷和限制

| ID | 等级 | 场景 | 状态 | 修复/规避 | 复测证据 |
|---|---|---|---|---|---|
| TODO | TODO | TODO | TODO | TODO | TODO |

未执行项和证据边界：TODO

## 10. 发布/回滚判定

- 最终决定：`TODO（NO-GO / STAGING ONLY / EXPERIENCE ONLY / RELEASE）`
- 决策依据：TODO
- 观察截止：TODO
- 回滚触发线：TODO
- 实际是否回滚：TODO
- 回滚版本和验证：TODO

## 11. 审批

| 角色 | 姓名 | 结论 | 时间 |
|---|---|---|---|
| 项目负责人 | TODO | 未审批 | TODO |
| 后端/Agent 负责人 | TODO | 未审批 | TODO |
| 云/安全负责人 | TODO | 未审批 | TODO |
| 测试负责人 | TODO | 未审批 | TODO |
| 小程序管理员 | TODO | 未审批 | TODO |
