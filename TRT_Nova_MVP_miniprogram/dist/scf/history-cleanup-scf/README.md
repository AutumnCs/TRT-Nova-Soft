# history-cleanup-scf

Scheduled MySQL cleanup and lightweight inspection job.

## Recommended trigger

- Tencent Cloud SCF scheduled trigger
- Run once per day at minimum

## Handler

- `index.main`
- `index.main_handler`

## Responsibilities

- clean old `device_message_ingest` rows
- clean old `device_history_raw` rows
- clean old `device_history_agg` rows
- fail timed-out `device_commands`
- emit lightweight inspection summaries for offline devices and lagging commands

## Environment variables

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_CONN_LIMIT`
- `INGEST_RETENTION_DAYS`
- `RAW_RETENTION_DAYS`
- `AGG_5M_RETENTION_DAYS`
- `AGG_1H_RETENTION_DAYS`
- `AGG_1D_RETENTION_DAYS`
- `COMMAND_TIMEOUT_MINUTES`
- `ALERT_OFFLINE_MINUTES`
- `ALERT_COMMAND_LAG_MINUTES`

## Inspection output

Besides cleanup, this job emits summaries for:

- devices that have not reported for longer than the configured offline threshold
- commands that are still pending/sent/acked before the final timeout threshold

These summaries are suitable as a minimal input for later monitoring and alert integrations.
