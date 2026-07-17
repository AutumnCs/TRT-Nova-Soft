# Staged Deployment and Scaling Guide

Updated: 2026-07-15

This document turns the current architecture direction into a practical deployment and scaling guide.

It is written for one purpose:

- help the team decide what backend shape is appropriate at roughly `100`, `1000`, and `10000` devices

It is not a strict capacity promise.

It is a staged engineering recommendation for this repository and its current product goal.

## 1. Core principle

Use one simple rule throughout all stages:

- SCF keeps edge and support responsibilities
- resident backend keeps the hottest continuous runtime logic
- Redis stores hot temporary state
- MySQL stores durable fact

In one sentence:

- SCF handles "business entry"
- Redis handles "what is true right now"
- MySQL handles "what happened and must be retained"
- runtime-service handles "continuous real-time behavior"

## 2. Stage 1: around 100 devices

This is the current target posture:

- small stable trial

### Recommended deployment shape

- mini-program stays unchanged
- `auth-scf` remains the login entry
- `api-scf` continues to serve many low-frequency business APIs
- `ingest-scf` can remain in front of device message intake
- `runtime-service` should already be deployed, even if only one instance
- MySQL remains the main database
- Redis should be enabled for the hot temporary layer

### Suggested responsibility split

SCF keeps:

- auth
- ordinary management APIs
- scheduled tasks
- AI and recommendation features
- low-frequency admin or background routes

runtime-service starts owning:

- latest-state query
- online/offline judgment
- command send state tracking
- command detail query
- ingest-side normalized hot-state updates

Redis should hold:

- latest snapshot cache
- online state
- command processing markers
- latest command state
- short-term dedup markers

MySQL should hold:

- `device_latest`
- `device_commands`
- `device_message_ingest`
- historical telemetry and audit records

### Suggested deployment style

- 1 runtime-service instance is acceptable at first
- reverse proxy or gateway routing can remain simple
- Redis can be single-node managed instance
- MySQL can remain single primary with proper backup discipline

### What can break first

- latest-state page still reading too much history
- frequent refresh amplifying MySQL load
- command closure logic remaining half inside SCF and half elsewhere
- no one noticing timeout trends early

### Judgment

At this stage, Cloud Functions still have value.

But they should no longer be the only real-time core.

## 3. Stage 2: around 1000 devices

This is the transition from trial posture into real platform-core posture.

### Recommended deployment shape

- `runtime-service` becomes the default hot-path owner
- SCF remains as gateway/helper/business-edge layer
- Redis becomes required, not optional, for hot state
- MySQL indexing and query plans must be reviewed with real traffic
- provider-side command sending must be observable and stable

### Suggested responsibility split

SCF keeps:

- auth and token lifecycle
- low-frequency business APIs
- AI suggestion and non-real-time helper routes
- timed cleanup and operational jobs

runtime-service owns:

- latest-state read path by default
- command send and command detail by default
- online/offline state calculation
- latest command state projection
- hot-path ingest enrichment and dedup coordination

Redis should hold:

- all stage-1 hot state
- hottest page-response fragments if needed
- short-lived coordination markers for retries or duplicate suppression

MySQL should hold:

- authoritative latest-state rows
- authoritative command state rows
- history tables
- long-lived evidence needed for review and audit

### Suggested deployment style

- 2 runtime-service instances behind a load balancer is the safer default
- separate dev / test / prod configuration must be real, not nominal
- managed Redis with persistence policy should be considered
- MySQL backup and recovery drills should exist

### Strongly recommended additions

- request limiting
- timeout policy
- retry policy
- better structured logs
- minimal alerting on timeout, command lag, and ingest failure

### What can break first

- SCF cold start or connection churn affecting hot-path latency
- MySQL becoming bottleneck because Redis does not cover the true hot keys
- command backlog growing without good visibility
- sync processing doing too much in one request

### Judgment

At this stage, if SCF is still carrying most latest-state and command hot traffic, the architecture is already late.

FastAPI `runtime-service` or another equivalent resident backend should now be the normal core.

## 4. Stage 3: around 10000 devices

This is a scale-oriented platform stage, not a small trial stage.

### Recommended deployment shape

- runtime-service becomes a small service cluster
- Redis becomes formal hot-state infrastructure
- MySQL optimization becomes ongoing engineering work
- write-path decoupling should be introduced where synchronous pressure becomes visible

### Suggested responsibility split

SCF keeps:

- edge integration
- low-frequency business functions
- background orchestration
- selected administrative workflows

runtime-service cluster owns:

- real-time device state serving
- command closure state machine
- online-state maintenance
- high-frequency read aggregation

Redis should hold:

- formal hot-state dataset
- short-lived coordination and dedup keys
- limited hotspot response caching where proven useful

MySQL should hold:

- durable device fact
- durable command records
- historical telemetry
- report and audit source data

### Suggested deployment style

- multi-instance runtime-service behind load balancer
- separate monitoring for latency, error rate, saturation, and backlog
- stronger release discipline and rollback procedure
- likely event or queue separation between ingest and slower downstream work

### What can break first

- one synchronous write path doing too much work
- fallback path silently turning into the main path
- command traceability being lost under burst
- history queries leaking back into hot-path usage

### Judgment

At this stage, Redis and resident backend are no longer architecture upgrades.

They are basic operating requirements.

## 5. Should CloudBase or Cloud Functions still be kept

For this repository, the practical answer is:

- CloudBase should continue to be cleaned out of the main path if it is only legacy baggage
- SCF still has value, but mainly in edge, support, orchestration, and low-frequency roles

So the better question is not:

- should SCF disappear completely

The better question is:

- which traffic still benefits from SCF, and which traffic must leave SCF first

The answer for this project remains:

- latest-state hot reads
- command tracking
- online-state management

Those are the first things that should live in resident backend.

## 6. One practical table

| Device scale | Backend default | SCF role | Runtime-service role | Redis | MySQL |
| --- | --- | --- | --- | --- | --- |
| ~100 | trial architecture | still useful, but not sole hot core | start owning hot path | recommended | main fact store |
| ~1000 | platform-core transition | edge/helper | default real-time core | required for hot state | authoritative durable store |
| ~10000 | scale-oriented platform | support/edge | clustered real-time core | formal infrastructure | durable fact + optimized queries |

## 7. Decision checklist for the next upgrade

Before moving from one stage to the next, check:

- does latest-state still respond stably under repeated refresh
- can one command be traced from send to done or failed
- is Redis actually covering the hot keys that matter
- is MySQL still being used as fact store rather than temporary-state store
- is SCF still carrying traffic that should already be resident

If the answer to the last two questions is "yes", then the architecture split is still unfinished.

## 8. Bottom line

For the current project:

- reaching a stable `~100`-device trial is the immediate realistic goal
- planning the system so it can evolve toward `~1000` is the right engineering move
- pretending that the current stack is already ready for `~10000` would be overclaiming

The right path is staged:

- close the core chain
- separate hot state from durable fact
- make resident backend the owner of the hottest real-time logic
- add Redis where it removes real pressure, not just where it looks fashionable
