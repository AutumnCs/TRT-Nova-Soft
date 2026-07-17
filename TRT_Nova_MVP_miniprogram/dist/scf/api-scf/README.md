# api-scf

Mini program API -> MySQL

## Files

- `index.js`: SCF entry file
- `.env.example`: environment variable template
- `package.json`: deploy-time dependencies

## Deploy

1. Run `npm install` in this folder
2. Fill the SCF environment variables in Tencent Cloud console
3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`

## Runtime notes

- This service is still MySQL-first for facts and ACL checks.
- Redis is optional. If configured, it is used as a runtime state layer for:
  - latest device snapshot
  - device online state
  - command processing / latest command state
- If Redis is unavailable, the main API flow should still continue.

## Redis variables

- `REDIS_ENABLED`
- `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_KEY_PREFIX`
- `REDIS_DEVICE_LATEST_TTL_SEC`
- `REDIS_DEVICE_ONLINE_TTL_SEC`
- `REDIS_COMMAND_STATE_TTL_SEC`

## Runtime-service proxy switches

- `API_SCF_RUNTIME_PROXY_ENABLED`
- `RUNTIME_SERVICE_BASE_URL`
- `API_SCF_RUNTIME_PROXY_TIMEOUT_MS`
- `API_SCF_RUNTIME_PROXY_ROUTES`

Recommended first rollout:

1. keep proxy disabled by default
2. enable `/device/latest` first
3. then enable `/device/cmd`
4. then enable `/device/commands`
5. then enable `/device/command/detail`
6. keep SCF local fallback path available while validating the resident runtime service
