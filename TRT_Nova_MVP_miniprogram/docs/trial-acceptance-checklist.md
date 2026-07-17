# Trial Acceptance Checklist

Updated: 2026-07-15

This document is the acceptance checklist for deciding whether the project is ready to move from demo posture into a small stable trial run.

It is intentionally narrow:

- not “is the system perfect”
- not “is it ready for large-scale production”
- but “is it stable enough to let a small real trial happen with controlled risk”

## 1. Acceptance rule

The trial should be considered accepted only when all P0 items below are true in the target environment.

If any P0 item fails, the result should be:

- not accepted yet
- keep the rollout smaller or keep the proxy disabled
- fix the failed item and repeat verification

## 2. P0 acceptance checklist

## 2.1 Environment and configuration

- [ ] target environment is explicitly identified as `dev`, `test`, or trial-like staging
- [ ] SCF environment variables are separated from runtime-service environment variables
- [ ] MySQL connection is confirmed usable
- [ ] Redis plan is explicit:
  - [ ] enabled and verified, or
  - [ ] intentionally disabled with known limitations accepted
- [ ] `runtime-service /health` returns stable success
- [ ] `api-scf /health` returns stable success

Pass evidence:

- health endpoint results
- environment variable records or deployment console screenshots

## 2.2 Latest-state trustworthiness

- [ ] at least one real device report updates `device_latest`
- [ ] mini-program home page still reads latest state correctly
- [ ] device detail page still reads latest state correctly
- [ ] `params` data required by current pages still exists
- [ ] online/offline status is not guessed only at page level

Pass evidence:

- latest-state API response
- mini-program screenshots or video
- database row check for `device_latest`

## 2.3 Command closure

- [ ] one known-good device can receive a command
- [ ] sending a command returns `commandId`
- [ ] `device_commands` gets a new row
- [ ] command list can display the command
- [ ] single command detail can display the command
- [ ] the command eventually becomes one of:
  - `done`
  - `acked`
  - `failed`
- [ ] the result is understandable from logs and database state

Pass evidence:

- API response for command send
- `device_commands` row
- command list/detail response
- ACK or state feedback log evidence

## 2.4 Idempotency and write stability

- [ ] duplicate device message does not create repeated business effects
- [ ] duplicate message is traceable through `device_message_ingest`
- [ ] no repeated command-state corruption appears after duplicate or repeated report
- [ ] ingest path can still recover through SCF local fallback if runtime proxy fails

Pass evidence:

- repeated message test
- `device_message_ingest` rows
- logs showing dedup or stable behavior

## 2.5 Rollback readiness

- [ ] team knows which proxy switches are enabled
- [ ] team knows rollback order
- [ ] rollback can be done without code changes
- [ ] rollback path has been read and understood before trial start

Pass evidence:

- checked env variable values
- reviewed [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)

## 2.6 Monitoring minimum

- [ ] `history-cleanup-scf` is deployed and scheduled
- [ ] SCF structured logs can be exported
- [ ] `scripts/monitoring-log-summary.js` can run against exported logs
- [ ] team knows the critical events to watch:
  - `runtime_proxy_failed`
  - `request_failed`
  - `push_processing_failed`
  - `device_command_failed`
  - `cleanup_alerts_detected`
  - `cleanup_failed`

Pass evidence:

- scheduler confirmation
- one successful monitoring summary output

## 3. P1 acceptance checklist

These are strongly recommended for a cleaner trial, but not every item must block the first small trial:

- [ ] Redis-backed latest / online / command runtime state is enabled
- [ ] runtime-service command provider is connected to the real platform path
- [ ] command detail through runtime-service is verified with live data
- [ ] ingest proxy is enabled and stable
- [ ] daily review process is assigned to a real owner

## 4. Suggested acceptance verdict levels

Use one of these three verdicts:

| Verdict | Meaning |
| --- | --- |
| `accepted` | all P0 items passed; small stable trial may start |
| `accepted_with_limits` | P0 passed, but some P1 items are still weak; keep scope intentionally small |
| `not_accepted_yet` | one or more P0 items failed or unverified |

## 5. Recommended acceptance output template

Use this simple template after verification:

```text
Trial acceptance result: accepted / accepted_with_limits / not_accepted_yet

Environment:
- target:
- runtime-service enabled routes:
- ingest proxy enabled:

P0 summary:
- environment/config:
- latest-state trustworthiness:
- command closure:
- idempotency/write stability:
- rollback readiness:
- monitoring minimum:

Open risks:
- risk 1
- risk 2

Next action before wider trial:
- action 1
```

## 6. What “accepted” does not mean

Even after acceptance, it still does not mean:

- large-scale production ready
- fully automated monitoring
- full disaster recovery completeness
- full capacity validation under high concurrency

It only means the project has crossed the line from “demo-only” into “small stable trial is reasonable”.
