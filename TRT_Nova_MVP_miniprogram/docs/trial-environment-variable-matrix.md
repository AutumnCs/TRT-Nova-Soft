# Trial Environment Variable Matrix

Updated: 2026-07-15

This document centralizes the environment variables that matter for moving this repository from demo posture into a small stable trial posture.

It is not meant to replace each service's own `.env.example`.

It is meant to do one thing better:

- give the team one deployment-facing view of which variables belong to which service, what they are for, and which stage should care about them first

## 1. How to use this document

Use this matrix together with:

- [Environment Configuration](./environment-configuration.md)
- [Trial Deployment Checklist](./trial-deployment-checklist.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)

Principles:

- keep dev / test / prod values separated
- keep SCF variables separated from `runtime-service` variables
- keep secrets in environment management, not in repository files
- keep Redis, MySQL, and IoT provider settings explicit instead of mixed into one undocumented bundle

## 2. Mini-program runtime profile

These are not cloud env vars, but they are part of environment switching.

| Entry | Where | Purpose | Trial-stage note |
| --- | --- | --- | --- |
| `runtimeProfile` | `envList.js` | choose `dev / test / prod` runtime profile | should be explicit before any trial build |
| `runtimeConfigOverrides.scfApiBaseUrl` | `envList.js` | override business API entry temporarily | useful for dev/test only |
| `runtimeConfigOverrides.agentScfBaseUrl` | `envList.js` | override agent API entry temporarily | useful when trial env is not same as prod |
| `runtimeConfigOverrides.authScfBaseUrl` | `envList.js` | override auth entry temporarily | should match target env explicitly |

## 3. Shared infrastructure variables

These are the variables the team should think about first because multiple services depend on them conceptually.

| Variable | Typical owner | Used by | Purpose | Trial priority |
| --- | --- | --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | backend infra | SCF services | MySQL connection | P0 |
| `MYSQL_DSN` | backend infra | `runtime-service` | MySQL connection string | P0 |
| `DB_CONN_LIMIT` | backend infra | SCF services | control connection fan-out | P1 |
| `REDIS_URL` | backend infra | `runtime-service`, optional SCF runtime layer | Redis connection | P1 |
| `REDIS_KEY_PREFIX` | backend infra | `runtime-service`, optional SCF runtime layer | isolate keys by project/stage | P1 |
| `JWT_SECRET` | backend/security | `auth-scf`, `api-scf`, `agent-scf` | token signing / verification | P0 |

## 4. runtime-service variable matrix

Authoritative example source:

