# TRT Nova Admin Console Design

## Goal

Design a lightweight but product-oriented admin console for the TRT Nova plant-care system so the team can manage knowledge articles, devices, users, and operational logs without editing seed JSON or touching platform-level device infrastructure directly.

## Recommended Structure

```text
TRT_Nova_MVP_miniprogram_LastScf/
|-- admin-web/
|-- dist/scf/admin-scf/
|-- services/modules/
|-- docs/
`-- data/knowledge/articles.json
```

Responsibilities are deliberately separated:

- `admin-web/` owns the management UI only.
- `dist/scf/admin-scf/` owns admin-only HTTP APIs, validation, persistence, and audit logging.
- `services/modules/` owns shared business logic that the mini program, admin console, and SCF entry points can reuse.
- `docs/` owns the design, field definitions, and operational rules.
- `data/knowledge/articles.json` remains seed and fallback content, not the long-term editor.

The admin console must live in the same repository for now, but in its own directory so it is easy for both humans and agents to identify the control plane separately from the user-facing mini program.

## Product Boundary

The admin console is the TRT Nova control plane, not a second product.

It manages:

- knowledge articles and their metadata
- devices and device-plant/user relationships
- users and roles
- logs, audits, and operational visibility

It does not replace:

- the mini program user experience
- OneNET / EMQX device connectivity
- SCF as the execution layer
- MySQL as the business source of truth

## Architecture

### Frontend

`admin-web/` should be a static Web console deployed to static site hosting. It should be able to evolve frequently without requiring a server runtime. The frontend talks only to admin APIs.

### API Layer

`dist/scf/admin-scf/` should expose admin-only endpoints for login, overview, knowledge CRUD, device views, user views, and logs. It should be thin at the edge and delegate reusable logic into `services/modules/*` where possible.

### Data Layer

- MySQL stores the authoritative admin-managed data.
- Redis stores short-lived state, cache, and rate-limiting or session data when needed.
- COS stores images, attachments, exports, and other non-structured assets.

### Device Platform Layer

OneNET / EMQX continue to own device connectivity, MQTT/message transport, and platform-level delivery concerns. The admin console consumes the business interpretation of those signals, not the raw transport model.

## First Release Scope

The first release should be intentionally small and operationally useful.

### 1. Overview

Show:

- total device count
- online device count
- abnormal device count
- user count
- bound device count
- article count
- draft count
- published article count
- recent commands
- recent alerts
- recent admin actions

### 2. Knowledge Management

Support:

- article list
- create / edit / delete
- category, tag, plant type, and problem type editing
- publish / unpublish
- ordering
- import / export

This is the first module to build because it removes the manual JSON-editing workflow immediately.

### 3. Device Management

Support:

- device list
- device detail
- binding relationships
- recent status
- recent commands
- alerts

This module turns raw platform-level device facts into product-facing operational data.

### 4. User Management

Support:

- user list
- user detail
- bound devices
- basic roles

Keep this minimal in the first release.

### 5. Logs and Audit

Support:

- admin action logs
- command logs
- error logs
- data mutation logs

This should exist early enough to support debugging and trust.

## Data Model Direction

The exact schema can evolve, but the first version should be organized around these conceptual groups:

- `knowledge_articles`
- `knowledge_categories`
- `knowledge_tags`
- `knowledge_plant_types`
- `knowledge_problem_types`
- `devices`
- `device_bindings`
- `device_commands`
- `device_status_history`
- `device_alerts`
- `users`
- `user_roles`
- `user_devices`
- `admin_action_logs`
- `system_logs`

Seed content continues to originate from `data/knowledge/articles.json`, but the runtime source becomes MySQL once imported.

## Routing and Deployment

Recommended deployment shape:

- `admin-web/` -> static site hosting
- `dist/scf/admin-scf/` -> SCF HTTP APIs
- MySQL -> primary database
- Redis -> cache/session layer when needed
- COS -> media and exports

Lighthouse is not required for the first version of the admin console. Reserve Lighthouse for truly long-running services that need a persistent process or self-managed runtime environment.

## Interface Contracts

The first API surface should be narrow and intentionally boring:

- `POST /admin/auth/login`
- `GET /admin/overview`
- `GET /admin/knowledge/articles`
- `POST /admin/knowledge/articles`
- `PUT /admin/knowledge/articles/:id`
- `DELETE /admin/knowledge/articles/:id`
- `GET /admin/devices`
- `GET /admin/devices/:id`
- `GET /admin/users`
- `GET /admin/users/:id`
- `GET /admin/logs`

Follow-up endpoints can be added later for categories, tags, import/export, audit detail, and richer role management.

## Error Handling

- Fail closed on admin auth and permission checks.
- Prefer explicit validation errors over silent fallback behavior.
- Keep transport errors and business validation errors separate.
- Log admin changes and device-command mutations for traceability.
- If a data source is unavailable, degrade read paths with cached or seed fallback only when the request is non-destructive.

## Testing

The first version should be verified in layers:

- static UI build or preview succeeds
- SCF admin API routes parse and validate requests correctly
- article CRUD works against a test or local database
- fallback knowledge content still loads when the runtime source is unavailable
- admin actions are logged
- the context checker still recognizes the new `admin-web/` and `dist/scf/admin-scf/` boundaries after the skill update

## Skill Update Requirement

The project skill must be updated so future agents treat the admin console as a formal part of the repository, with its own directory boundaries and control-plane responsibilities.

The skill update must explicitly state:

- the admin console belongs in this repository as a separate control plane
- default scope includes `admin-web/` and `dist/scf/admin-scf/`
- the admin console manages business data, not transport infrastructure
- OneNET / EMQX remain the device connectivity layer
- `data/knowledge/articles.json` remains seed/fallback content

## Initial Scope

The first implementation pass should build the admin console skeleton and the knowledge-management flow first. Device, user, and audit views can follow immediately after the knowledge flow is stable.

The design intentionally avoids turning the admin console into a separate server product. It should remain a static web console backed by SCF APIs and shared data services.
