# Current architecture and integration contract

## 1. Project goal

This project is a plant-pet MVP based on:

- WeChat Mini Program cloud development
- OneNET
- Tencent Cloud SCF webhook
- Mini program cloud database + cloudfunctions

Target architecture:

**device / fake signal -> OneNET -> SCF webhook -> mini program cloud database -> mini program**

The mini program is not responsible for talking to OneNET directly.

## 2. Responsibility split

### 2.1 OneNET + SCF webhook chain

SCF webhook is the bridge between OneNET and mini program data side.

SCF webhook is responsible for:

- OneNET GET verification
- OneNET POST reception
- parsing outer body + `msg`
- extracting `productId`, `deviceName`, `params`
- normalizing to:
  - `latestRecord`
  - `historyRecords`

SCF webhook is not responsible for:

- mini program user permission decision
- deciding which user can view which device

### 2.2 Mini program cloudfunctions

Mini program cloudfunctions are responsible for app-side business logic, for example:

- bind device by physical device code (`bindDevice`)
- register physical-code to logical-device mapping (`registerDevice`, developer-only flow)
- read bound device data (`getDeviceData`)
- app login context (`login`)

They are not the OneNET ingress replacement.

### 2.3 Mini program frontend

Mini program frontend is responsible for UI and cloudfunction calls only.

It must not:

- call OneNET directly
- keep OneNET secrets in frontend code

Binding UX rule:

- user-facing page only accepts `physicalCode`
- `productId/deviceName` are maintained in developer internal flow

## 3. Device identity and collections

Current logical device key:

- `(productId + deviceName)`

Current target collections:

- `users`
- `devices`
- `device_acl`
- `device_latest`
- `device_data`

Compatibility note:

- `user_profiles` is deprecated legacy collection.
- runtime code paths now read/write `users` only.

## 4. env strategy

- `app.js` reads optional explicit env from `envList.js`
- if empty, `wx.cloud.init` uses default mini program cloud environment
- all cloudfunctions use `cloud.DYNAMIC_CURRENT_ENV`

This avoids coupling runtime to an envId that may be unavailable via CloudBase CLI.

## 5. Reference file status

`reference/onenetWebhook.example.js` is a reference implementation snapshot for collaboration.

- It does not run in mini program runtime.
- It reflects SCF webhook logic and data contract.
- Actual deployed SCF source may be outside this repo.
