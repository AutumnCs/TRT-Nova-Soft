# TRT Nova Runtime Service Scaffold

This directory contains the first scaffold for the future resident runtime service.

Current purpose:

- hold the runtime-service entrypoint
- define unified message and command contracts in code
- separate config, repository, and provider-adapter extension points
- keep the current implementation safe and non-invasive to the existing SCF main path

It is still a scaffold, not a production replacement for the current SCF chain.

## Current interfaces

- `GET /health`
- `POST /runtime/ingest/message`
- `POST /runtime/device/latest`
- `POST /runtime/device/commands`
- `POST /runtime/device/command/detail`
- `POST /runtime/device/command/send`

## Runtime cache and observability behavior

The current scaffold now does more than define interfaces.

It already carries part of the trial-stage runtime behavior:

- short-term message dedup can be short-circuited by runtime cache
- latest-state query prefers runtime cache when a usable hot snapshot already exists
- missing latest-state / online-state hot values can be backfilled from repository fact into runtime cache
- latest command hot state can be merged into latest-state, command list, and command detail views

This means the current direction is already consistent with the intended split:

- Redis / runtime cache sees "now"
- MySQL sees durable fact

## Response cacheMeta semantics

Some runtime-service responses now expose lightweight cache diagnostics.

### `POST /runtime/device/latest`

`cacheMeta` currently includes:

- `latestSource`
- `onlineSource`

Typical values:

- `memory` or `redis`: current hot path answered mainly from runtime cache
- `cache+db`: repository fact existed and cache supplied the fresher view
- `none`: no latest-state fact was available

### `POST /runtime/device/commands`

`cacheMeta` currently includes:

- `source`
- `mode`
- `hits`
- `misses`

`mode` meanings:

- `repo_only`: command list came only from repository fact
- `cache_merged`: repository rows existed and latest runtime command state was merged in
- `cache_only_injected`: runtime cache had the newest command, but repository list did not yet carry it in the returned slice

### `POST /runtime/device/command/detail`

`cacheMeta` currently includes:

- `source`
- `mode`
- `requested`
- `hits`
- `misses`

`mode` meanings:

- `repo_only`: detail came only from repository fact
- `cache_merged`: repository row existed and runtime cache supplied fresher hot state
- `cache_only`: repository did not return the command, but runtime cache still had the hot state

## Structured log events

The service now emits lightweight JSON log events through the `runtime-service` logger.

Current events include:

- `runtime_ingest`
- `runtime_query_latest`
- `runtime_query_commands`
- `runtime_query_command_detail`
- `runtime_send_command`

Typical useful fields include:

- `logicalKey`
- `messageId`
- `commandId`
- `commandStatus`
- `deduplicated`
- `dedupSource`
- `latestSource`
- `onlineSource`
- `mode`
- `hits`
- `misses`

For trial-stage operations, these fields are useful for answering:

- was the duplicate report stopped by runtime cache or by repository fact
- did the latest-state read mainly use hot state or fall back harder to fact storage
- did command list/detail rely on repository only, cache merge, or cache-only hot state

## Current layering

```text
runtime-service/
  .env.example
  README.md
  requirements.txt
  app/
    __init__.py
    config.py
    main.py
    models.py
    repositories.py
    providers.py
    services.py
```

Responsibilities:

- `config.py`
  - runtime config loading
- `models.py`
  - request / response / unified runtime models
- `repositories.py`
  - storage abstraction, currently memory backend only
- `providers.py`
  - command dispatch adapter abstraction, currently mock backend only
- `runtime_cache.py`
  - runtime cache abstraction, supports noop / memory / redis scaffold
- `services.py`
  - runtime orchestration
- `main.py`
  - FastAPI routes

## Local run

Install:

```bash
pip install -r runtime-service/requirements.txt
```

Run:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 18080
```

Run from inside the `runtime-service/` directory.

## Current limitations

- storage may use memory or mysql scaffold
- runtime cache may use noop / memory / redis scaffold
- mysql repository scaffold has been added but is not yet validated against a live database
- command dispatch still uses mock adapter
- redis runtime cache scaffold has been added but is not yet validated against a live redis instance
- no real OneNET / EMQX dispatch yet
- no auth or ACL integration yet

## Recommended next steps

1. add MySQL-backed repository for `device_latest` and `device_commands`
2. add Redis-backed runtime cache for latest / online / command-processing state
3. add real OneNET / EMQX provider adapters
4. let `api-scf` and `ingest-scf` gradually forward traffic to this service
