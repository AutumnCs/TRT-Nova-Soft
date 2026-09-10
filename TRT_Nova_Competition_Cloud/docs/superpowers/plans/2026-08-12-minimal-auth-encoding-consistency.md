# Minimal Auth And Encoding Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair known Chinese mojibake, make Agent legacy identity fallback opt-in, and keep the local phone experience behind a default-off development flag while correcting current-status documentation.

**Architecture:** Reuse the existing small helper boundaries: identity resolution remains in `agent-scf/lib/auth.js`, phone-entry policy moves to a page-adjacent pure helper, and encoding validation extends the existing AI-context checker. Production JWT and device action flows remain unchanged.

**Tech Stack:** Node.js CommonJS/ESM, WeChat Mini Program JavaScript/WXML, Node built-in test runner, Markdown.

## Global Constraints

- Do not modify existing unrelated UI work in `pages/index`, `custom-tab-bar`, or `design-system`.
- Do not add a formal phone authentication flow, delete command compatibility code, or migrate frameworks.
- Keep production legacy openid fallback disabled by default.
- Use UTF-8 without BOM for edited source and documentation.

---

### Task 1: Agent legacy identity fallback

**Files:**
- Modify: `dist/scf/agent-scf/lib/auth.js`
- Create: `dist/scf/agent-scf/test/auth.test.js`
- Modify: `dist/scf/agent-scf/.env.example`

**Interfaces:**
- Consumes: SCF request headers/body, `JWT_SECRET`, `ALLOW_LEGACY_OPENID_FALLBACK`, `DEBUG_OPENID`.
- Produces: `resolveOpenid(event, body, options?)`, returning authenticated openid or throwing an authentication error.

- [ ] Write tests proving valid JWT succeeds, legacy openid fails by default, and explicit fallback succeeds.
- [ ] Run `node --test dist/scf/agent-scf/test/auth.test.js` and verify the new default-denial case fails.
- [ ] Implement the smallest explicit fallback gate and document its environment variables with placeholders.
- [ ] Run the focused Agent authentication test and `node --check`.

### Task 2: Default-off local phone experience

**Files:**
- Create: `pages/auth/auth-state.js`
- Create: `pages/auth/auth-state.test.js`
- Modify: `pages/auth/auth.js`
- Modify: `pages/auth/auth.wxml`
- Modify: `services/config/runtime.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: `runtimeConfig.enableDevPhoneLogin`.
- Produces: `isDevPhoneLoginEnabled(runtimeConfig)` and guarded page state/handlers.

- [ ] Write tests proving the helper defaults to false and only accepts explicit boolean `true`.
- [ ] Run `node --test pages/auth/auth-state.test.js` and verify it fails because the helper does not exist.
- [ ] Add the pure helper, runtime default, page state, conditional rendering, and handler guards.
- [ ] Run the focused test and `node --check` on changed JavaScript.

### Task 3: Mojibake repair and regression guard

**Files:**
- Modify: `services/modules/DeviceService.js`
- Modify: `dist/scf/api-scf/lib/device-command.js`
- Modify: `scripts/check-ai-context.mjs`
- Modify: `scripts/check-ai-context.test.mjs`

**Interfaces:**
- Consumes: project files in the active repository boundary.
- Produces: AI-context errors identifying likely mojibake with relative file paths.

- [ ] Add a failing checker test containing a known mojibake sequence.
- [ ] Run `node --test scripts/check-ai-context.test.mjs` and verify the test fails for the missing check.
- [ ] Add the smallest scoped scanner and repair the seven known strings.
- [ ] Run the checker tests, `node scripts/check-ai-context.mjs`, and a direct UTF-8 readback search.

### Task 4: Current documentation alignment

**Files:**
- Modify: `docs/current-system-status-and-improvement-plan.md`
- Modify: `docs/scf-deploy-packages.md`
- Modify: `docs/ai-project-map.md`

**Interfaces:**
- Consumes: verified implementation state from Tasks 1-3.
- Produces: current documentation that distinguishes completed safeguards, compatibility switches, development-only phone entry, and remaining risks.

- [ ] Update only statements made stale by the verified implementation.
- [ ] Read back edited Chinese using Node UTF-8.
- [ ] Run `node scripts/check-ai-context.mjs` and `git diff --check`.

### Task 5: Final verification

**Files:**
- Verify all files modified by Tasks 1-4.

**Interfaces:**
- Consumes: completed implementation and tests.
- Produces: fresh syntax, test, context, encoding, and diff evidence.

- [ ] Run focused `node --test` commands for Agent auth, auth state, command parsing, and AI-context checks.
- [ ] Run `node --check` on every changed JavaScript file.
- [ ] Run `node scripts/check-ai-context.mjs`.
- [ ] Run the scoped mojibake scan and `git diff --check`.
- [ ] Inspect `git diff` to confirm no unrelated user changes are included.
