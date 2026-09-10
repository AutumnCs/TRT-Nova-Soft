# AGENTS.md

Use this repository as a plant-care mini program with SCF backends.

## Context To Load

- Follow the user's current scope and reuse reliable context already loaded.
- When ownership or entry points are unclear, read the relevant part of `docs/ai-project-map.md`.
- For architecture, data-source or cross-layer decisions, read the affected part of `docs/current-architecture.md`.
- For workflow, safety-boundary or phase-acceptance work, read the relevant part of `docs/ai-workflow.md` and `.claude/skills/evolving-trt-nova/SKILL.md`.
- Refresh only missing or changed context; a local fix does not require reading every document again.

## Core Rules

- Prefer the smallest file that owns the behavior.
- Treat `dist/scf/*` as deployable backend source, not disposable build output.
- Treat `data/knowledge/articles.json` as seed or fallback data, not the long-term editorial system.
- Keep identity strict: WeChat login -> SCF auth -> JWT.
- Keep device commands action-based (`fan.on`, `fan.off`).
- Default scope excludes exploratory or archived directories such as `emotional_chat_fullsrc/`, `flutter_app/`, and `i18n/` unless the user explicitly scopes them into the task.
- Preserve the repository's established project-management conventions, comments, naming, code organization, and implementation style unless the approved PRD or a concrete correctness issue requires a local change.
- Before fixing a problem that did not exist in the old project or accepted baseline, compare the old path and classify it as inherited debt, an integration regression caused by our modifications, or a defect introduced with a new feature. Prefer restoring the smallest compatible owner/path/contract from the known-good behavior; do not retain a broader rewrite when a local fix is sufficient.
- Maintain `docs/localization-compromise-register.md` for every local-only replacement of the intended cloud path. Before each phase handoff, disclose every new, changed, or closed compromise (or explicitly state that there were none); before cloud/experience acceptance, restore or explicitly approve every open restore item.
- After implementing any deletion of an existing feature or entry, addition of a new feature, or substantial change to an existing feature or user flow, explicitly disclose the material change to the user. Before phase acceptance, list what was retained, removed, added, or reorganized; do not rely on the user discovering the change during acceptance.
- Treat upper-layer architecture as a material change. Before acceptance, explicitly distinguish the product workflow, Agent framework, Agent runtime, runtime harness, evaluation harness, memory policy, tool/side-effect authority, and capabilities that are not implemented. Do not silently introduce autonomous tool loops, multi-agent roles, handoffs, subagents, durable execution, or new permission and memory policies; surface the concrete choice and impact to the user first.
- Do not introduce source hashes, deployment manifests, or new provenance machinery solely as precaution when the existing repository workflow does not use them and the user has not requested them.
- Keep safeguards proportional to demonstrated risk. Do not use "security" as a reason to rewrite working code, change the established style, or add broad defensive abstractions; prefer the smallest necessary, evidence-backed change.

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

## Decisions That Need User Input

- Continue authorized implementation, including related changes across files or subsystems, while preserving the accepted product and permission boundaries.
- If ownership or a refactoring boundary is unclear, inspect the relevant code and docs first. Ask only when the remaining uncertainty prevents a reliable choice or would materially alter scope, behavior, authority or resource use.
- Changing a fallback into a primary source, changing authorization or command semantics, or adding autonomy requires explicit authorization for that actual change. Do not repeat confirmation when the current task already provides it.
- A file split or a cross-subsystem change alone is not a new approval gate.
