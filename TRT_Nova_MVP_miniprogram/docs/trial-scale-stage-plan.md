# Trial Scale Stage Plan

Updated: 2026-07-15

This document gives a practical scaling view for the current project.

It is not a precise capacity guarantee.

It is a planning aid for one question:

- when the project grows from demo to small stable trial and then beyond, which backend shape should be the default

## 1. Three useful scale checkpoints

For this project, three checkpoints are enough for the next stage of decision-making:

- around `100` devices
- around `1000` devices
- around `10000` devices

These are not hard lines.

They are management checkpoints for deciding whether the current architecture is still appropriate.

## 2. Around 100 devices

This is the typical small stable trial stage.

### Recommended backend shape

- mini-program remains unchanged as the main client
- `auth-scf` stays for login and token issuance
- `api-scf` may still keep many low-frequency business APIs
- `runtime-service` should already start owning:
  - latest-state query
  - command closure tracking
  - online/offline state judgment
- MySQL remains the main fact store
- Redis should be enabled for:
  - latest snapshot cache
  - online state
  - command-processing state
  - short-term dedup markers

### What SCF can still do here

SCF can still be a useful outer layer for:

- authentication
- low-frequency business API
- scheduled cleanup
- AI suggestion style features

But SCF should stop being the only hot-path real-time core.

### Main risks at this stage

- latest-state pages still reading too much historical data
- command send success and command actual execution being confused
- duplicate device reports creating repeated effects
- trial traffic hiding bottlenecks because no one measured them

### Practical judgment for this stage

At this scale, the project can still tolerate some SCF participation.

But the judgment line should be:

- SCF can stay in the chain
- SCF should not remain the only owner of hot-path latest-state and command closure logic

If the team is already seeing any of the following, then the system is behaving more like the next stage:

- homepage and device page are being refreshed frequently during daily use
- command send needs predictable feedback instead of "best effort"
- multiple devices report around the same time and latency becomes visibly unstable
- fallback and retry behavior is starting to matter operationally

### Minimum governance required

- latest-state endpoint becomes the page default
- command status becomes traceable end to end
- monitoring summary is reviewed daily
- lightweight load smoke is run before trial expansion

## 3. Around 1000 devices

This is no longer only a “small trial” mindset.

At this point the system needs to act like a real platform core.

### Recommended backend shape

- `runtime-service` becomes the default owner of the real-time path
- `api-scf` becomes more of a gateway/helper layer than the core processor
- Redis is no longer optional for hot state
- MySQL indexes and query plans must be checked with real workload evidence
- command provider adapter should be real, stable, and observable

### Strongly recommended additions

- stronger request limiting
- stricter timeout and retry policy
- more explicit queue or asynchronous buffering on the write path if bursts are visible
- better separation between hot-path API and background/statistical processing

### Practical judgment for this stage

At this scale, the project should stop treating SCF as the default real-time core.

The recommended rule is:

- SCF may still be retained for auth, low-frequency business APIs, timers, and peripheral abilities
- FastAPI `runtime-service` (or another resident backend with equivalent characteristics) should become the default owner of latest-state, command tracking, and online-state logic
- Redis should already be holding the short-lived hot state that would otherwise cause repeated MySQL reads or repeated in-memory recomputation

If that shift has not happened yet, the risk is not only throughput.

The bigger problem is that latency, timeout behavior, and command traceability will become harder to explain and harder to recover during bursts.

### Main risks at this stage

- SCF cold start or connection churn hurting hot-path latency
- MySQL becoming the first visible bottleneck on repeated latest-state reads
- command backlog growing without timely visibility
- Redis being present but not actually covering the hot keys that matter

### Decision rule

If you are near this stage and SCF still carries most latest/query/command hot traffic, the architecture is lagging behind the business shape.

## 4. Around 10000 devices

This is a very different operating mode.

At this point, “trial-ready” architecture is not enough.

### Recommended backend shape

- resident runtime service cluster as the core real-time path
- Redis as a formal hot-state layer
- MySQL optimized with index review, archival discipline, and likely read/write traffic strategy refinement
- clearer event or queue separation between:
  - ingest
  - latest-state update
  - command tracking
  - analytics/history enrichment

### What changes in engineering expectations

- pressure testing becomes mandatory, not optional
- capacity planning becomes periodic work
- observability needs to include latency, error rate, and backlog trend
- failure isolation matters more than feature completeness

### Main risks at this stage

- one synchronous path doing too much work
- fallback path silently becoming the primary path
- command traceability being lost in burst conditions
- history and latest-state concerns not being separated enough

### Practical judgment for this stage

At this scale, "trial-ready" engineering is no longer enough.

The team should assume:

- resident services are normal, not optional
- Redis is formal infrastructure, not an experiment
- write-path decoupling is likely required
- observability and capacity review become recurring work, not one-off setup

## 5. One simple table

| Scale checkpoint | Default architecture posture | SCF role | Runtime-service role | Redis role |
| --- | --- | --- | --- | --- |
| ~100 devices | small stable trial | outer/business helper + some retained APIs | start owning hot path | recommended |
| ~1000 devices | real platform core transition | helper/gateway, not hot-path core | default real-time core | required for hot state |
| ~10000 devices | scale-oriented platform | edge/support role | clustered real-time core | formal hot-state infrastructure |

## 5.1 A simpler one-sentence rule

If you want one rule for day-to-day decisions, use this:

- below the small trial line, SCF can still help a lot
- once hot-path status reads and command closure become frequent, SCF should stop being the main real-time core
- once you are planning for sustained bursts, resident backend + Redis are no longer optional architecture upgrades

## 6. How to use this with the existing repo docs

Use this document together with:

- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Runtime Service Migration Map](./runtime-service-migration-map.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)

## 7. Bottom line

For the current project:

- getting to around `100` devices in a controlled, stable way is the immediate goal
- designing as if `1000` and `10000` will never come is the wrong move
- designing as if you already need a huge microservice platform today is also the wrong move

The right move is staged evolution:

- close the core chain
- separate hot state from historical fact
- put Redis only where it is most valuable
- move the hottest runtime logic out of SCF first
