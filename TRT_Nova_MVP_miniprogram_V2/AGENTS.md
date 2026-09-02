# AGENTS.md

Use this repository as a plant-care mini program with SCF backends.

## Read First

- `docs/ai-project-map.md`
- `docs/ai-workflow.md`
- `docs/current-architecture.md`
- `.claude/skills/evolving-trt-nova/SKILL.md`

## Core Rules

- Prefer the smallest file that owns the behavior.
- Treat `dist/scf/*` as deployable backend source, not disposable build output.
- Treat `data/knowledge/articles.json` as seed or fallback data, not the long-term editorial system.
- Keep identity strict: WeChat login -> SCF auth -> JWT.
- Keep device commands action-based (`fan.on`, `fan.off`).
- Default scope excludes exploratory or archived directories such as `emotional_chat_fullsrc/`, `flutter_app/`, and `i18n/` unless the user explicitly scopes them into the task.

The full working convention is in `.claude/skills/evolving-trt-nova/SKILL.md`.

## Where To Put Changes

- Page behavior and state shaping: `pages/<name>/<name>.js` and `pages/<name>/<name>-state.js`
- Shared app logic: `services/modules/*`
- API adapter and runtime bridge: `services/core/*`
- Deployable SCF entry points: `dist/scf/*/index.js`
- Knowledge content seed: `data/knowledge/articles.json`

## Verification

- Run `node --check` on changed JavaScript files.
- Run focused `node --test` for helper modules.
- Run `node scripts/check-ai-context.mjs` when docs, SCF layout, or skill files change.
- Preview the mini program for any UI text or layout change.

## Stop Conditions

Pause and ask before editing if:
- the change touches multiple subsystems at once
- a fallback has started behaving like the primary source of truth
- you cannot name the owner file for the behavior
- you would need to refactor a large file without a clear boundary
