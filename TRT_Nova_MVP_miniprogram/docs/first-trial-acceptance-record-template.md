# First Trial Acceptance Record Template

Updated: 2026-07-15

This document is the first-run execution record template for deciding whether the project can enter a small stable trial window.

It is not another architecture plan.

It is meant to be filled after a real environment check and a real device validation pass.

Use it together with:

- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Deployment Checklist](./trial-deployment-checklist.md)
- [Trial Readiness Gap Assessment](./trial-readiness-gap-assessment.md)

## 1. Record header

```text
Record title:
Date:
Environment:
Prepared by:
Reviewed by:
Current scope:
- device count:
- enabled routes:
- ingest proxy enabled: yes / no
- Redis enabled: yes / no
```

## 2. Acceptance verdict

Choose one:

- `accepted`
- `accepted_with_limits`
- `not_accepted_yet`

Template:

```text
Acceptance verdict:

Short reason:
- line 1
- line 2
- line 3
```

## 3. Environment and configuration evidence

Record the minimum environment proof.

```text
Target environment confirmed:
- yes / no
- note:

api-scf /health:
- pass / fail
- evidence:

runtime-service /health:
- pass / fail
- evidence:

MySQL connectivity:
- pass / fail
- evidence:

Redis status:
- enabled and verified / intentionally disabled / unclear
- evidence:

SCF and runtime-service env separation:
- pass / fail
- evidence:
```

## 4. Latest-state trustworthiness record

Record one or more representative device checks.

```text
Representative device:

device_latest updated:
- yes / no
- evidence:

Home page latest-state correct:
- yes / no
- evidence:

Device detail latest-state correct:
- yes / no
- evidence:

online/offline rule behaved correctly:
- yes / no
- evidence:

latest-state response cacheMeta:
- latestSource:
- onlineSource:
- note:
```

## 5. Command closure record

This is the most important real-device section.

```text
Representative command scenario:
- device:
- command:
- expected effect:

Command send returned commandId:
- yes / no
- commandId:
- evidence:

device_commands row created:
- yes / no
- evidence:

Command list displayed command:
- yes / no
- evidence:

Command detail displayed command:
- yes / no
- evidence:

Final command state:
- done / acked / failed / still unclear
- evidence:

Command list cacheMeta.mode:
- repo_only / cache_merged / cache_only_injected / unknown

Command detail cacheMeta.mode:
- repo_only / cache_merged / cache_only / unknown

Logs made the result understandable:
- yes / no
- note:
```

## 6. Idempotency and write stability record

```text
Repeated message test performed:
- yes / no

Duplicate message created repeated business effect:
- yes / no
- evidence:

device_message_ingest trace available:
- yes / no
- evidence:

runtime-service dedup log evidence:
- dedupSource:
- evidence:

Command state remained stable after repeat:
- yes / no
- note:
```

## 7. Rollout and rollback readiness record

```text
Enabled proxy routes:
- /device/latest:
- /device/cmd:
- /device/commands:
- /device/command/detail:
- ingest proxy:

Rollback order understood:
- yes / no

Rollback can be done without code change:
- yes / no

Rollback exercise performed:
- yes / no
- note:
```

## 8. Monitoring minimum record

```text
history-cleanup-scf scheduled:
- yes / no
- evidence:

SCF structured logs exportable:
- yes / no
- evidence:

runtime-service structured logs available:
- yes / no
- evidence:

monitoring-log-summary run completed:
- yes / no
- evidence:

Critical events reviewed:
- runtime_proxy_failed
- request_failed
- push_processing_failed
- device_command_failed
- cleanup_alerts_detected
- cleanup_failed
- runtime_ingest
- runtime_query_latest
- runtime_query_commands
- runtime_query_command_detail
- runtime_send_command
```

## 9. Open risks after the first acceptance pass

Keep this section short and honest.

Template:

```text
Risk:
Why it matters:
Current containment:
Owner:
```

Recommended count:

- 3 to 5 items only

## 10. Limits to keep if verdict is accepted_with_limits

Fill this only if the verdict is `accepted_with_limits`.

```text
Limit 1:
Limit 2:
Limit 3:
```

Typical examples:

- trial device count cap
- command scenario cap
- no ingest proxy yet
- Redis enabled but still under close observation
- no scope expansion until one more week of evidence

## 11. Recommended next action

Choose one:

- start the first small trial window
- start trial, but keep limits explicit
- hold and fix blockers first
- roll back selected runtime path before retry

Template:

```text
Next action:

Reason:
- line 1
- line 2

Owner:
Target date:
```

## 12. Filled example skeleton

```text
Acceptance verdict: accepted_with_limits

Short reason:
- latest-state trust passed on representative devices
- command closure worked on one known-good device
- Redis and runtime-service logs were visible
- ingest proxy is still not proven enough for wider scope

Next action:
- start a limited trial window with latest-state and command detail enabled
```
