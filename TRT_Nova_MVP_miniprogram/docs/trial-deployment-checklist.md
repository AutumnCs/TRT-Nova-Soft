# Trial Deployment Checklist

Updated: 2026-07-15

This document is the deployment-facing checklist for moving the project from demo posture into a small stable trial.

It is meant to be used before and during environment setup.

It answers one practical question:

- if the team wants to deploy a trial-ready backend stack for this repository, what exactly needs to be prepared and checked

## 1. Target stack for the current stage

For the current project stage, the recommended stack is:

- mini-program as the client
- `auth-scf` for login and token issuance
- `api-scf` for business API entry and gradual proxy routing
- `ingest-scf` for device message intake and optional runtime-service proxy
- `history-cleanup-scf` for cleanup, timeout inspection, and lightweight monitoring
- `runtime-service` for latest-state, command tracking, and online-state hot-path ownership
- MySQL as the durable fact store
- Redis as the lightweight real-time layer

This is not a full rewrite.

It is the recommended small-trial deployment shape.

## 2. Environment preparation checklist

Before deployment, confirm all of the following:

- [ ] target environment is explicit: `dev`, `test`, or trial-like staging
- [ ] mini-program runtime profile is pointed at the intended environment
- [ ] SCF environment variables are prepared separately
- [ ] `runtime-service` environment variables are prepared separately
- [ ] MySQL instance is reachable from SCF and `runtime-service`
- [ ] Redis instance is reachable from `runtime-service`
- [ ] IoT provider credentials and endpoints are prepared
- [ ] secrets are stored in environment management, not hardcoded in repo files

Recommended outcome:

- one clear environment owner
- one clear source of truth for env values
- no ambiguity about which environment is active

Reference:

- [Trial Environment Variable Matrix](./trial-environment-variable-matrix.md)

## 3. MySQL deployment checklist

MySQL remains the source of durable fact for the current stage.

Confirm:

- [ ] schema containing `device_latest` is applied
- [ ] schema containing `device_commands` is applied
- [ ] schema containing `device_message_ingest` is applied
- [ ] application user has read/write permission for required tables
- [ ] backup policy exists
- [ ] restore path is at least documented
- [ ] one real row check can be performed after deploy

MySQL should be used for:

- latest-state source of fact
- command source of fact
- ingest dedup/audit trail
- history and reporting source data

MySQL should not keep acting like:

- the only hot-path cache
- the place where every current-state page rebuild starts

## 4. Redis deployment checklist

Redis is the recommended hot-state layer for this stage.

Confirm:

- [ ] `REDIS_URL` is configured for `runtime-service`
- [ ] runtime cache backend is set intentionally
- [ ] TTL policy is understood for latest-state, online-state, command state, and dedup keys
- [ ] Redis connectivity works from `runtime-service`
- [ ] disabling Redis has a known fallback behavior

Redis should hold:

- latest snapshot cache
- online/offline temporary state
- command processing markers
- latest command hot state
- short-term dedup markers

If Redis is intentionally disabled for a first pass trial:

- [ ] that decision is explicit
- [ ] lower confidence on hot-path stability is accepted
- [ ] the team knows this is temporary rather than ideal

## 5. Runtime-service deployment checklist

`runtime-service` is the key resident backend for this stage.

Confirm:

- [ ] service starts successfully
- [ ] `GET /health` returns stable success
- [ ] `STORAGE_BACKEND` is correct
- [ ] `RUNTIME_CACHE_BACKEND` is correct
- [ ] `MYSQL_DSN` is correct
- [ ] `REDIS_URL` is correct when Redis is enabled
- [ ] command provider backend is intentionally chosen
- [ ] logs are accessible after deploy
- [ ] runtime-service structured JSON logs can be inspected

Recommended first-stage deployment shape:

- 1 instance is acceptable for early controlled trial

Recommended next-stage upgrade:

- 2 instances behind a load balancer before larger rollout

Key routes that should be checked:

- [ ] `/health`
- [ ] `/runtime/device/latest`
- [ ] `/runtime/device/command/send`
- [ ] `/runtime/device/commands`
- [ ] `/runtime/device/command/detail`
- [ ] `/runtime/ingest/message`

Runtime-service response diagnostics that are now worth checking during trial:

- latest-state `cacheMeta.latestSource`
- latest-state `cacheMeta.onlineSource`
- command list `cacheMeta.mode`
- command detail `cacheMeta.mode`

## 6. SCF deployment checklist

SCF remains useful, but its role should be clearer than before.