- `runtime-service/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `RUNTIME_ENV` | identify current runtime environment | should be `test` or trial-like value in trial env |
| `RUNTIME_HOST` | bind host | keep explicit for container or VM deployment |
| `RUNTIME_PORT` | bind port | must match gateway / service exposure |
| `STORAGE_BACKEND` | choose storage implementation | should become `mysql` for meaningful trial |
| `RUNTIME_CACHE_BACKEND` | choose cache implementation | `redis` recommended for small stable trial |
| `COMMAND_PROVIDER_BACKEND` | choose command dispatch backend | `mock` is only for internal verification, not real device trial |
| `DEVICE_OFFLINE_TIMEOUT_MS` | backend online/offline rule | must align with UI and operations expectation |
| `MYSQL_DSN` | MySQL DSN | required when `STORAGE_BACKEND=mysql` |
| `REDIS_URL` | Redis connection | required when `RUNTIME_CACHE_BACKEND=redis` |
| `REDIS_KEY_PREFIX` | Redis namespace prefix | use a stage-safe value |
| `REDIS_DEVICE_LATEST_TTL_SEC` | latest-state cache TTL | should remain temporary, not durable |
| `REDIS_DEVICE_ONLINE_TTL_SEC` | online-state TTL | should reflect online/offline decision window |
| `REDIS_COMMAND_STATE_TTL_SEC` | command hot-state TTL | should be long enough for diagnosis, short enough to expire |
| `REDIS_MESSAGE_DEDUP_TTL_SEC` | short-term dedup TTL | should cover repeat-report window |
| `ONENET_API_BASE` | OneNET API base URL | required when OneNET command/provider path is active |
| `ONENET_ACCESS_KEY` | OneNET auth | provider secret, do not store in repo |
| `ONENET_SECRET_KEY` | OneNET auth | provider secret, do not store in repo |
| `EMQX_API_BASE` | EMQX API base URL | needed only when EMQX path is active |
| `EMQX_API_KEY` | EMQX auth | provider secret |
| `EMQX_API_SECRET` | EMQX auth | provider secret |

## 5. api-scf variable matrix

Authoritative example source:

- `dist/scf/api-scf/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection | still required while SCF remains in chain |
| `DB_CONN_LIMIT` | MySQL connection cap | helps control bursty connection usage |
| `JWT_SECRET` | auth verification | must match auth issuer configuration |
| `DEBUG_OPENID` | temporary debug identity | should not become long-term production dependency |
| `ONENET_AUTH_MODE` | choose OneNET auth scope | must reflect actual platform setup |
| `ONENET_AUTH_METHOD` | OneNET signature method | should match provider expectation |
| `ONENET_AUTH_TTL_SECONDS` | OneNET auth token validity | keep explicit for debugging and expiry behavior |
| `ONENET_ACCESS_KEY` | shared OneNET access key | optional compatibility path |
| `ONENET_PRODUCT_ACCESS_KEY` | product-level auth | only when product auth mode is used |
| `ONENET_PROJECT_ID` | project auth scope | only when project auth mode is used |
| `ONENET_PROJECT_ACCESS_KEY` | project-level auth | only when project auth mode is used |
| `ONENET_USER_ID` | user auth scope | only when user auth mode is used |
| `ONENET_USER_ACCESS_KEY` | user-level auth | only when user auth mode is used |
| `FAN_SWITCH_IDENTIFIER` | device command field mapping | should match actual device model after standardization |
| `EMQX_PUBLISH_URL` | EMQX command publish endpoint | only when EMQX command path is active |
| `EMQX_APP_ID` | EMQX publish auth | provider secret |
| `EMQX_APP_SECRET` | EMQX publish auth | provider secret |
| `EMQX_COMMAND_TOPIC_TEMPLATE` | EMQX command topic template | must match live topic convention |
| `EMQX_COMMAND_QOS` | publish QoS | tune only with actual broker behavior in mind |
| `EMQX_COMMAND_RETAIN` | publish retain flag | keep explicit to avoid accidental retained control traffic |
| `DEVICE_CMD_PROVIDER_DEFAULT` | default command provider | should reflect the chosen main path |
| `REDIS_ENABLED` | optional SCF-side runtime cache usage | should stay explicit if SCF still uses Redis helpers |
| `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connectivity | only if SCF Redis layer is enabled |
| `REDIS_KEY_PREFIX` | Redis namespace | should stay aligned with project/stage |
| `REDIS_DEVICE_LATEST_TTL_SEC` | SCF-side latest cache TTL | keep aligned with runtime-service intent |
| `REDIS_DEVICE_ONLINE_TTL_SEC` | SCF-side online cache TTL | keep aligned with backend rule |
| `REDIS_COMMAND_STATE_TTL_SEC` | SCF-side command-state TTL | keep aligned with command diagnosis needs |
| `API_SCF_RUNTIME_PROXY_ENABLED` | enable runtime-service proxy | enable gradually, not all at once |
| `RUNTIME_SERVICE_BASE_URL` | runtime-service base URL | must match target environment |
| `API_SCF_RUNTIME_PROXY_TIMEOUT_MS` | proxy timeout | should be explicit before trial |
| `API_SCF_RUNTIME_PROXY_ROUTES` | selected proxied routes | rollout switch for latest/cmd/commands/detail |

## 6. ingest-scf variable matrix

Authoritative example source:

- `dist/scf/ingest-scf/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection | still required while SCF handles ingestion edge |
| `DB_CONN_LIMIT` | MySQL connection cap | useful when report bursts occur |
| `ONE_NET_TOKEN` | OneNET webhook validation | must match provider configuration |
| `ONE_NET_AES_KEY` | OneNET payload decryption | required when encrypted payload mode is used |
| `EMQX_WEBHOOK_TOKEN` | EMQX webhook validation | only when EMQX ingest path is active |
| `EMQX_PRODUCT_ID` | EMQX logical product marker | should match actual provider mapping |
| `REDIS_ENABLED` | optional SCF-side Redis layer | explicit only if this path still uses it |
| `REDIS_URL` / `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connectivity | only if SCF Redis layer is enabled |
| `REDIS_KEY_PREFIX` | Redis namespace | align with runtime-service |
| `REDIS_DEVICE_LATEST_TTL_SEC` | latest-state cache TTL | align with runtime-service |
| `REDIS_DEVICE_ONLINE_TTL_SEC` | online-state cache TTL | align with backend rule |
| `REDIS_COMMAND_STATE_TTL_SEC` | command-state TTL | align with command closure expectations |
| `REDIS_MESSAGE_DEDUP_TTL_SEC` | dedup TTL | important for repeat-report suppression |
| `INGEST_SCF_RUNTIME_PROXY_ENABLED` | enable ingest proxy to runtime-service | leave off until read and command path are verified |
| `RUNTIME_SERVICE_BASE_URL` | runtime-service base URL | must point to same environment as API proxy |
| `INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS` | ingest proxy timeout | keep explicit before trial |
| `INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL` | local fallback on proxy failure | should stay enabled for safer early rollout |

## 7. history-cleanup-scf variable matrix

Authoritative example source:

- `dist/scf/history-cleanup-scf/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection | required for cleanup and lag inspection |
| `DB_CONN_LIMIT` | MySQL connection cap | keep conservative |
| `INGEST_RETENTION_DAYS` | raw ingest retention | should match trial data retention policy |
| `RAW_RETENTION_DAYS` | raw history retention | keep explicit; review before wider rollout |
| `AGG_5M_RETENTION_DAYS` | 5-minute aggregate retention | useful for short-term trending |
| `AGG_1H_RETENTION_DAYS` | hourly aggregate retention | useful for medium-term review |
| `AGG_1D_RETENTION_DAYS` | daily aggregate retention | useful for long-term review/reporting |
| `COMMAND_TIMEOUT_MINUTES` | command timeout threshold | should align with command SLA expectation |
| `ALERT_OFFLINE_MINUTES` | offline alert threshold | should align with online/offline product rule |
| `ALERT_COMMAND_LAG_MINUTES` | lagging command alert threshold | should reflect acceptable command closure delay |

