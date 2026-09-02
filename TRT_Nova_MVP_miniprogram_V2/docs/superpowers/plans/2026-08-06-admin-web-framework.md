# Admin Web Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the static admin console into a lightweight modular shell and deliver a production-usable knowledge management module against the existing admin-scf API.

**Architecture:** Keep browser-native ES modules and CSS for this first slice. Add focused shared helpers for escaping, state shaping, and API operations; keep page modules responsible for DOM rendering and events. Preserve the existing `admin-scf` routes and token semantics.

**Tech Stack:** Browser ES modules, Fetch API, Node `node:test`, plain CSS, existing SCF admin API.

## Global Constraints

- Do not change admin authentication, authorization, database schema, or SCF routes.
- `admin-web/` is the UI control-plane boundary; JSON seed content remains backend fallback only.
- Escape article text before inserting it into HTML.
- Run `node --check` on changed JavaScript and focused `node --test` suites.

---

### Task 1: Shared knowledge state and API contract

**Files:**
- Create: `admin-web/lib/knowledge-state.js`
- Modify: `admin-web/lib/api.js`
- Create: `admin-web/test/knowledge-state.test.js`

**Interfaces:**
- `filterKnowledgeArticles(articles, query)` returns matching articles by title, slug, summary, category, and tags.
- `createAdminApi().listKnowledgeArticles()`, `.saveKnowledgeArticle(article)`, and `.deleteKnowledgeArticle(idOrSlug)` return parsed API payloads.

- [ ] **Step 1: Write failing tests** for search matching, empty queries, and API method request paths/body.
- [ ] **Step 2: Run `node --test admin-web/test/knowledge-state.test.js` and confirm failure because helpers/API methods are absent.
- [ ] **Step 3: Implement the minimal pure filter and API methods using the existing `request` closure.
- [ ] **Step 4: Run the focused test and confirm it passes.
- [ ] **Step 5: Run `node --check admin-web/lib/api.js` and `node --check admin-web/lib/knowledge-state.js`.

### Task 2: Knowledge module list and editor

**Files:**
- Create: `admin-web/pages/knowledge.js`
- Modify: `admin-web/main.js`
- Modify: `admin-web/styles.css`
- Create: `admin-web/test/knowledge-page.test.js`

**Interfaces:**
- `renderKnowledgePage(container, api)` loads articles and renders search, list, create, edit, status, and delete controls.
- The module calls only `listKnowledgeArticles`, `saveKnowledgeArticle`, and `deleteKnowledgeArticle` from the API object.

- [ ] **Step 1: Write failing tests** for rendering a loaded article, filtering by search text, and normalizing editor values for draft/published saves.
- [ ] **Step 2: Run `node --test admin-web/test/knowledge-page.test.js` and confirm the expected missing-module failure.
- [ ] **Step 3: Implement a focused knowledge page with loading, empty, error, and mutation feedback states; use a form surface for create/edit and confirm delete.
- [ ] **Step 4: Wire the `knowledge` nav item in `main.js` and make page rendering async-safe.
- [ ] **Step 5: Add responsive table/form styles consistent with the current shell.
- [ ] **Step 6: Run focused tests and `node --check` on changed files.

### Task 3: Modular shell cleanup and regression checks

**Files:**
- Modify: `admin-web/main.js`
- Modify: `admin-web/index.html`
- Modify: `admin-web/lib/nav.js`
- Modify: `admin-web/test/nav.test.js`

**Interfaces:**
- Navigation remains the single source for module IDs and labels.
- `main.js` mounts the selected module without changing login/session behavior.

- [ ] **Step 1: Write a failing navigation test** asserting the knowledge module has a stable page mount and the shell exposes a status region.
- [ ] **Step 2: Run the navigation test and confirm failure.
- [ ] **Step 3: Add the smallest shell markup and active-module behavior needed by the knowledge module.
- [ ] **Step 4: Run all `admin-web/test/*.test.js` tests.
- [ ] **Step 5: Preview `admin-web/index.html` in a browser and verify desktop/mobile layout, login gating, article search, editor, status toggle, and delete confirmation.

### Task 4: Verification and handoff

**Files:**
- No new production files.

- [ ] **Step 1: Run `node --check` on every changed JavaScript file.
- [ ] **Step 2: Run `node --test admin-web/test/*.test.js`.
- [ ] **Step 3: Confirm no admin-scf files were changed and no seed JSON was imported by the browser UI.
- [ ] **Step 4: Record any preview limitation and provide file references in the handoff.