Confirm:

- [ ] `auth-scf` is deployed and healthy
- [ ] `api-scf` is deployed and healthy
- [ ] `ingest-scf` is deployed and receiving device traffic
- [ ] `history-cleanup-scf` is deployed and scheduled
- [ ] SCF env vars are separated by environment
- [ ] proxy feature switches are intentional, not accidental leftovers

SCF should keep:

- auth
- low-frequency business APIs
- scheduled tasks
- AI or recommendation capabilities
- outer edge integration

SCF should gradually stop being the only owner of:

- latest-state hot reads
- command closure
- online-state management

## 7. Proxy and rollout checklist

Before enabling any proxy:

- [ ] current SCF-only path is still working
- [ ] `runtime-service` health is stable
- [ ] logs are available on both sides

Recommended enablement order:

- [ ] enable `/device/latest` proxy first
- [ ] then enable `/device/cmd`
- [ ] then enable `/device/commands`
- [ ] then enable `/device/command/detail`
- [ ] finally enable ingest proxy

Confirm after each step:

- [ ] UI still reads current state correctly
- [ ] command send still returns `commandId`
- [ ] command rows still progress in `device_commands`
- [ ] no sustained `runtime_proxy_failed` increase is visible

## 8. Monitoring and logs checklist

The small trial should not start without minimum observability.

Confirm:

- [ ] structured logs can be obtained from SCF
- [ ] `runtime-service` logs can be inspected
- [ ] runtime-service cache/merge behavior is interpretable from logs and response `cacheMeta`
- [ ] the monitoring summary script can run
- [ ] cleanup scheduler is active
- [ ] the team knows which failure events matter first

Critical events to watch:

- `runtime_proxy_failed`
- `request_failed`
- `push_processing_failed`
- `device_command_failed`
- `cleanup_alerts_detected`
- `cleanup_failed`

runtime-service event names to watch:

- `runtime_ingest`
- `runtime_query_latest`
- `runtime_query_commands`
- `runtime_query_command_detail`
- `runtime_send_command`

runtime-service fields that are especially useful during trial:

- `deduplicated`
- `dedupSource`
- `latestSource`
- `onlineSource`
- `mode`
- `commandStatus`
- `logicalKey`
- `commandId`

Useful interpretation:

- `repo_only`: this response mainly reflects durable fact storage
- `cache_merged`: hot runtime state was merged over repository fact
- `cache_only` / `cache_only_injected`: the real-time layer currently knows more than the returned repository slice

Minimum trial expectation:

- one log-summary run can be produced before trial start

## 9. Functional smoke checklist

Before calling the environment trial-ready, verify:

- [ ] one real device report reaches the system
- [ ] `device_latest` updates
- [ ] home page shows latest-state correctly
- [ ] device detail shows latest-state correctly
- [ ] one command send returns `commandId`
- [ ] `device_commands` gets a new row
- [ ] command list shows the command
- [ ] command detail shows the command
- [ ] device feedback advances the command to `acked`, `done`, or `failed`
- [ ] duplicate report does not create obvious repeated effect

## 10. Rollback checklist

The trial is not ready if rollback is unclear.

Confirm:

- [ ] team knows which proxy routes are enabled
- [ ] team knows rollback order
- [ ] rollback does not require code changes
- [ ] rollback can be done by config update only

Recommended rollback order:

1. disable ingest proxy
2. remove `/device/command/detail` proxy
3. remove `/device/commands` proxy
4. remove `/device/cmd` proxy
5. remove `/device/latest` proxy

## 11. One compact go/no-go view

Use this before starting the trial window:

| Area | Go when | No-go when |
| --- | --- | --- |
| Environment | target env and vars are explicit | active env is ambiguous |
| MySQL | schema and connectivity are verified | latest/command tables are not ready |
| Redis | enabled or intentionally waived with known limits | status is unclear |
| runtime-service | health and core routes are reachable | startup or dependency errors persist |
| SCF | current chain is healthy | baseline path is already unstable |
| Monitoring | logs and summary are usable | failures cannot be traced |
| Command loop | one command can be traced end to end | command status is not understandable |

## 12. Bottom line

For this repository, a "trial deployment" should mean:

- the stack is split clearly enough
- the hot path is being pulled toward resident backend
- Redis is carrying temporary state where it helps most
- MySQL remains the durable fact store
- SCF still helps, but is no longer the only place where real-time truth lives

If those are true, the project is behaving much more like a small stable trial system than a pure demo.
