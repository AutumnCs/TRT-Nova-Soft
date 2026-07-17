# Daily Trial Ops Checklist

Updated: 2026-07-15

This document is the daily operator checklist for the small stable trial stage.

Use it once per day during the trial window, and use it again whenever a significant issue or rollout change happens.

## 1. Daily objective

The daily question is simple:

- did latest state remain trustworthy today?
- did command closure remain traceable today?
- did any proxy path become unstable?

If the answer is unclear, treat that as an issue, not as “probably fine”.

## 2. Daily quick check

## 2.1 Service health

- [ ] `api-scf /health` is normal
- [ ] `runtime-service /health` is normal
- [ ] if trial uses proxying, enabled proxy routes are known and recorded

## 2.2 Device freshness

- [ ] no unexpected increase in offline devices
- [ ] at least one representative device reported normally today
- [ ] latest state in mini-program matches expected recent data

## 2.3 Command loop

- [ ] at least one representative command path is still healthy
- [ ] command send still returns `commandId`
- [ ] no obvious pile-up of `pending / sent / acked` commands without progression
- [ ] command detail still loads for recent commands

## 2.4 Error watch

- [ ] no unusual `runtime_proxy_failed` spike
- [ ] no unusual `push_processing_failed` spike
- [ ] no unusual `device_command_failed` spike
- [ ] no `cleanup_failed` event that remains unexplained

## 3. Daily monitoring summary

Recommended command:

```bash
node scripts/monitoring-log-summary.js --file ./logs/scf.ndjson --config ./reference/minimal-monitoring.config.example.json --pretty
```

Record:

- [ ] overall status: `ok / warn / critical`
- [ ] key counts reviewed
- [ ] sample errors reviewed

If `overall = critical`:

- [ ] create or update incident note
- [ ] pause further rollout expansion
- [ ] evaluate rollback need immediately

## 4. Database and state sanity check

These do not need to be heavy every day, but should be sampled:

- [ ] one recent `device_latest` row sampled
- [ ] one recent `device_commands` row sampled
- [ ] one recent `device_message_ingest` row sampled if ingest proxy is enabled

Suggested purpose:

- confirm freshness
- confirm command status progression
- confirm dedup trail still exists

## 5. Rollout-state record

Keep a short daily record of what is currently enabled:

```text
Date:
Environment:
Enabled api-scf proxy routes:
Ingest proxy enabled: yes / no
Redis enabled for runtime-service: yes / no
Observed overall monitoring state:
Main issue today:
Rollback performed: yes / no
Next action:
```

## 6. When to escalate immediately

Escalate without waiting for the next daily cycle if any of these happens:

- latest state stops updating for active devices
- command send appears successful but device state never reflects it
- command backlog grows abnormally
- runtime-service health becomes unstable
- proxy failures become repeated rather than occasional
- fallback is silently carrying most traffic when it was not intended

## 7. When to roll back immediately

Roll back promptly if:

- user-visible latest-state pages become unreliable
- device commands become untraceable
- ingest proxy causes obvious freshness loss
- the team cannot determine whether command completion is still trustworthy

Recommended rollback order:

1. disable `INGEST_SCF_RUNTIME_PROXY_ENABLED`
2. remove `/device/command/detail` from `API_SCF_RUNTIME_PROXY_ROUTES`
3. remove `/device/commands` from `API_SCF_RUNTIME_PROXY_ROUTES`
4. remove `/device/cmd` from `API_SCF_RUNTIME_PROXY_ROUTES`
5. remove `/device/latest` from `API_SCF_RUNTIME_PROXY_ROUTES`

## 8. Daily sign-off rule

The day should be considered signed off only when:

- health checks are green
- monitoring summary is reviewed
- latest-state trust is not in doubt
- command closure is not in doubt
- open issues are written down, not kept in memory

That is enough discipline for a small stable trial, even before a larger production ops system exists.
