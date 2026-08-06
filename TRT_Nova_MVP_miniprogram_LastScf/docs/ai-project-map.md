# AI Project Map

> Purpose: give an AI agent a compact, reliable map of this repository so it can find the right source of truth quickly.

## 1. What This Repo Is

This repository is a plant-care mini program with:
- a WeChat Mini Program front end
- multiple SCF backends
- MySQL as the main business datastore
- OneNET / EMQX as device ingress and command delivery infrastructure
- Redis tracked as a future infrastructure layer in the architecture docs when scale or coordination needs justify it

The current production-style flow is:
- Device telemetry -> `ingest-scf` -> MySQL
- Mini program auth -> `auth-scf` -> JWT
- Mini program API -> `api-scf` -> MySQL / OneNET
- Admin console -> `admin-scf` -> MySQL / operational data

## 2. Read This First

If you only read a few files, read these in order:
- [`docs/current-architecture.md`](./current-architecture.md)
- [`docs/current-system-status-and-improvement-plan.md`](./current-system-status-and-improvement-plan.md)
- [`docs/scf-deploy-packages.md`](./scf-deploy-packages.md)
- [`app.js`](../app.js)
- [`services/config/runtime.js`](../services/config/runtime.js)
- [`dist/scf/api-scf/index.js`](../dist/scf/api-scf/index.js)
- [`services/core/ScfApiAdapter.js`](../services/core/ScfApiAdapter.js)

## 3. Source of Truth Map

### Front end

- `pages/index/index.js`
- `pages/index/index-state.js`
- `pages/device/device.js`
- `pages/wiki/wiki.js`
- `pages/assistant/assistant.js`

These files own page behavior and UI state. Prefer extracting helper logic into a focused `*-state.js` or module before adding more page logic.

### SCF backends

- `dist/scf/auth-scf/index.js`
- `dist/scf/api-scf/index.js`
- `dist/scf/ingest-scf/index.js`
- `dist/scf/agent-scf/index.js`
- `dist/scf/history-cleanup-scf/index.js`
- `dist/scf/admin-scf/index.js`

These are the deployable backend entry points. Treat them as the authoritative SCF sources for this repo.

### Admin control plane

- `admin-web/`
- `dist/scf/admin-scf/index.js`

Treat the admin console as a first-class control plane boundary in this repo. `admin-web/` owns the management UI, and `dist/scf/admin-scf/` owns admin-only APIs, validation, persistence, and audit-oriented control-plane behavior.

### Shared services

- `services/core/ScfApiAdapter.js`
- `services/modules/AuthService.js`
- `services/modules/DeviceService.js`
- `services/modules/KnowledgeService.js`
- `services/modules/PlantService.js`
- `services/modules/TodoService.js`
- `services/modules/AlertService.js`

These modules are the shared bridge between the mini program and SCF APIs. Keep these small and explicit.

### Knowledge content

- Canonical seed content: `data/knowledge/articles.json`
- Deployment copy: `dist/scf/api-scf/data/knowledge/articles.json`
- Agent-side copy: `dist/scf/agent-scf/data/knowledge/articles.json`

The app should treat the JSON seed as fallback content, not as the long-term primary storage.

## 4. Functional Boundaries

### Identity

Identity is a strict chain:
- WeChat login
- SCF auth
- JWT token

Do not reintroduce openid fallback flows unless they are explicitly marked legacy and gated.

### Device control

Control requests must go through the API backend:
- mini program -> `api-scf /device/cmd`
- backend validates ACL and command schema
- backend publishes to the device transport

The front end should only send logical actions like `fan.on` or `fan.off`, not arbitrary device payloads.

### Admin console

The admin console is the TRT Nova control plane, not a second product.

- `admin-web/` is the management UI boundary
- `dist/scf/admin-scf/` is the admin API boundary
- admin flows manage business data and operational views, not device transport infrastructure
- OneNET / EMQX remain the transport and connectivity layer

### Knowledge

Knowledge content should be searchable and reusable by both the wiki page and the agent backend.

Long-term, the actual article body belongs in MySQL. The JSON files are seed and fallback only.

## 5. File-Sizing Rules

If a file starts to do too many jobs, split it early:
- page UI state + data shaping -> extract to `*-state.js`
- API request wiring -> keep in `services/core/ScfApiAdapter.js`
- domain logic -> keep in `services/modules/*`
- backend route handlers -> keep in `dist/scf/*/index.js` until a real split is justified

Good split candidates are files that:
- mix transport and domain rules
- contain repeated transforms
- are hard to test without loading the whole page or SCF entry file

## 6. What Not To Assume

- `dist/` is not disposable build trash in this repo; it contains the SCF deployment source currently used by the project.
- A string in the UI is not always a presentation-only concern; some values are normalized by shared helpers first.
- A fallback that makes the UI look “not broken” is not necessarily the right production source of truth.
- A successful command dispatch does not mean the device executed it; command acknowledgment and device state are separate.

## 7. Minimal Mental Model For AI Work

When changing something, answer these questions first:
- What layer owns this behavior?
- What is the source of truth?
- What is the fallback?
- What is the verification step?

If you cannot answer those four questions, the change is probably too broad and should be split.
