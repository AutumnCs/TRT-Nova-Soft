# 环境配置与切换说明

当前仓库已经把小程序运行地址从 `app.js` 的硬编码收口成“环境档位 + 可选覆盖”的方式，目标是让开发、测试、生产三套口径能分开管理。

## 1. 小程序运行时配置入口

当前入口文件是：

- `envList.js`
- `services/config/runtimeProfiles.js`
- `services/config/runtime.js`

其中：

- `runtimeProfiles.js` 负责定义 `dev / test / prod` 三套基础配置
- `envList.js` 负责选择当前启用哪个 profile
- `runtimeConfigOverrides` 用于本地临时覆盖某几个地址，不需要改动主配置结构

## 2. 当前默认行为

- 默认 profile：`prod`
- `prod` 已保留当前真实在用的 SCF 地址
- `dev / test` 先留空，等后续准备对应环境时再填
- CloudBase 默认关闭，仅在明确需要时打开

这意味着：

- 现有演示链路不会被打断
- 后续补测试环境时，不需要再改 `app.js`

## 3. 如何切换环境

编辑 `envList.js`：

```js
const runtimeProfile = 'test';

const runtimeConfigOverrides = {
  scfApiBaseUrl: 'https://your-test-api',
  agentScfBaseUrl: 'https://your-test-agent',
  authScfBaseUrl: 'https://your-test-auth'
};
```

如果只是偶尔联调某一个地址，也可以只覆盖单个字段。

## 4. 推荐管理方式

建议按下面的职责来维护：

- `prod`：仓库内保留正式稳定配置
- `test`：仓库内保留测试环境标准地址
- `dev`：仓库内可只放空模板，由开发者通过 `runtimeConfigOverrides` 本地覆盖

## 5. SCF / 定时任务环境变量

SCF 侧的环境变量示例已经同步在各函数目录：

- `dist/scf/api-scf/.env.example`
- `dist/scf/ingest-scf/.env.example`
- `dist/scf/history-cleanup-scf/.env.example`
- `dist/scf/auth-scf/.env.example`
- `dist/scf/agent-scf/.env.example`

建议做法：

- 开发、测试、生产三套环境变量分开维护
- Redis、MySQL、IoT 平台参数不要混用
- 生产环境只通过云端环境变量平台维护，不在仓库写死密钥

配套总表见：

- [Trial Environment Variable Matrix](./trial-environment-variable-matrix.md)

## 6. 这一轮收口后的收益

- 小程序不再把接口地址写死在 `app.js`
- CloudBase 不再默认参与主链路初始化
- 后续补测试环境、灰度环境、试运行环境时更容易落地
- 文档口径和代码口径更一致
