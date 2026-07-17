# Trial Readiness Gap Assessment

Updated: 2026-07-15

This document is a practical gap assessment for the current repository state.

Its purpose is simple:

- show what is already strong enough for small-trial preparation
- show what is still incomplete, unverified, or environment-dependent
- prevent the team from confusing "implemented in repo" with "accepted for real trial"

It should be read together with:

- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Deployment Checklist](./trial-deployment-checklist.md)
- [Next-Stage Optimization Plan](./next-stage-optimization-plan.md)

## 1. Executive summary

Current overall verdict:

- not `demo-only` anymore
- not yet proven `accepted` for small stable trial
- closest honest label today is:
  - `preparing for accepted_with_limits`, pending environment and real-device evidence

The repo now has meaningful progress in:

- unified message model
- latest-state read model
- command-state lifecycle
- dedup and idempotency behavior
- Redis/runtime-cache hot-path behavior
- command latest/detail/list consistency
- rollout, deployment, and monitoring documentation

The biggest remaining gap is no longer basic repository structure.

The biggest remaining gap is proof in a real target environment.

## 2. What is already strong in the repo

### 2.1 Core data and message path

Status:

- largely implemented in code and docs

Evidence already present:

- unified message normalization exists in SCF and runtime-service
- `device_latest` is treated as the current-state source of fact
- `device_commands` status flow exists with `pending / sent / acked / done / failed`
- `device_message_ingest` supports dedup trail
- automated tests cover message normalization, latest-state update, dedup behavior, and command state progression

Assessment:

- this is no longer a loose demo chain
- the repo direction is consistent with small-trial architecture

### 2.2 Latest-state-first query path

Status:

- materially improved and now credible for trial preparation

Evidence already present:

- homepage and device detail have been pushed toward latest-state-first behavior
- latest-state response includes page-ready aggregates
- online/offline rule is unified by backend
- runtime-service latest query now supports cache-first + repository backfill behavior
- latest-state cacheMeta semantics are documented and tested

Assessment:

- this is one of the strongest parts of the current repo state

### 2.3 Command closure path

Status:

- implemented strongly enough for controlled trial preparation, but still needs real-device proof

Evidence already present:

- command send returns `commandId`
- command detail endpoint exists
- command list endpoint exists
- ingest reconciliation can advance `sent -> acked` and `sent -> done`
- latest-state, command list, and command detail now share a closer hot-state view
- cacheMeta and structured logs make behavior more explainable

Assessment:

- the code path is now much more believable
- the remaining uncertainty is environment truth, not repository structure

### 2.4 Trial-stage documentation and governance package

Status:

- strong

Evidence already present:

- rollout checklist
- deployment checklist
- acceptance checklist
- daily ops checklist
- weekly report template
- incident review template
- capacity baseline
- stage-scale plan
- staged deployment/scaling guide
- environment variable matrix

Assessment:

- the repo now has a real operating-document bundle, not just architecture notes

## 3. What is still incomplete or unproven

### 3.1 Real environment acceptance evidence

Status:

- missing or not proven from repository evidence

Still needed:

- confirmed target environment
- confirmed health of deployed `api-scf`
- confirmed health of deployed `runtime-service`
- confirmed MySQL connectivity in target environment
- confirmed Redis connectivity in target environment if enabled
- screenshots, logs, or operator records showing the target environment is actually healthy

Assessment:

- this is the biggest blocker to calling the project small-trial accepted

### 3.2 Real device command closure proof

Status:

- not yet proven from repo evidence

Still needed:

- one known-good real device command send
- resulting `device_commands` row in target environment
- ACK or state feedback in logs
- final command state visible in list/detail/latest views

Assessment:

- the code strongly suggests the chain can work
- acceptance still requires real-device evidence

### 3.3 Redis real-instance validation

Status:

- code path exists, but live proof is missing

Still needed:

- runtime-service connected to a real Redis instance
- TTL behavior confirmed
- dedup short-circuit behavior observed in logs
- latest / online / command state observed under a real request flow

Assessment:

- Redis is no longer only planned in code terms
- Redis is still not fully operationally proven

### 3.4 MySQL live verification for runtime-service

Status:

- scaffold exists, but live proof is still weak

Still needed:

- mysql repository used in target environment
- `device_latest` writes observed
- `device_commands` writes observed
- `device_message_ingest` dedup rows observed
- query behavior verified against real rows

Assessment:

- repository code exists
- environment proof is still required

### 3.5 Ingest proxy and rollback proof

Status:

- prepared, not yet proven

Still needed:

- controlled enablement of ingest proxy
- observed fallback behavior when runtime proxy path is interrupted
- rollback record without code changes

Assessment:

- rollout discipline is documented
- confidence requires one real exercise

## 4. Gap classification by area

| Area | Repo status | Environment status | Trial impact |
| --- | --- | --- | --- |
| Unified message model | strong | partly unproven | medium |
| Latest-state model | strong | needs target-env verification | high |
| Command lifecycle | strong | needs real-device proof | high |
| Dedup/idempotency | strong in code/tests | needs live trace evidence | high |
| Redis hot state | strong direction | live Redis proof still missing | medium/high |
| Runtime-service observability | strong | needs real log collection path | medium |
| Rollout/rollback docs | strong | needs one exercised run | high |
| Monitoring minimum | decent | still needs operational usage | high |
| Capacity evidence | baseline only | no real trial measurements yet | medium |

## 5. Best current acceptance-style verdict

If the team asked today, based on repository evidence only:

- do not call it `accepted`
- do not reduce it back to `demo-only`

Best current wording:

- `not_accepted_yet`, but with strong repository readiness and a clear path to `accepted_with_limits`

If the team completes the minimum environment and real-device checks, the next realistic verdict is:

- `accepted_with_limits`

That would mean:

- small controlled trial is reasonable
- scope should remain intentionally narrow
- expansion should wait for repeated live evidence

## 6. Highest-value next actions

Use this order:

1. verify one target environment end to end
2. verify one real device command closure end to end
3. verify Redis live connectivity and observe runtime-service logs
4. enable the smallest safe proxy route set
5. record the first acceptance-style verdict with evidence

## 7. What should not block the first small trial

These are important, but should not be mistaken for immediate blockers if P0 evidence is otherwise strong:

- full production-grade observability platform
- large-scale concurrency proof
- queue-based full decoupling
- full CloudBase historical cleanup
- final platform simplification between all possible provider paths

## 8. Bottom line

The repository has moved meaningfully beyond demo posture.

What remains is not mostly "more architecture slides" or "more scaffolding".

What remains is:

- target-environment proof
- real-device proof
- first controlled rollout proof

That is a healthier place to be than earlier in the project:

- the main gap is now operational validation, not missing core direction
