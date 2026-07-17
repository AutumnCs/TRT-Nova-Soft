# Runtime Service Trial Rollout Checklist

Updated: 2026-07-15

This document is the practical enablement checklist for moving from demo mode toward a small stable trial run.

It is intentionally operational rather than conceptual.
The goal is to answer three questions clearly:

- what to enable first
- what to verify after each step
- how to roll back safely if behavior is not stable

## 1. Scope of this checklist

This checklist covers the current gradual migration path already present in the repository:

- `api-scf` optional proxy to `runtime-service`
- `ingest-scf` optional proxy to `runtime-service`
- SCF local fallback still available
- Redis optional as the runtime hot-state layer
- MySQL remains the fact storage layer

It does not assume a full backend rewrite.

Use together with:

- [Trial Deployment Checklist](./trial-deployment-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)

## 2. Preconditions before any enablement

Do not enable runtime-service proxy switches until all of the following are true:

- MySQL schema for `device_latest`, `device_commands`, `device_message_ingest` is already applied
- current SCF chain is working in the target environment
- `runtime-service` can start normally in that environment
- `runtime-service` can reach the same MySQL and, if enabled, the same Redis
- SCF environment variables and runtime-service environment variables are prepared separately
- you can inspect:
  - SCF logs
  - runtime-service logs
  - latest state data in MySQL
  - command state data in MySQL

Recommended minimum precheck:

1. `api-scf /health` works
2. `runtime-service /health` works
3. one device can still report through the current SCF path
4. one command can still complete through the current SCF path

## 3. Environment variables to prepare

### 3.1 runtime-service

Recommended baseline:

```env
RUNTIME_ENV=test
RUNTIME_HOST=0.0.0.0
RUNTIME_PORT=18080
STORAGE_BACKEND=mysql
RUNTIME_CACHE_BACKEND=redis
COMMAND_PROVIDER_BACKEND=mock
MYSQL_DSN=mysql://user:password@host:3306/database?charset=utf8mb4
REDIS_URL=redis://default:password@host:6379/0
DEVICE_OFFLINE_TIMEOUT_MS=600000
```

Notes:

- if you are only doing internal verification first, `COMMAND_PROVIDER_BACKEND=mock` is acceptable
- before real device command trial, command provider should match the actual platform path
- if Redis is not ready yet, you may temporarily use `RUNTIME_CACHE_BACKEND=noop` or `memory`, but trial confidence will be lower

### 3.2 api-scf

Keep disabled at first:

```env
API_SCF_RUNTIME_PROXY_ENABLED=false
RUNTIME_SERVICE_BASE_URL=http://127.0.0.1:18080
API_SCF_RUNTIME_PROXY_TIMEOUT_MS=8000
API_SCF_RUNTIME_PROXY_ROUTES=/device/latest,/device/cmd,/device/commands,/device/command/detail
```

### 3.3 ingest-scf

Keep disabled at first:

```env
INGEST_SCF_RUNTIME_PROXY_ENABLED=false
RUNTIME_SERVICE_BASE_URL=http://127.0.0.1:18080
INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS=8000
INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL=true
```

## 4. Recommended rollout order

Recommended order for a test or trial environment:

1. verify `runtime-service /health`
2. enable `api-scf` proxy for `/device/latest`
3. verify latest-state read behavior
4. enable `api-scf` proxy for `/device/cmd`
5. verify command send behavior
6. enable `api-scf` proxy for `/device/commands`
7. enable `api-scf` proxy for `/device/command/detail`
8. verify command loop visibility
9. enable `ingest-scf` proxy
10. verify end-to-end device report -> latest -> ACK/done reconciliation

This order keeps reads and writes separable and keeps rollback small.

## 5. Step-by-step execution checklist

## 5.1 Step A: runtime-service health check only

Keep both proxy switches disabled.

Verify:

- `GET /health` returns success
- reported `storageBackend` is the expected backend
- reported `runtimeCacheBackend` is the expected backend
- service logs show no startup exceptions

Pass condition:

- health endpoint is stable for repeated calls

Rollback:

- no rollback needed; keep proxies disabled

## 5.2 Step B: enable latest-state read proxy only

Set:

```env
API_SCF_RUNTIME_PROXY_ENABLED=true
API_SCF_RUNTIME_PROXY_ROUTES=/device/latest
```

Keep:

- `INGEST_SCF_RUNTIME_PROXY_ENABLED=false`

Verify:

- home page still loads device latest state
- device list still renders
- device detail still renders
- `deviceData[].params` still exists
- `deviceData[].latestCommand` still exists when expected
- latest-state response `cacheMeta` is understandable during checks:
  - `latestSource`
  - `onlineSource`
- no obvious increase in `runtime_proxy_failed` in `api-scf` logs

Pass condition:

- UI latest-state behavior matches the pre-proxy result for the same device

Rollback:

- set `API_SCF_RUNTIME_PROXY_ENABLED=false`

## 5.3 Step C: enable command send proxy

Set:

```env
API_SCF_RUNTIME_PROXY_ENABLED=true
API_SCF_RUNTIME_PROXY_ROUTES=/device/latest,/device/cmd
```