## 8. auth-scf variable matrix

Authoritative example source:

- `dist/scf/auth-scf/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `WECHAT_APPID` | WeChat app identity | must match trial mini-program |
| `WECHAT_SECRET` | WeChat login secret | secret; never keep as repo truth |
| `JWT_SECRET` | token signing secret | must match verification side |
| `TOKEN_EXPIRES_IN_SECONDS` | token lifetime | keep explicit for trial support and debugging |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection | required for auth-related persistence if used |
| `DB_CONN_LIMIT` | MySQL connection cap | keep conservative |

## 9. agent-scf variable matrix

Authoritative example source:

- `dist/scf/agent-scf/.env.example`

| Variable | Purpose | Trial-stage note |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL connection | required if agent features read project data |
| `DB_CONN_LIMIT` | MySQL connection cap | keep separate from hot-path tuning |
| `JWT_SECRET` | auth verification | must match auth issuer |
| `DEBUG_OPENID` | temporary debug identity | should stay temporary |
| `LLM_API_ENABLED` | enable external LLM API | should remain explicit and cost-aware |
| `LLM_API_BASE_URL` | OpenAI-compatible endpoint | keep separate by environment |
| `LLM_API_PATH` | completion path | endpoint-specific |
| `LLM_API_KEY` | model provider secret | secret; keep out of repo |
| `LLM_MODEL` | model selection | should be explicit for repeatability |
| `LLM_TEMPERATURE` | generation randomness | tune for stability, not novelty, in trial support use |
| `LLM_MAX_TOKENS` | response cap | helps cost and latency control |
| `LLM_TIMEOUT_MS` | request timeout | should be bounded to avoid dragging core flows |

## 10. Which variables matter first for the current stage

If the team wants the smallest high-value checklist, prioritize these first:

### P0: must be explicit before small stable trial

- mini-program runtime profile target
- `JWT_SECRET`
- SCF MySQL connection variables
- `MYSQL_DSN`
- `STORAGE_BACKEND`
- `RUNTIME_CACHE_BACKEND`
- `COMMAND_PROVIDER_BACKEND`
- `RUNTIME_SERVICE_BASE_URL`
- `API_SCF_RUNTIME_PROXY_ENABLED`
- `API_SCF_RUNTIME_PROXY_ROUTES`
- `INGEST_SCF_RUNTIME_PROXY_ENABLED`
- `INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL`
- `DEVICE_OFFLINE_TIMEOUT_MS`
- OneNET or EMQX active-path credentials, whichever is actually in use

### P1: strongly recommended for a cleaner trial

- `REDIS_URL`
- `REDIS_KEY_PREFIX`
- Redis TTL variables
- `COMMAND_TIMEOUT_MINUTES`
- `ALERT_OFFLINE_MINUTES`
- `ALERT_COMMAND_LAG_MINUTES`
- `TOKEN_EXPIRES_IN_SECONDS`

### P2: important, but not first blocker

- aggregate retention variables
- optional EMQX publish tuning fields
- agent LLM tuning variables

## 11. Recommended ownership split

Use a simple ownership model:

| Area | Suggested owner |
| --- | --- |
| mini-program runtime target | app/frontend owner |
| SCF env vars | serverless/backend owner |
| `runtime-service` env vars | resident backend owner |
| MySQL credentials and backup policy | infra/backend owner |
| Redis credentials and TTL policy | infra/backend owner |
| IoT provider credentials | device/platform integration owner |
| LLM provider credentials | AI/agent feature owner |

## 12. Bottom line

For this repository, configuration management becomes healthier when:

- one service no longer secretly depends on another service's settings
- Redis, MySQL, and IoT provider settings are named clearly
- runtime-service and SCF can be rolled out or rolled back independently
- trial deployment no longer depends on scattered tribal knowledge

That is the real purpose of this matrix.
