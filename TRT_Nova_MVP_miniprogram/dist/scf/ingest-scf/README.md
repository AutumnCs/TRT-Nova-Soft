# ingest-scf

OneNET / EMQX webhook -> MySQL

## Supported inputs

- OneNET webhook push
- EMQX webhook push

## Recommended EMQX topic convention

- `trtnova/{productId}/{deviceName}/telemetry`
- `trtnova/{productId}/{deviceName}/status`
- `trtnova/{productId}/{deviceName}/cmd`

Example:

- `trtnova/p001/device-001/telemetry`
- `trtnova/p001/device-001/cmd`

## Files

- `index.js`: SCF entry file
- `.env.example`: environment variable template
- `package.json`: deploy-time dependencies

## Deploy

1. Run `npm install` in this folder
2. Fill the SCF environment variables in Tencent Cloud console
3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`

## Environment variables

- `ONE_NET_TOKEN`: required for OneNET webhook verification
- `ONE_NET_AES_KEY`: optional OneNET payload decryption key
- `EMQX_WEBHOOK_TOKEN`: optional shared token for EMQX webhook protection
- `EMQX_PRODUCT_ID`: optional product id used when EMQX payload does not provide one
- `REDIS_ENABLED`: optional runtime cache switch
- `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT`: optional Redis connection
- `REDIS_PASSWORD`: optional Redis password
- `REDIS_KEY_PREFIX`: optional key prefix, default `trt:nova`
- `REDIS_DEVICE_LATEST_TTL_SEC`: TTL for latest snapshot cache
- `REDIS_DEVICE_ONLINE_TTL_SEC`: TTL for online state cache
- `REDIS_COMMAND_STATE_TTL_SEC`: TTL for command runtime state cache
- `REDIS_MESSAGE_DEDUP_TTL_SEC`: TTL for short-term dedup marks

## Control flow

This service only handles ingest.
For device control, the app should call the backend, and the backend should publish commands to EMQX.

If Redis is configured, ingest will also write:

- latest device snapshot cache
- online state cache
- command state progression on ACK / done
- short-term message dedup marks

## Runtime-service proxy switches

- `INGEST_SCF_RUNTIME_PROXY_ENABLED`
- `RUNTIME_SERVICE_BASE_URL`
- `INGEST_SCF_RUNTIME_PROXY_TIMEOUT_MS`
- `INGEST_SCF_RUNTIME_PROXY_FALLBACK_LOCAL`

Recommended rollout:

1. keep proxy disabled by default
2. enable in dev / test first
3. compare runtime-service latest/command reconciliation results with current SCF path
4. keep local fallback enabled during early trial rollout
