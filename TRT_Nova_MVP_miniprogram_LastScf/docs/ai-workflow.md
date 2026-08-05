# AI Workflow

> Purpose: keep human + AI collaboration predictable in this repo.

## 1. Working Rules

- Start by reading [`docs/ai-project-map.md`](./ai-project-map.md)
- Prefer the smallest file that owns the behavior
- Do not change unrelated subsystems while you are here
- Favor extraction over adding more logic to a large file
- Keep deployable backend source and app source aligned with the current architecture docs

### Default Scope

Unless the user explicitly asks for them, treat exploratory or archived directories such as `emotional_chat_fullsrc/`, `flutter_app/`, and `i18n/` as out of scope. Do not read them during normal repo orientation, and do not let them drive the default source-of-truth map.

## 2. Before Changing Code

Answer these in order:
1. What exact behavior is changing?
2. Which layer owns it?
3. What is the source of truth?
4. What is the fallback?
5. What test or check will prove the change is correct?

If any answer is unclear, pause and narrow scope before editing.

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

### Shared services

Use these patterns:
- `services/core/*` for transport adapters and runtime bridges
- `services/modules/*` for domain logic
- `services/config/*` for shared constants and thresholds

Keep service methods explicit:
- a method should do one job
- the input shape should be obvious from the name
- if a method starts accepting too many ad hoc payloads, split it

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

When the change is large, include file references in the summary so the next agent can continue without re-discovering the same context.

## 7. Escalation Rules

Escalate to a design discussion when:
- a file needs a structural split
- multiple subsystems are changing at once
- a fallback starts behaving like the primary system
- the repo cannot answer "where does this data come from?"

Do not hide architectural uncertainty behind a local patch.

## 8. What Good Looks Like

After this workflow is in place, a new AI should be able to answer:
- where the truth lives
- which files are safe to edit
- how to verify the edit
- when to stop and ask for scope guidance
