# IoT Provider Compatibility Guide

This project can work with both OneNET and EMQX.
The backend should expose one unified application contract to the frontend.
The providers are only ingestion / publishing adapters.

## What the backend must understand

The backend only needs to reliably know:

1. Which device produced the message
2. When the message was reported
3. What the raw payload was
4. Which normalized sensor / status fields can be extracted

Everything else is implementation detail.

## Unified device identity

The backend should normalize both providers into the same internal device key:

```text
logicalKey = `${productId}::${deviceName}`
```

The backend may also store:

- `provider`
- `productId`
- `deviceName`
- `clientid`
- `username`
- `topic`
- `reportedAt`
- `rawPayload`

## Required normalized fields

The backend should be able to ingest and expose these normalized fields:

- `soil_percent`
- `dht_temp`
- `dht_humi`
- `light_val`
- `ir_status`
- `run_state`
- `uid`
- `is_dead`
- `soul_state`
- `favorability`
- `plant_personality`
- `plant_type`

These are the fields the frontend can already use.
The provider can send them in any shape as long as the backend can normalize them.

## Current backend shape

### Ingest

`dist/scf/ingest-scf` already normalizes both providers into the same MySQL tables:

- `device_latest`
- `device_history_raw`
- `device_history_agg`

It also stores provider metadata in `device_latest.push_meta_json`.

### Application API

`dist/scf/api-scf` already serves the frontend with unified data models:

- device list
- device detail
- latest state
- history trend
- binding / unbinding
- plant library
- journal
- todos

The frontend does not need to know whether the source was OneNET or EMQX.

## EMQX minimum contract

EMQX only needs to provide enough metadata for the backend to identify the device.
The recommended minimum is:

- `clientid`
- `username`
- `topic`
- `timestamp`
- `payload`

If available, also provide:

- `client_attrs.productId`
- `client_attrs.deviceName`
- `client_attrs.logicalKey`

If these are present, the backend can map EMQX data to the same logical device model as OneNET.

## OneNET minimum contract

OneNET messages are already normalized by the ingest layer.
The backend extracts:

- `productId`
- `deviceName`
- `params`
- `notifyType`
- `messageType`
- `dataId`

Then it converts them into the same unified device tables.

## What is already covered well

The current backend is already good at:

- ingesting telemetry from both providers
- updating latest state
- storing raw history
- building aggregated history
- binding devices to users
- exposing a consistent frontend API
- storing plant library and journal records

## EMQX control parity

The backend has a unified command entry point in `api-scf`, and the command path now branches by provider:

- **OneNET**: call the existing OneNET property/service interface
- **EMQX**: publish a command message to an MQTT topic that the device subscribes to

Current repository state:

- **data ingest**: already compatible
- **frontend read APIs**: already compatible
- **device command downlink**: provider-specific OneNET and EMQX adapters are implemented behind the same API surface

EMQX downlink still requires deployment-time publish credentials, endpoint and topic-template configuration. Repository implementation alone does not prove that the live EMQX path has been deployed or verified with a real device.

## Recommended backend contract for EMQX

When EMQX pushes data to the backend, the backend should be able to build this normalized shape:

```json
{
  "provider": "emqx",
  "logicalKey": "p001::J",
  "productId": "p001",
  "deviceName": "J",
  "clientid": "p001.J",
  "username": "device_user",
  "topic": "plant/telemetry",
  "reportedAt": 1716640000000,
  "params": {
    "soil_percent": 42,
    "dht_temp": 24.3,
    "dht_humi": 58,
    "light_val": 1260,
    "ir_status": true,
    "run_state": true,
    "uid": "A1B2C3D4",
    "is_dead": false,
    "favorability": 78,
    "plant_personality": "温和型",
    "plant_type": "龟背竹"
  },
  "rawPayload": {}
}
```

## Backend capability assessment

### Yes, the current backend can already handle:

- EMQX telemetry ingestion
- EMQX / OneNET unified storage
- frontend reads from the same output APIs
- plant journal records
- todos linked to devices
- device binding and ACL checks

### Deployment work still required for EMQX downlink:

- configure EMQX publish credentials / endpoint and choose the command topic template

Without that configuration, monitoring and frontend display can still use normalized telemetry, but the deployed environment cannot execute EMQX downlink control.

## Practical recommendation

If you want the least risky path:

1. Keep the current unified ingest logic
2. Let EMQX provide `clientid` / `username` / `topic` / `payload`
3. Prefer `client_attrs` for `productId / deviceName / logicalKey`
4. Continue using the same MySQL tables
5. Use the same `/device/cmd` API for both providers
6. Let the backend choose the OneNET or EMQX adapter from the device/provider context

That is enough for the frontend to work normally.
