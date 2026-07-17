# Trial Capacity Baseline

Updated: 2026-07-15

This document defines the first practical capacity baseline for moving the project from demo posture into a small stable trial.

It does not claim large-scale production readiness.

It gives the team a way to answer these smaller but critical questions:

- is the current trial traffic still inside a safe operating window
- which layer is likely to fail first when traffic increases
- when should SCF remain the main path, and when should resident runtime-service take over more traffic

## 1. What this baseline is for

Use this document to create a repeatable answer for:

- latest-state query can still respond fast enough
- command send path still returns in acceptable time
- runtime-service proxy path does not collapse under a moderate burst
- MySQL and Redis pressure is being watched before user-visible instability appears

This is intentionally a trial-stage baseline, not a final production SLO system.

## 2. What “good enough” means at this stage

For the small stable trial stage, the goal is:

- requests remain mostly successful
- latency remains understandable and not obviously degrading
- failures are visible and traceable
- rollback can still happen quickly

Suggested initial pass line for trial use:

- success rate >= 99%
- no unexplained timeout burst
- measured `p95` latency stays inside a team-agreed limit for the tested endpoint
- monitoring shows no sustained rise in:
  - `runtime_proxy_failed`
  - `request_failed`
  - `device_command_failed`
  - database write failures

## 3. Which endpoints should be tested first

Start with the paths that matter most for trial trust:

1. `POST /device/latest` or `POST /runtime/device/latest`
2. `POST /device/cmd` or `POST /runtime/device/command/send`
3. `POST /runtime/ingest/message` once proxy-based write path is being validated

Recommended order:

- latest-state read first
- command send second
- ingest write path third

That order matches rollout risk: read instability is easier to contain than write instability.

## 4. A simple stage model for this project

This is not a hard promise. It is a practical decision model.

## 4.1 Stage A: demo / internal联调

Typical shape:

- few devices
- limited simultaneous users
- no sustained burst load
- SCF still acceptable for most paths

Recommended main path:

- SCF remains primary
- Redis optional
- resident runtime-service may exist only for validation

Main risk:

- concurrency bottleneck shows up first in repeated latest-state queries and command tracking

## 4.2 Stage B: small stable trial

Typical shape:

- tens to low hundreds of devices
- regular status reports
- command path must be traceable
- latest-state page becomes high-frequency

Recommended main path:

- SCF keeps auth, low-frequency APIs, timers, AI support
- runtime-service starts owning latest-state, command tracking, and online-state logic
- Redis becomes strongly recommended for latest snapshot, online state, command-processing state, and dedup markers

Main risk:

- without Redis and resident service, read amplification and repeated status assembly begin to hurt response time

## 4.3 Stage C: larger rollout preparation

Typical shape:

- hundreds to thousands of devices
- bursts become common instead of occasional
- write path and command loop cannot depend on cold-start-prone logic

Recommended main path:

- resident runtime-service becomes the default core path
- SCF becomes edge/business helper rather than real-time core
- Redis is no longer optional for the hot path
- database indexing and query shape must be reviewed using real measurements

Main risk:

- if SCF still carries most hot-path traffic, concurrency pain appears early and troubleshooting gets harder

## 5. SCF should be considered sufficient only up to what point

Use this rule of thumb:

- if traffic is still occasional, SCF can remain the main path
- if latest-state queries become frequent and commands must be tracked continuously, SCF should stop being the only real-time core
- if burst traffic starts causing timeout, backlog, or unstable latency, move more of the hot path to runtime-service immediately

In short:

- SCF is good for early validation
- SCF is not the long-term home for the hottest real-time path

## 5.1 What this means in plainer language

For this project, the current optimization plan should be interpreted like this:

- it is enough to support a controlled small trial when the hot path is already being pulled toward `runtime-service`
- it is not enough evidence to claim large-scale high-concurrency readiness by itself
- it becomes much more credible when the team can show repeated smoke or pressure checks with stable results

So the right management statement is not:

- "this plan guarantees high concurrency"

The right statement is:

- "this plan removes the main demo-stage bottlenecks and creates the structure required to scale further"

## 5.2 First layer likely to fail if the plan is not followed

When traffic rises, the likely order of pain is usually:

1. repeated latest-state queries amplify MySQL reads
2. command closure logic becomes slow or harder to trace
3. SCF latency becomes unstable under burstier hot-path traffic
4. operations lose confidence because failures are visible later than they should be

This is exactly why the plan separates:

- Redis for short-lived hot state
- MySQL for durable fact
- runtime-service for continuous real-time behavior

## 6. Lightweight load-smoke command

The repository now includes:

- `scripts/runtime-load-smoke.js`

Example latest-state smoke:

```bash
node scripts/runtime-load-smoke.js \
  --url http://127.0.0.1:18080/runtime/device/latest \
  --method POST \
  --body-file ./reference/runtime-device-latest.sample.json \
  --header "Content-Type: application/json" \
  --concurrency 10 \
  --requests 100 \
  --warmup-requests 20 \
  --timeout-ms 3000 \
  --pretty
```

Example command-send smoke:

```bash
node scripts/runtime-load-smoke.js \
  --url http://127.0.0.1:18080/runtime/device/command/send \
  --method POST \
  --body-file ./reference/runtime-device-command-send.sample.json \
  --header "Content-Type: application/json" \
  --concurrency 5 \
  --requests 30 \
  --warmup-requests 10 \
  --timeout-ms 5000 \
  --pretty
```

What to look at:

- `success`
- `failures`
- `timeouts`
- `throughputRps`
- `latencyMs.p95`
- `latencyMs.p99`
- `statusCodes`

## 7. Suggested trial baseline table

Use this as the first recorded benchmark sheet.

| Endpoint | Environment | Concurrency | Requests | Success target | p95 target | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| latest-state | dev/test | 10 | 100 | >= 99% | team-defined | read path first |
| command send | dev/test | 5 | 30 | >= 99% | team-defined | must remain traceable |
| ingest write | dev/test | 10 | 100 | >= 99% | team-defined | enable only after write path validation |

The exact latency target can differ by environment.

What matters first is consistency and trend:

- is the result stable between repeated runs
- does higher concurrency degrade sharply
- do failures cluster in one layer

## 8. How to interpret the result

If latest-state degrades first:

- check whether current page still over-queries
- check MySQL read pattern
- check Redis latest cache usage
- move read traffic earlier to runtime-service if not already done

If command send degrades first:

- inspect provider adapter latency
- inspect `device_commands` write behavior
- inspect command-state cache update timing
- check whether SCF is still carrying too much of the closure logic

If ingest degrades first:

- inspect dedup writes
- inspect latest-state update path
- inspect fallback frequency
- verify write path is not doing too much synchronous work

## 9. Required evidence before saying “it can handle more load”

Do not rely on intuition only.

Before expanding trial scope, record:

- endpoint tested
- environment
- command used
- result summary
- matching monitoring summary
- whether rollback remained available

Pair this document with:

- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Daily Trial Ops Checklist](./daily-trial-ops-checklist.md)
- [Trial Weekly Report Template](./trial-weekly-report-template.md)

## 10. Bottom line

This baseline is enough to support the next decision:

- stay in controlled small trial
- expand a little
- or stop and fix a bottleneck first

It is not enough to justify a claim of large-scale high-concurrency readiness.

What it can justify is narrower and more useful:

- the project can move from "demo" toward "small stable trial"
- the team can identify which layer must be upgraded next
- scale discussions can be based on measurements instead of intuition only
