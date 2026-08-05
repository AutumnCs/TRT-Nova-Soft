---
name: evolving-trt-nova
description: Use when working in the TRT Nova mini-program repository on feature work, bug fixes, refactors, backend or SCF changes, deployment packaging, auth, device control, knowledge storage, or project documentation updates, especially when you need the project root, ownership boundaries, or source-of-truth rules.
---

# Evolving TRT Nova

## Overview

Keep repo facts, workflow rules, and safety boundaries separate. Use the project docs as the source of truth, and let the skill describe how to read and maintain them as the repo evolves.

## Start Here

1. Find the project root by locating the nearest directory that contains both `AGENTS.md` and `app.json`.
2. Read `AGENTS.md`, `docs/ai-project-map.md`, `docs/ai-workflow.md`, and `docs/current-architecture.md`.
3. Identify the behavior owner, the source of truth, the fallback, the affected boundary, and the verification method before editing.

## Change Classification

| Change type | What to update |
| --- | --- |
| Implementation | Code and tests only |
| Project fact | Update `docs/ai-project-map.md` and `docs/current-architecture.md` |
| Working convention | Update `docs/ai-workflow.md`; update this skill only if the procedure itself changes |
| Safety invariant | Stop and ask the user before changing auth, authorization, command schema, or secret-handling rules |
| Temporary configuration | Keep it local; do not promote debug addresses, test credentials, or one-off flags into durable rules |

## Working Rules

- Prefer the smallest file that owns the behavior.
- Treat `dist/scf/*` as deployable backend source, not disposable build output.
- Treat `data/knowledge/articles.json` as seed or fallback data, not the long-term editorial system.
- Keep identity strict: WeChat login -> SCF auth -> JWT.
- Keep device commands action-based, such as `fan.on` and `fan.off`.
- Treat `emotional_chat_fullsrc/`, `flutter_app/`, and `i18n/` as out of scope unless the user explicitly asks to work on them.
- Do not scan or edit sibling projects unless the user explicitly puts them in scope.

## Maintenance Loop

1. Run `scripts/check-ai-context.mjs` before and after edits that affect docs, SCF layout, or skill files.
2. Make the smallest coherent code change.
3. Update project docs when durable architecture facts changed.
4. Update this skill only when the repository workflow or safety rules changed.
5. If this skill changes, validate it with:
   - Claude Code side: `node scripts/check-ai-context.mjs`
   - Codex quick_validate (if available): `python <skill-creator-path>/scripts/quick_validate.py <project-root>/.claude/skills/evolving-trt-nova`

## Common Mistakes

- Copying project facts into the skill instead of linking to the docs.
- Treating temporary local config as a permanent rule.
- Updating the skill when only implementation details changed.
- Forgetting that auth, access control, and command-schema changes need explicit confirmation.
