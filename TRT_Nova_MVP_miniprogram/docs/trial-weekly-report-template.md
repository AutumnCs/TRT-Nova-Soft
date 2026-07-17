# Trial Weekly Report Template

Updated: 2026-07-15

This document is the weekly reporting template for the small stable trial stage.

Its purpose is simple:

- turn daily observations into a weekly management view
- make trial stability visible through facts instead of impressions
- support the go / hold / expand decision for the next week

## 1. When to use it

Use this template once per week during the small stable trial window.

Recommended owner:

- technical owner or backend owner prepares the draft
- product / operations owner reviews user-visible impact
- project owner signs the weekly decision

## 2. Weekly summary

```text
Week:
Environment:
Report owner:
Trial scope this week:

Weekly verdict:
- green / yellow / red

Recommended next-step decision:
- continue current scope
- continue with limits
- expand slightly
- pause expansion
- roll back part of the runtime path
```

## 3. Executive summary

Fill this in with short plain language:

- what stayed stable this week
- what became better this week
- what remains risky this week
- whether the project is still behaving like a controlled small trial rather than only a demo

## 4. Core operational indicators

Record the trend, not only a single point.

## 4.1 Device freshness and latest-state trust

- number of active trial devices:
- number of devices seen within online threshold:
- number of unexpected offline devices:
- latest-state pages judged accurate: yes / no
- representative device checks passed: yes / no

Notes:

- whether `device_latest` remained fresh
- whether page-side data still matched backend latest state

## 4.2 Command closure

- total commands sent this week:
- commands completed as `done`:
- commands completed as `acked` only:
- commands marked `failed`:
- commands still `pending / sent / acked` longer than expected:

Notes:

- whether command tracking stayed understandable
- whether any command result was user-visible but backend-untraceable

## 4.3 Runtime path stability

- `api-scf /health` stable: yes / no
- `runtime-service /health` stable: yes / no
- ingest proxy enabled: yes / no
- enabled API proxy routes:
- fallback used unexpectedly: yes / no

Notes:

- whether proxying reduced load or improved consistency
- whether SCF fallback carried more traffic than intended

## 4.4 Monitoring and failure signal

- count of `runtime_proxy_failed`:
- count of `push_processing_failed`:
- count of `device_command_failed`:
- count of `cleanup_alerts_detected`:
- count of `cleanup_failed`:
- count of unexplained critical events:

Notes:

- which alerts mattered
- which alerts were noise

## 5. Capacity and concurrency observation

This section does not replace formal pressure testing, but it helps decide whether the trial is still inside a safe operating window.

- highest observed request period:
- highest observed message burst:
- latest-state query response stayed acceptable: yes / no
- command send response stayed acceptable: yes / no
- database pressure concerns observed: yes / no
- Redis pressure concerns observed: yes / no / not enabled

If any item looked weak, write:

- observed symptom
- probable bottleneck layer
- immediate mitigation
- whether rollout expansion must pause

## 6. Changes made this week

Record only meaningful changes that could affect trial interpretation:

- config changes
- proxy route changes
- Redis enablement changes
- database schema changes
- command provider path changes
- monitoring rule changes

Template:

```text
Change:
Date:
Owner:
Reason:
Expected effect:
Rollback path:
```

## 7. Incidents and notable issues

For each incident, add one short line and link the detailed review.

| Date | Short title | User-visible impact | Current status | Linked review |
| --- | --- | --- | --- | --- |
| YYYY-MM-DD | example | low / medium / high | open / mitigated / closed | `./incident-review-template.md` |

## 8. Main risks entering next week

List the top 3 to 5 risks only.

Template:

```text
Risk:
Why it matters:
Temporary containment:
Permanent fix owner:
Target date:
```

## 9. Recommended decision for next week

Choose one:

- keep current scope
- expand only device count
- expand command scenarios
- keep trial running but freeze architectural change
- pause trial and fix a blocking issue first

Decision basis should reference:

- latest-state trust
- command closure trust
- monitoring signal
- rollback confidence
- observed capacity margin

## 10. Filled example skeleton

```text
Week: 2026-W29
Environment: trial
Report owner: backend lead
Trial scope this week: 12 devices, latest-state + command detail through runtime-service proxy

Weekly verdict: yellow
Recommended next-step decision: continue with limits

Top reason:
- latest-state remained stable
- command closure mostly worked
- a few proxy failures still need explanation before expansion
```
