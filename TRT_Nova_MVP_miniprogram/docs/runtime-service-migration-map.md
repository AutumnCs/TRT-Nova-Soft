# Runtime Service Migration Map

Updated: 2026-07-14

This document turns the resident-service plan into an interface migration map.
The focus is practical rollout:

- which mini-program calls are already centralized
- which SCF endpoints they currently hit
- which runtime-service endpoints should take over first
- which parts should stay in SCF during the first small-scale trial stage

## 1. Current client-side entrypoint

Device-related page logic is already mostly centralized:

- transport adapter: `services/core/ScfApiAdapter.js`
- device domain service: `services/modules/DeviceService.js`

That is good news for migration, because the pages are not directly coupled to raw request URLs.
In practice, we only need to change one adapter layer to move traffic gradually.

## 2. Current device-related call chain

Current mini-program call flow:

```text
pages/* -> DeviceService -> ScfApiAdapter -> api-scf
device platform -> ingest-scf -> MySQL (+ optional Redis)
```

The important current methods are:

| Client method | Current SCF endpoint | Main usage |
| --- | --- | --- |
| `getDeviceData({ withHistory: false })` | `POST /device/latest` | home / device list / device detail latest snapshot |
| `getDeviceData({ withHistory: true })` | `POST /device/latest` + `POST /device/history` | device detail trend/history |
| `sendDeviceCmd()` | `POST /device/cmd` | fan / device control |
| `getDeviceCommands()` | `POST /device/commands` | command list / traceability |
| `getDeviceCommandDetail()` | `POST /device/command/detail` | single-command diagnosis |
| `retryDeviceCommand()` | `POST /device/command/retry` | retry failed/timed-out command |
| `bindDevice()` / `unbindDevice()` / `updateBoundDeviceInfo()` | `/device/bind` `/device/unbind` `/device/profile` | device account/binding management |

## 3. Current page-level dependency map

The current page usage found in the repo is:

| Page | Current dependency | What it really needs |
| --- | --- | --- |
| `pages/index/index.js` | `deviceService.getDeviceData()` / `sendDeviceCmd()` | latest snapshot + quick control |
| `pages/garden/garden.js` | `deviceService.getDeviceData()` | device list latest snapshot |
| `pages/device/device.js` | `getDeviceData()` / `sendDeviceCmd()` / `getDeviceCommandDetail()` / `retryDeviceCommand()` | latest state + command loop |
| `pages/deviceDetail/deviceDetail.js` | `getDeviceData({ withHistory: true })` | latest state + history trend |
| `pages/deviceSettings/deviceSettings.js` | `getDeviceData()` / `updateBoundDeviceInfo()` | latest state + binding/profile management |
| `pages/assistant/assistant.js` | `getDeviceData()` | lightweight latest device context |
| `pages/plantJournal/plantJournal.js` | `getDeviceData()` | latest device context only |

This means the first migration priority is not “all device APIs”.
The first migration priority is:

1. latest state query
2. command send / command status loop
3. ingest path that keeps latest state and command state fresh

History, binding, and ordinary profile APIs can remain in SCF longer.

## 4. Recommended responsibility split

### Keep in SCF for now

These should remain in SCF during the next stage:

- `/device/history`
- `/device/bind`
- `/device/unbind`
- `/device/profile`
- user profile / journal / todo / plant library / agent APIs
- scheduled cleanup and inspection jobs

Why:

- lower request frequency
- not strongly dependent on sub-second runtime state
- less sensitive to cold-start and continuous state management

### Move toward runtime-service first

These are the first candidates to shift:

- latest device snapshot query
- device command send
- device command list / detail
- device ingest normalization + dedup + command reconciliation
- online/offline state maintenance

Why:

- highest read frequency
- closest to “current state”
- most likely to overload MySQL if left as repeated read-time aggregation
- most valuable to place behind Redis + resident service

## 5. Interface takeover map

Recommended target mapping:

| Current SCF endpoint | Runtime-service target | Migration priority | Notes |
| --- | --- | --- | --- |
| `POST /device/latest` | `POST /runtime/device/latest` | P0 | first read path to migrate |
| `POST /device/cmd` | `POST /runtime/device/command/send` | P0 | first write path to migrate |
| `POST /device/commands` | `POST /runtime/device/commands` | P1 | command loop visibility |
| `POST /device/command/detail` | `POST /runtime/device/command/detail` | P1 | useful for troubleshooting |
| `POST /device/command/retry` | `POST /runtime/device/command/retry` | P2 | can stay in SCF slightly longer |
| device platform webhook / push entry | `POST /runtime/ingest/message` | P0 | core runtime freshness path |
| `POST /device/history` | keep in SCF | later | history is fact storage, not high-frequency runtime state |

## 6. Recommended rollout stages

### Stage A: SCF facade stays unchanged

Do not change mini-program request names yet.

Keep:

- `DeviceService`
- `ScfApiAdapter`
- existing page call sites

Change only backend routing behavior:

- `api-scf /device/latest` may forward to `/runtime/device/latest`
- `api-scf /device/cmd` may forward to `/runtime/device/command/send`
- `api-scf /device/commands` may forward to `/runtime/device/commands`
- `ingest-scf` may forward normalized messages to `/runtime/ingest/message`

This is the safest first productionization step because the front end does not need a wide refactor.

### Stage B: write path first

Move these first:

- ingest message processing
- command send
- command ACK / done reconciliation

Reason:

- write path correctness determines whether “latest state” is trustworthy
- command closure is the most business-critical real-time path

### Stage C: read path after cache becomes stable

Then move:

- latest snapshot query
- command list/detail query

Condition:

- Redis latest snapshot and online-state cache are stable
- runtime-service latest aggregation has been verified against SCF behavior

### Stage D: SCF becomes outer business shell

Final near-term shape:

```text
Mini program
  -> auth-scf / ordinary api-scf
  -> runtime-service for device realtime paths

Device platform
  -> ingest-scf compatibility layer
  -> runtime-service core pipeline

Storage
  -> Redis for now-state
  -> MySQL for fact-state
```

## 7. What this means for concurrency

This migration map does not “guarantee high concurrency”.
What it does is remove the earliest concurrency bottlenecks:

- repeated latest-state aggregation from historical facts
- command loop status scattered across multiple temporary paths
- online/offline state guessed at page level
- high-frequency reads hitting MySQL directly

If the next stage is implemented well, the project becomes much more suitable for:

- small stable pilot runs
- a few hundred to low-thousand device growth path
- later Redis-centered hot-path optimization

Without this migration, concurrency problems will appear much earlier at the query layer.

## 8. Immediate next implementation targets

The most practical next implementation steps are:

1. let `ingest-scf` optionally forward normalized messages to `POST /runtime/ingest/message`
2. let `api-scf /device/latest` optionally proxy to `POST /runtime/device/latest`
3. let `api-scf /device/cmd` optionally proxy to `POST /runtime/device/command/send`
4. let `api-scf /device/commands` optionally proxy to `POST /runtime/device/commands`
5. add env-driven switches so dev / test / production can choose direct SCF logic or runtime-service forwarding

That sequence keeps the project moving toward a real trial-ready backend without forcing an all-at-once rewrite.

## 9. Runtime proxy switches added in the repo

The repo now has a first SCF-side proxy switch design for gradual rollout.

Current env keys:

- `API_SCF_RUNTIME_PROXY_ENABLED`
- `RUNTIME_SERVICE_BASE_URL`
- `API_SCF_RUNTIME_PROXY_TIMEOUT_MS`
- `API_SCF_RUNTIME_PROXY_ROUTES`
- `INGEST_SCF_RUNTIME_PROXY_ENABLED`
- `INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS`
- `INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL`

Recommended first value set:

```env
API_SCF_RUNTIME_PROXY_ENABLED=false
RUNTIME_SERVICE_BASE_URL=http://127.0.0.1:18080
API_SCF_RUNTIME_PROXY_TIMEOUT_MS=8000
API_SCF_RUNTIME_PROXY_ROUTES=/device/latest,/device/cmd,/device/commands,/device/command/detail
INGEST_SCF_RUNTIME_PROXY_ENABLED=false
INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS=8000
INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL=true
```

Recommended rollout rule:

- default disabled
- enable first in dev / test only
- start with `/device/latest`
- then add `/device/cmd`
- then add `/device/commands`
- then add `/device/command/detail`
- after read/write API validation, enable ingest proxy
- keep SCF local fallback available while validating runtime-service behavior