Verify:

- sending one command returns `commandId`
- front end still shows command status text
- `device_commands` gets new records
- command status can move beyond initial state
- `api-scf` fallback is not firing unexpectedly

Pass condition:

- command send succeeds repeatedly for the same known-good device path

Rollback:

- remove `/device/cmd` from `API_SCF_RUNTIME_PROXY_ROUTES`

## 5.4 Step D: enable command list and detail proxy

Set:

```env
API_SCF_RUNTIME_PROXY_ROUTES=/device/latest,/device/cmd,/device/commands,/device/command/detail
```

Verify:

- command list still displays recent commands
- single command detail page/action still loads
- detail status matches list status or is fresher
- cache-backed updates do not break command diagnosis flow
- command list / detail `cacheMeta.mode` is understandable:
  - `repo_only`
  - `cache_merged`
  - `cache_only`
  - `cache_only_injected`

Pass condition:

- one full command can be observed through:
  - send
  - list
  - single detail

Rollback:

- remove `/device/commands` and `/device/command/detail` from route list

## 5.5 Step E: enable ingest proxy

Set:

```env
INGEST_SCF_RUNTIME_PROXY_ENABLED=true
INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL=true
```

Verify:

- device report still reaches the system
- `runtime-service` receives `/runtime/ingest/message`
- latest state still refreshes
- command ACK / done still reconciles
- no spike in:
  - `push_processing_failed`
  - `runtime_proxy_failed`
  - `device_command_failed`

Pass condition:

- at least one real device completes:
  - report
  - latest refresh
  - command send
  - ACK or state feedback
  - command state progression

Rollback:

- set `INGEST_SCF_RUNTIME_PROXY_ENABLED=false`

## 6. Validation matrix for trial readiness

Use this quick matrix during rollout:

| Capability | What to verify | Source of truth |
| --- | --- | --- |
| Latest state read | page data still updates correctly | mini-program + `device_latest` |
| Online state | online/offline status matches recent reports | UI + logs + Redis |
| Command send | new command rows are created | `device_commands` |
| Command detail | single command can be queried reliably | UI/API + DB/cache |
| Dedup/idempotency | repeated same message does not duplicate effects | `device_message_ingest` + logs |
| ACK/done closure | command status progresses after device feedback | `device_commands` + runtime-service logs |
| Proxy stability | proxy path does not create sustained failures | SCF logs |

## 7. What to monitor during the first trial window

At minimum, monitor these during the first enabled window:

- `api-scf`:
  - `runtime_proxy_failed`
  - `request_failed`
  - `device_command_failed`
- `ingest-scf`:
  - `runtime_proxy_failed`
  - `push_processing_failed`
  - `decrypt_failed`
- `history-cleanup-scf`:
  - `cleanup_alerts_detected`
  - `cleanup_failed`
- `runtime-service`:
  - startup errors
  - repository / cache connectivity errors
  - command dispatch errors
  - structured JSON events:
    - `runtime_ingest`
    - `runtime_query_latest`
    - `runtime_query_commands`
    - `runtime_query_command_detail`
    - `runtime_send_command`

Suggested first fields to inspect in runtime-service logs:

- `deduplicated`
- `dedupSource`
- `latestSource`
- `onlineSource`
- `mode`
- `commandStatus`
- `logicalKey`
- `commandId`

Recommended daily review during trial:

```bash
node scripts/monitoring-log-summary.js --file ./logs/scf.ndjson --config ./reference/minimal-monitoring.config.example.json --pretty
```

For `runtime-service`, keep the structured JSON logs as a parallel signal source.

Most useful trial-stage event names:

- `runtime_ingest`
- `runtime_query_latest`
- `runtime_query_commands`
- `runtime_query_command_detail`
- `runtime_send_command`

Most useful first-pass fields:

- `logicalKey`
- `messageId`
- `commandId`
- `commandStatus`
- `deduplicated`
- `dedupSource`
- `latestSource`
- `onlineSource`
- `mode`
- `hits`
- `misses`

## 8. Rollback rules

Use simple rollback rules.
Do not wait for a perfect root-cause analysis before restoring stability.

Immediate rollback recommended if any of these happens:

- latest-state pages become unstable for multiple devices
- command send succeeds at API level but command rows stop progressing
- ingest proxy causes repeated latest-state freshness loss
- runtime-service health becomes unstable
- proxy failure logs keep repeating instead of being occasional

Rollback order:

1. disable `INGEST_SCF_RUNTIME_PROXY_ENABLED`
2. remove `/device/command/detail` from API proxy route list
3. remove `/device/commands` from API proxy route list
4. remove `/device/cmd` from API proxy route list
5. finally remove `/device/latest` from API proxy route list

That order preserves the safest remaining path.

## 9. Definition of “good enough for small stable trial”

For the current stage, “good enough” does not mean large-scale production.
It means:

- one target environment is clearly configured
- runtime-service can be enabled gradually
- rollback is simple
- latest state remains trustworthy
- command state remains traceable
- device feedback still closes the command loop
- the team can inspect failures without guessing

If those are true, the project has moved beyond a pure demo posture and is much closer to a real small-scale stable trial.
