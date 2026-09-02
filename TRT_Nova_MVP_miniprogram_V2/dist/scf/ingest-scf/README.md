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

## Control flow

This service only handles ingest.
For device control, the app should call the backend, and the backend should publish commands to EMQX.
