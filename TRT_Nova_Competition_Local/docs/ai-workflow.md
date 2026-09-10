# AI Workflow

> Purpose: keep human + AI collaboration predictable in this repo.

## 1. Working Rules

- Read the relevant part of [`docs/ai-project-map.md`](./ai-project-map.md) when ownership is missing or has changed; reuse reliable context already available.
- Prefer the smallest file that owns the behavior
- Do not change unrelated subsystems while you are here
- Favor extraction over adding more logic to a large file
- Keep deployable backend source and app source aligned with the current architecture docs
- Prefer UTF-8 without BOM for repo docs and source files, avoid paste-induced mojibake, and read back any Chinese text edits in the same toolchain before finishing

### Default Scope

Unless the user explicitly asks for them, treat exploratory or archived directories such as `emotional_chat_fullsrc/`, `flutter_app/`, and `i18n/` as out of scope. Do not read them during normal repo orientation, and do not let them drive the default source-of-truth map.

## 2. Before Changing Code

Answer these in order:
1. What exact behavior is changing?
2. Which layer owns it?
3. What is the source of truth?
4. What is the fallback?
5. What test or check will prove the change is correct?

For a regression that the old project or accepted baseline did not have, first compare the old and current paths and record one of three causes:

- inherited debt that was already present but previously hidden
- an integration regression caused by our modifications
- a defect introduced together with a new feature

Start from the known-good owner/path/contract and make the smallest compatible correction. Reuse the old behavior only when it still satisfies the current product, local/online, and verification boundaries; do not copy an old workaround merely because it previously avoided a visible error.

Resolve missing implementation facts through targeted inspection before editing. Ask the user only for a remaining substantive choice or an authorization gap; continue independent work while waiting.

### Local compromise register

When local implementation replaces an intended cloud path, update [`localization-compromise-register.md`](./localization-compromise-register.md) before asking for phase acceptance. Record the current substitute, reason, owner, cloud restore action and verification gate. Every phase report must say what changed in the register, including an explicit “none” when there was no new compromise. Cloud/experience acceptance is blocked until every open restore item is either verified closed or explicitly approved as an exception by the user/final technical decision maker.

### Material feature change disclosure

After implementation, explicitly disclose every material deletion, addition, replacement, or reorganization of an existing feature, entry point, or user flow. Before asking for phase acceptance, compare the accepted baseline and state:

- what existing behavior or entry was retained;
- what was removed or made non-default;
- what was added;
- what was substantially reorganized, including UI placement and interaction changes.

The code diff is not a substitute for this disclosure, and the user must not be expected to discover a major change during acceptance. Keep a durable audit in [`material-feature-change-disclosure.md`](./material-feature-change-disclosure.md) when a phase contains multiple material changes.

## 3. Standard File Targets

### Front end

Use these patterns:
- page behavior lives in `pages/<name>/<name>.js`
- page state shaping can move into `pages/<name>/<name>-state.js`
- page tests should sit next to the helper module

Typical front-end verification:
- `node --check` for syntax
- targeted `node --test` for helper logic
- manual preview for visual changes

### SCF backends

Use these patterns:
- route and handler entry points live in `dist/scf/*/index.js`
- request normalization and command parsing should move into small helpers under `dist/scf/*/lib/`
- knowledge content should be treated as a data concern, not page logic

Typical backend verification:
- `node --check` on the changed entry file
- focused `node --test` for the helper logic
- a live request if the route is externally observable

### Admin control plane

Use these patterns:
- `admin-web/` owns the admin console UI only
- `dist/scf/admin-scf/` owns admin-only HTTP APIs, validation, persistence, and audit logging
- shared business logic that must serve both the mini program and admin console should stay in `services/modules/*`

Keep the boundary crisp:
- the admin console is the TRT Nova control plane, not a second product
- admin flows manage business data and operational views, not OneNET / EMQX transport infrastructure
- device commands still stay action-based and flow through validated backend paths

### Shared services

Use these patterns:
- `services/core/*` for transport adapters and runtime bridges
- `services/modules/*` for domain logic
- `services/config/*` for shared constants and thresholds

Keep service methods explicit:
- a method should do one job
- the input shape should be obvious from the name
- if a method starts accepting too many ad hoc payloads, split it

For journal or image changes:
- store persistent media identifiers in business rows, never a `wxfile://` or cache path
- resolve a persistent identifier only when a page needs a display URL
- claim a newly uploaded object in the same backend lifecycle as the business write
- clean replaced objects after the new reference is valid; archive keeps media, permanent delete removes it
- keep the MySQL-backed media provider local-only until an online storage adapter is explicitly authorized and verified

## 4. Knowledge Content Workflow

When changing articles or knowledge search:
- update `data/knowledge/articles.json` first
- ensure deployment copies under `dist/scf/*/data/knowledge/` stay in sync
- keep `KnowledgeService` and `dist/scf/api-scf/knowledge.js` aligned on the same fields
- verify both the wiki page and the agent knowledge search still load articles

Long-term rule:
- MySQL is the primary store
- JSON is seed and fallback
- do not silently treat JSON as the permanent editorial system

## 5. Identity And Control Workflow

When changing auth or device command paths:
- keep identity validation strict
- avoid reintroducing legacy openid fallback unless explicitly gated
- keep the front end on logical actions, not raw device payloads
- preserve command acknowledgment as distinct from device execution

Recommended command semantics:
- `fan.on`
- `fan.off`

If new actions are added, document them before wiring the UI.

## 6. Verification Checklist

Before handing work back, verify:
- syntax passes on changed JS files
- the relevant focused tests pass
- the user-visible text still makes sense in the UI
- no fallback path accidentally replaced the primary source of truth
- every material retained/removed/added/reorganized feature has been disclosed

When the change is large, include file references in the summary so the next agent can continue without re-discovering the same context.

## 7. Escalation Rules

Escalate when a necessary choice would change the accepted product, primary data source, authorization, command semantics, autonomy, or task scope and the current user request does not already authorize it.

File splits and related changes across subsystems can proceed within an authorized task after the owner, affected contract and verification are understood. Investigate unknown data origins before asking; do not hide an unresolved architectural decision inside a local patch.

## 8. What Good Looks Like

After this workflow is in place, a new AI should be able to answer:
- where the truth lives
- which files are safe to edit
- how to verify the edit
- when to stop and ask for scope guidance
