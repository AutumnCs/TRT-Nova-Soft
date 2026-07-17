# Incident Review Template

Updated: 2026-07-15

This document is the incident and postmortem template for the small stable trial stage.

It is designed for practical use:

- short enough to be filled on the same day
- structured enough to support engineering follow-up
- focused on whether latest state, command closure, and trial trust were affected

## 1. Basic incident record

```text
Incident title:
Incident ID:
Date:
Environment:
Owner:
Severity: low / medium / high / critical
Current status: open / mitigated / closed
Related weekly report:
```

## 2. What happened

Describe the incident in plain language.

Suggested prompts:

- what was first observed
- who or what detected it
- what user-visible symptom existed
- whether the issue was isolated or repeated

## 3. Impact assessment

Record the impact clearly.

- affected devices:
- affected APIs:
- affected pages or user actions:
- latest-state trust affected: yes / no
- command closure trust affected: yes / no
- data loss risk: yes / no
- wrong command execution risk: yes / no
- rollout paused: yes / no
- rollback performed: yes / no

## 4. Timeline

Use concrete timestamps.

| Time | Event |
| --- | --- |
| 10:03 | first alert or symptom |
| 10:08 | owner confirmed issue |
| 10:15 | mitigation started |
| 10:30 | service stabilized |

## 5. Detection and evidence

Write how the team knew this was real.

- health check failure
- monitoring summary output
- SCF logs
- runtime-service logs
- database row inspection
- front-end observed symptom
- device/platform callback evidence

Link or describe the strongest evidence:

```text
Primary evidence:
Secondary evidence:
```

## 6. Root cause analysis

Separate symptom from cause.

Template:

```text
Direct trigger:
Underlying cause:
Why the system allowed it:
Why it was not detected earlier:
```

Typical categories:

- message normalization bug
- duplicate message handling gap
- latest-state write inconsistency
- command state transition bug
- proxy routing or timeout issue
- Redis cache inconsistency
- MySQL pressure / slow query / missing index
- platform callback mismatch
- configuration mistake

## 7. Mitigation taken

Record exactly what was done.

Examples:

- disabled `INGEST_SCF_RUNTIME_PROXY_ENABLED`
- removed `/device/cmd` from `API_SCF_RUNTIME_PROXY_ROUTES`
- switched runtime cache to `noop`
- retried failed commands manually
- fixed configuration and redeployed

Template:

```text
Action:
Owner:
Time:
Expected effect:
Observed result:
```

## 8. Recovery validation

Confirm the issue was actually contained.

- [ ] health endpoints returned normal
- [ ] latest-state updates resumed
- [ ] command list/detail behavior returned to normal
- [ ] no abnormal duplicate writes remained
- [ ] monitoring signal returned to acceptable range
- [ ] rollback or mitigation result was user-visible and verified

## 9. Follow-up actions

Split short-term and long-term actions.

### 9.1 Immediate follow-up

- patch bug
- add missing log field
- add missing alert
- add missing test

### 9.2 Structural follow-up

- improve schema or index
- move hot path from SCF to resident service
- add Redis protection for high-frequency runtime state
- simplify multi-platform path
- remove outdated dependency or dead route

Template:

| Action | Type | Owner | Due date | Status |
| --- | --- | --- | --- | --- |
| Add command timeout test | immediate | backend | 2026-07-18 | open |
| Re-check MySQL index strategy | structural | backend lead | 2026-07-25 | open |

## 10. What we learned

Keep this part honest and short.

- what assumption turned out to be wrong
- what signal was useful
- what signal was missing
- what would have shortened the recovery time

## 11. Reuse in weekly management

After closing the incident:

- add one summary line into [Trial Weekly Report Template](./trial-weekly-report-template.md)
- if the issue changed rollout confidence, update the weekly decision
- if the issue exposed a recurring gap, turn it into a tracked engineering item
