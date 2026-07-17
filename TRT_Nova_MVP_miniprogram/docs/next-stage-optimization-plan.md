# Next-Stage Optimization Plan

Updated: 2026-07-15

This document turns the current architecture direction into an execution plan for the next stage.

Its target is clear:

- move the project from demo posture into a small stable trial posture

It is intentionally practical:

- what to do first
- what can wait
- what evidence proves each step is good enough

## 1. Overall objective

The next stage is not:

- full production hardening
- large-scale high-concurrency readiness
- full microservice transformation

The next stage is:

- close the core device path
- make latest state trustworthy
- make command closure traceable
- make trial operation measurable and rollback-safe

## 2. Priority model

Use only three priority levels for the next stage:

| Priority | Meaning |
| --- | --- |
| P0 | must be true before calling the project “small stable trial ready” |
| P1 | strongly recommended during the same stage; should follow immediately after P0 |
| P2 | useful, but should not distract from trial readiness |

## 3. P0 work package

These are the highest-priority items.

## 3.1 Core message and state path

Goal:

- backend internally recognizes one unified device message model
- latest state is read from `device_latest`
- command lifecycle is recorded in `device_commands`

Main deliverables:

- unified ingest model in SCF and runtime-service
- `device_latest` as the authoritative current-state read model
- `device_commands` status flow: `pending / sent / acked / done / failed`
- `device_message_ingest` dedup and idempotency trail

Completion evidence:

- ingest path writes normalized data consistently
- latest-state API returns page-ready aggregated fields
- command send returns `commandId`
- command list and command detail can trace the same command

## 3.2 Trial-ready read path

Goal:

- mini-program pages stop rebuilding current state from history

Main deliverables:

- homepage reads latest-state API first
- device page reads latest-state API first
- online/offline rule is unified by backend
- frontend display fields are driven by backend aggregates

Completion evidence:

- frontend code path prefers latest-state endpoint
- `api-scf /device/latest` or runtime-service latest endpoint returns enough page-ready data
- online/offline status is no longer guessed page by page

## 3.3 Command closure and rollback-safe rollout

Goal:

- the team can verify command closure and roll back safely if the new path is unstable

Main deliverables:

- command send / command list / command detail path
- runtime-service proxy switches for gray rollout
- ingest proxy with fallback control
- rollout checklist and rollback order

Completion evidence:

- one representative device command can be traced end to end
- proxy routes can be enabled incrementally
- rollback does not require code change

## 3.4 Minimum operational governance

Goal:

- the team can operate a small trial without guessing

Main deliverables:

- daily ops checklist
- weekly report template
- incident review template
- minimal monitoring summary
- trial acceptance checklist

Completion evidence:

- logs can be summarized
- the team can produce a daily review and weekly summary
- trial acceptance can be judged with explicit P0/P1 criteria

## 4. P1 work package

These items should be done immediately after or alongside late P0 work when the dependencies allow it.

## 4.1 Redis real-time layer hardening

Goal:

- move only the highest-value hot state into Redis

Main deliverables:

- latest snapshot cache
- online-state cache
- command-processing cache
- short-term dedup markers

Completion evidence:

- runtime path can use Redis without breaking MySQL as source of fact
- cache miss / hit behavior is observable
- disabling Redis still preserves correctness, though with lower confidence

## 4.2 Resident runtime-service expansion

Goal:

- move the hottest continuous runtime logic out of SCF first

Main deliverables:

- runtime-service health endpoint
- runtime-service latest query
- runtime-service command detail
- runtime-service command send
- runtime-service ingest entry

Completion evidence:

- SCF can proxy selected routes to runtime-service
- runtime-service behavior matches existing contract closely enough for trial use
- command and latest-state flows remain understandable in logs

## 4.3 Trial-stage capacity verification

Goal:

- trial expansion decisions use measurements instead of confidence alone

Main deliverables:

- trial capacity baseline
- lightweight load smoke script
- sample request payloads
- scale-stage planning reference

Completion evidence:

- at least one latest-state smoke test is runnable
- at least one command-send smoke test is runnable
- results can be written into weekly review

## 5. P2 work package

These are valuable, but should not delay small stable trial readiness.

## 5.1 Platform-path simplification

- reduce long-term dual-primary ambiguity between OneNET and EMQX
- keep only one clearly documented main production path

## 5.2 Further CloudBase cleanup

- continue removing dead main-path dependence
- keep only explicit legacy compatibility where still needed

## 5.3 Advanced production engineering

- queue-based decoupling
- fuller CI/CD and release governance
- stronger disaster recovery drills
- broader security hardening

## 6. Suggested execution sequence

Use this sequence unless strong evidence says otherwise:

1. close unified message model, latest-state model, command-state model
2. complete dedup and command closure behavior
3. complete latest-state-first frontend/API behavior
4. enable Redis only for the most valuable hot state
5. expand runtime-service ownership of hot runtime logic
6. reinforce monitoring, capacity evidence, and legacy cleanup

## 7. What can run in parallel

Safe to parallelize:

- documentation and operational templates
- monitoring summary tooling
- runtime-service scaffold hardening
- frontend latest-state consumption cleanup

Should stay sequence-sensitive:

- command closure behavior before wider command rollout
- ingest proxy before full confidence in fallback
- Redis enablement before cache key and TTL rules are clear

## 8. Definition of success for this stage

This stage should be considered successful when all of the following are true:

- latest-state trust is good enough for daily use in a small trial
- command closure is traceable for representative real devices
- duplicate message handling no longer creates obvious repeated effects
- the team can enable, observe, and roll back runtime-service proxy routes safely
- daily review and weekly review can be produced from actual evidence
- trial scope can be discussed with measured capacity signals instead of guesswork

## 9. Recommended manager-style checkpoint questions

Use these questions every week:

- which P0 items are fully evidenced, not just implemented
- which hot-path logic still depends too heavily on SCF
- where is Redis adding value already, and where is it still only planned
- what is the current blocker to widening the trial scope
- if trial traffic doubled next week, which layer is most likely to fail first

## 10. Related repo documents

- [Current Architecture](./current-architecture.md)
- [Runtime Service Migration Map](./runtime-service-migration-map.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./trial-scale-stage-plan.md)
- [Daily Trial Ops Checklist](./daily-trial-ops-checklist.md)
