# Four-Week Trial Execution Plan

Updated: 2026-07-15

This document turns the next-stage optimization plan into a practical four-week execution schedule.

It is designed for the current target only:

- move from demo posture into small stable trial posture

It is not a full product roadmap.

## 1. Use of this plan

Use this plan when the team needs a near-term operating schedule:

- what to finish this week
- what evidence is needed before moving to the next week
- what risks can block trial expansion

## 2. Four-week outcome target

At the end of week 4, the target state is:

- latest-state trust is good enough for small trial use
- command closure is traceable on representative devices
- dedup and idempotency are not just implemented, but operationally understood
- runtime-service path can be enabled gradually with rollback confidence
- trial operation has daily review, weekly review, and incident review discipline

## 3. Week 1 — close the core data model

### Main goal

Stop treating the runtime path like a loose demo chain.

### Main tasks

- confirm unified device message model is the internal standard
- confirm `device_latest` is the authoritative current-state table
- confirm `device_commands` status flow is consistent
- confirm `device_message_ingest` supports dedup and idempotency tracing
- re-check frontend/service calls that still read “current state” indirectly from history

### Main deliverables

- unified message model documentation aligned with code
- latest-state read path confirmation
- command-state lifecycle confirmation
- first list of remaining page-side current-state assembly points

### Acceptance evidence

- normalized ingest path exists in SCF and runtime-service
- latest-state API returns page-ready fields
- command list/detail path can show the same command record
- repo docs match the current implementation

### Main risk

- code may already mostly support the model, but some page-side path may still bypass it

## 4. Week 2 — close the command loop and latest-state read path

### Main goal

Make the small trial believable from a user-facing perspective.

### Main tasks

- complete latest-state-first path on key pages
- verify online/offline judgment comes from backend rule
- verify command send -> command status -> device feedback -> latest-state update chain
- validate gray proxy route order for runtime-service
- verify fallback path is still available

### Main deliverables

- latest-state-first frontend usage on homepage and device page
- command closure verification record
- runtime-service rollout preparation record

### Acceptance evidence

- representative page flow no longer depends on history assembly for current state
- representative device command can be traced end to end
- enabled routes and rollback order are explicit

### Main risk

- command send may look successful while device-side closure is still weak in real environment

## 5. Week 3 — enable trial governance and measured validation

### Main goal

Turn implementation into operable trial readiness.

### Main tasks

- enable minimum daily operational discipline
- run monitoring summary against exported logs
- run lightweight load smoke against latest-state and command-send path
- prepare first weekly report draft
- prepare incident review workflow even if no major incident has happened yet

### Main deliverables

- daily trial ops routine
- one monitoring summary sample
- one load-smoke sample result
- first weekly report template usage example

### Acceptance evidence

- monitoring summary can be generated
- load-smoke output can be recorded and interpreted
- weekly review can reference both operational and capacity evidence

### Main risk

- the team may have documents, but not yet real discipline in using them

## 6. Week 4 — controlled trial enablement

### Main goal

Move from “prepared” to “controlled, observable trial enablement”.

### Main tasks

- enable the smallest safe trial scope
- keep proxy rollout limited and explicit
- review daily health, freshness, command closure, and failure signal
- record weekly verdict using acceptance and capacity references
- decide one of:
  - continue current scope
  - expand slightly
  - hold and fix
  - roll back selected runtime path

### Main deliverables

- first controlled trial window record
- first weekly verdict
- first expansion/hold/rollback decision note

### Acceptance evidence

- trial status can be judged as `accepted`, `accepted_with_limits`, or `not_accepted_yet`
- command closure remains understandable during the window
- latest-state trust remains acceptable during the window
- rollback remains available without code changes

### Main risk

- the team may expand too early before enough repeated evidence exists

## 7. Weekly manager checkpoint

Use the same five questions every week:

- which P0 items are now evidenced, not just coded
- what still depends too heavily on SCF hot-path behavior
- what is the current highest-confidence runtime-service route
- which signal would force rollback today
- what blocks the next step more: architecture gap or operational discipline gap

## 8. Suggested weekly ownership split

| Area | Suggested owner |
| --- | --- |
| runtime-service / SCF hot path | backend owner |
| latest-state page consumption | frontend owner |
| rollout switch and deployment record | backend or ops owner |
| daily review / weekly report | technical owner |
| trial verdict and scope decision | project owner |

## 9. What not to do during these four weeks

- do not attempt a full rewrite
- do not broaden the scope to full-scale production claims
- do not move all state into Redis without hot-path evidence
- do not let dual-path ambiguity between OneNET and EMQX grow silently
- do not expand trial scope just because one happy-path demo passed

## 10. Related repo documents

- [Next-Stage Optimization Plan](./next-stage-optimization-plan.md)
- [Runtime Service Trial Rollout Checklist](./runtime-service-rollout-checklist.md)
- [Trial Acceptance Checklist](./trial-acceptance-checklist.md)
- [Daily Trial Ops Checklist](./daily-trial-ops-checklist.md)
- [Trial Weekly Report Template](./trial-weekly-report-template.md)
- [Trial Capacity Baseline](./trial-capacity-baseline.md)
- [Trial Scale Stage Plan](./trial-scale-stage-plan.md)
