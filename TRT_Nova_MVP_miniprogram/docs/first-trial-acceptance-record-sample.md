# First Trial Acceptance Record Sample

Updated: 2026-07-15

This document is a filled sample based on the current repository direction.

It is intentionally an example, not a claim about your real environment.

Use it like this:

- keep the structure
- replace every placeholder with real environment evidence
- do not reuse the verdict unless the real evidence supports it

Recommended paired reading:

- [First Trial Acceptance Record Template](./first-trial-acceptance-record-template.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Trial Readiness Gap Assessment](./trial-readiness-gap-assessment.md)

## 1. Record header

```text
Record title: First controlled trial acceptance check
Date: 2026-07-15
Environment: trial-test
Prepared by: backend owner
Reviewed by: technical lead
Current scope:
- device count: 8
- enabled routes: /device/latest, /device/cmd, /device/commands, /device/command/detail
- ingest proxy enabled: no
- Redis enabled: yes
```

## 2. Acceptance verdict

```text
Acceptance verdict: accepted_with_limits

Short reason:
- latest-state trust passed on representative devices
- one representative real-device command closure was understandable end to end
- runtime-service logs and cacheMeta made runtime behavior explainable
- ingest proxy and wider-scope rollout are still not proven enough for unrestricted acceptance
```

## 3. Environment and configuration evidence

```text
Target environment confirmed:
- yes
- note: trial-test environment selected in deployment record

api-scf /health:
- pass
- evidence: 2026-07-15 10:05 health response screenshot

runtime-service /health:
- pass
- evidence: 2026-07-15 10:06 health response plus structured log

MySQL connectivity:
- pass
- evidence: latest-state row and command row query screenshots

Redis status:
- enabled and verified
- evidence: runtimeCacheBackend=redis and dedup/cache log evidence

SCF and runtime-service env separation:
- pass
- evidence: env variable record reviewed before trial start
```

## 4. Latest-state trustworthiness record

```text
Representative device: nova_plant_01

device_latest updated:
- yes
- evidence: updated_at_ms changed after new device report

Home page latest-state correct:
- yes
- evidence: screenshot after refresh matched backend latest-state response

Device detail latest-state correct:
- yes
- evidence: device detail page matched latest-state response and DB row

online/offline rule behaved correctly:
- yes
- evidence: device marked online within threshold; stale sample device marked offline

latest-state response cacheMeta:
- latestSource: redis
- onlineSource: redis
- note: repository fact existed, but hot-path state was already available in runtime cache
```

## 5. Command closure record

```text
Representative command scenario:
- device: nova_plant_01
- command: fan_switch=true
- expected effect: fan state turns on and latest-state view reflects the new state

Command send returned commandId:
- yes
- commandId: cmd_a1b2c3d4e5f6
- evidence: API response capture

device_commands row created:
- yes
- evidence: command row query by command_id

Command list displayed command:
- yes
- evidence: command list response showed cmd_a1b2c3d4e5f6

Command detail displayed command:
- yes
- evidence: command detail response showed sent -> done progression

Final command state:
- done
- evidence: device feedback log + command detail response + DB row

Command list cacheMeta.mode:
- cache_merged

Command detail cacheMeta.mode:
- cache_merged

Logs made the result understandable:
- yes
- note: runtime_send_command, runtime_query_commands, runtime_query_command_detail, and runtime_ingest were enough to explain the transition
```

## 6. Idempotency and write stability record

```text
Repeated message test performed:
- yes

Duplicate message created repeated business effect:
- no
- evidence: repeated same deviceId + messageId did not create extra state effect

device_message_ingest trace available:
- yes
- evidence: one ingest record kept as durable trail

runtime-service dedup log evidence:
- dedupSource: runtime_cache
- evidence: runtime_ingest structured log on second repeated message

Command state remained stable after repeat:
- yes
- note: no repeated command corruption was observed
```

## 7. Rollout and rollback readiness record

```text
Enabled proxy routes:
- /device/latest: enabled
- /device/cmd: enabled
- /device/commands: enabled
- /device/command/detail: enabled
- ingest proxy: disabled

Rollback order understood:
- yes

Rollback can be done without code change:
- yes

Rollback exercise performed:
- no
- note: rollback order reviewed, but not yet exercised in a live window
```

## 8. Monitoring minimum record

```text
history-cleanup-scf scheduled:
- yes
- evidence: scheduler screenshot

SCF structured logs exportable:
- yes
- evidence: exported NDJSON sample

runtime-service structured logs available:
- yes
- evidence: JSON log sample from runtime_ingest and runtime_query_latest

monitoring-log-summary run completed:
- yes
- evidence: one sample summary output attached

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

```text
Risk: ingest proxy still unproven
Why it matters: full write-path cutover confidence is not established
Current containment: keep ingest proxy disabled
Owner: backend owner

Risk: Redis is verified, but only under small scope
Why it matters: hot-state confidence is still narrow
Current containment: keep device count limited
Owner: backend owner

Risk: rollback has been reviewed but not exercised
Why it matters: operational confidence is lower than implementation confidence
Current containment: keep route scope narrow and explicit
Owner: technical lead
```

## 10. Limits to keep if verdict is accepted_with_limits

```text
Limit 1: keep trial device count under the initial controlled target
Limit 2: do not enable ingest proxy yet
Limit 3: do not expand command scenarios until one more week of clean evidence exists
```

## 11. Recommended next action

```text
Next action: start the first limited trial window

Reason:
- current repo and environment evidence support a narrow trial
- the remaining gaps are operational proof gaps, not core architecture gaps

Owner: project owner
Target date: 2026-07-22
```

## 12. How to adapt this sample

When you replace this sample with a real record:

- change every environment-specific line
- attach actual screenshots, logs, and row checks
- downgrade the verdict immediately if any P0 evidence is missing
- do not keep `accepted_with_limits` just because it is the most comfortable label
