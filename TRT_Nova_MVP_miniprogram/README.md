## Current architecture

This project is a WeChat Mini Program MVP for a plant-pet smart hardware product.

Current data path:

**device / fake signal -> OneNET -> Tencent Cloud SCF webhook -> mini program cloud database -> mini program**

## Runtime roles

- SCF webhook (outside mini program cloudfunctions)
  - bridge between OneNET and mini program data layer
  - handles OneNET GET verification + POST push
  - parses `msg` and normalizes to `latestRecord` + `historyRecords`
- Mini program cloudfunctions
  - handle app-side auth/binding/query logic
  - do not replace SCF webhook as OneNET ingress
- Mini program frontend
  - does not call OneNET directly

## Collection model

Current canonical collections for device domain:

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_data`

`user_profiles` is now treated as deprecated legacy collection and is no longer referenced in code paths.

## envId strategy

This repository now uses a safer env initialization strategy:

- `app.js` reads optional explicit env from `envList.js`
- if `envList` is empty, `wx.cloud.init` uses mini program default cloud environment
- cloudfunctions keep `cloud.DYNAMIC_CURRENT_ENV`

This avoids hard-coding an env that may not be visible in CloudBase CLI (`tcb`) while still supporting explicit override when needed.

## Reference vs deployed webhook

`reference/onenetWebhook.example.js` is a reference mirror of your SCF webhook logic for collaboration only.

- It is not executed by mini program runtime.
- Effective mini program-side logic is in `cloudfunctions/*`.
- Actual deployed SCF source of truth may live outside this repository.

## Semi-automatic device registration (recommended)

To avoid manually inserting `devices` records in console, use cloudfunction `registerDevice`.

Input:

- `physicalCode` (required, user-facing device code)
- `productId` (required)
- `deviceName` (required)
- `externalDeviceId` (optional)
- `status` (optional, default `active`)
- `adminKey` (optional; required only if function env `DEVICE_REG_ADMIN_KEY` is set)

Behavior:

- upsert mapping by `physicalCode` and `logicalKey = productId::deviceName`
- writes to mini program cloud database collection `devices`
- `bindDevice` and webhook pre-registration checks can use this record directly

Example (mini program / console callFunction):

```js
wx.cloud.callFunction({
  name: 'registerDevice',
  data: {
    physicalCode: 'TRT-DEV-0001',
    productId: 'Aruv1l24Y6',
    deviceName: 'httptest',
    externalDeviceId: 'onenet-device-id',
    adminKey: 'your-admin-key-if-enabled'
  }
})
```
