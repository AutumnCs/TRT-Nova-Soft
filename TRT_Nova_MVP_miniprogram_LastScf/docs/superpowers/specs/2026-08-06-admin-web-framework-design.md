# TRT Nova Admin Web Framework Design

## Goal

Evolve `admin-web` into a lightweight, modular management console that can grow from knowledge management to device, user, and log operations without changing the existing `admin-scf` API boundary.

## Context

The current console is a static ES-module application with page render functions and a shared API adapter. The backend already exposes authenticated admin endpoints, including knowledge article CRUD. The repository treats `admin-web/` as the UI control-plane boundary and `dist/scf/admin-scf/` as the API boundary.

## Decision

Keep the current browser-native implementation for the first phase. Introduce explicit application-shell, shared UI, module, and service boundaries inside `admin-web/`. Use Tabler as visual inspiration only; do not copy a full template or migrate to Vue/Vben/React at this stage. Revisit Vue 3 + Vite + TypeScript only after the console has several real modules and repeated UI complexity proves the need.

## Structure

```text
admin-web/
├─ app-shell/       navigation, page mounting, session shell
├─ shared/          escaped rendering, status labels, table/form primitives
├─ modules/         knowledge, devices, users, logs page modules
├─ services/        admin-scf API client and domain adapters
└─ test/            focused helper and module tests
```

The existing files may be moved or wrapped incrementally; no broad rewrite is required. The first implementation slice creates the shared API/module seams and delivers the knowledge module through them.

## User flows

- A signed-in administrator opens a module from the left navigation.
- List modules use a consistent header, filter/search controls, table, loading state, empty state, and error state.
- Mutating actions use an explicit confirmation or editor surface and show success/failure feedback.
- Knowledge articles support list, client-side search over loaded article fields, create, edit, draft/published state changes, and delete through existing admin-scf routes.
- The API client remains the only browser code that knows URL paths and authentication headers.

## API contract

Use the existing routes without backend changes:

- `GET /knowledge/articles`
- `GET /knowledge/article` with `idOrSlug` in the existing request shape when needed
- `POST /knowledge/articles` for create/update, including `status: 'draft' | 'published'`
- `DELETE /knowledge/articles` with `idOrSlug`

JSON seed data remains a backend fallback only; the UI must not import it as a primary source.

## Error handling and safety

- Preserve current token handling and clear the token on HTTP 401.
- Render network failures in the page rather than silently replacing live data with seed data.
- Disable submit controls during mutations to prevent duplicate writes.
- Confirm deletion and report when an article cannot be found.
- Escape article text before inserting it into HTML.

## Verification

- Add focused Node tests for API request shaping and knowledge list/editor state helpers.
- Run `node --check` on changed JavaScript files.
- Run the focused `node --test` suites.
- Preview the static page for the user-visible shell and knowledge UI changes.

## Out of scope

- Replacing the build system.
- Migrating to Vue, React, Vben, Refine, or a full Tabler distribution.
- Changing admin authentication, authorization semantics, database schema, or SCF routes.
- Implementing dynamic low-code permissions or a general schema-driven CRUD generator.
