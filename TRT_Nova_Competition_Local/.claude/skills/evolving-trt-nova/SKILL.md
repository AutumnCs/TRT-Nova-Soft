---
name: evolving-trt-nova
description: Use when maintaining TRT Nova workflows, discovering ownership, changing architecture or data sources, or preparing phase acceptance. For local implementation, follow the applicable AGENTS.md and load only the references needed for that change.
---

# Evolving TRT Nova

## Overview

Keep repo facts, workflow rules, and safety boundaries separate. Use the project docs as the source of truth, and let the skill describe how to read and maintain them as the repo evolves.

## Start Here

1. Find the project root by locating the nearest directory that contains both `AGENTS.md` and `app.json`.
2. Reuse the applicable `AGENTS.md` and reliable context already loaded. Read only the relevant map, workflow or architecture sections needed to resolve the current task.
3. Identify the behavior owner, the source of truth, the fallback, the affected boundary, and the verification method before editing.

## Change Classification

| Change type | What to update |
| --- | --- |
| Implementation | Code and tests only |
| Project fact | Update `docs/ai-project-map.md` and `docs/current-architecture.md` |
| Working convention | Update `docs/ai-workflow.md`; update this skill only if the procedure itself changes |
| Safety invariant | Confirm a substantive change to auth, authorization, command semantics or secret handling only when the current task has not already authorized that specific change |
| Temporary configuration | Keep it local; do not promote debug addresses, test credentials, or one-off flags into durable rules |

## Working Rules

- Follow the core source-of-truth, identity, command and directory-scope rules in the applicable `AGENTS.md` without reloading it when its content is already available.
- Preserve the control-plane boundary: `admin-web/` owns the management UI, and `dist/scf/admin-scf/` owns admin-only APIs.
- Do not scan or edit sibling projects unless the user explicitly puts them in scope.
- When a regression is absent from the old project or accepted baseline, compare both paths and classify it as inherited debt, an integration regression from our modifications, or a new-feature defect before editing. Restore the smallest compatible known-good owner/path/contract instead of broadening the change.
- Keep `docs/localization-compromise-register.md` current. Before every phase acceptance, record and disclose any local-only substitute for a cloud path; cloud or experience acceptance must close or explicitly approve all open restore items.
- After deleting an existing feature or entry, adding a feature, or substantially changing a feature or user flow, disclose what was retained, removed, added, and reorganized before phase acceptance. Maintain `docs/material-feature-change-disclosure.md` for multi-change phases; never make acceptance depend on the user discovering changes.
- Treat upper-layer architecture as material: before acceptance, separate and explain the product workflow, Agent framework, Agent runtime, runtime harness, evaluation harness, memory policy, tool/side-effect authority, and unimplemented capabilities. Never silently add autonomous tool loops, multi-agent roles, handoffs, subagents, durable execution, or new permission/memory policies; present the concrete choice and impact to the user first.
- Prefer UTF-8 without BOM for repo docs and source files, avoid paste-induced mojibake, and read back any Chinese text edits in the same toolchain before finishing.

## Maintenance Loop

1. Run `node scripts/check-ai-context.mjs` once after a coherent batch that affects docs, SCF layout or skills. Run a baseline first only when diagnosing an existing context failure; do not repeat an unchanged passing check.
2. Make the smallest coherent code change.
3. Update project docs and the material feature disclosure when durable architecture or user-flow facts changed.
4. Update this skill only when the repository workflow or safety rules changed.
5. If this skill changes, validate it with:
   - Context consistency: reuse the `node scripts/check-ai-context.mjs` result above if it covers the final content.
   - Codex quick_validate (if available): `python <skill-creator-path>/scripts/quick_validate.py <project-root>/.claude/skills/evolving-trt-nova`

## Common Mistakes

- Copying project facts into the skill instead of linking to the docs.
- Treating temporary local config as a permanent rule.
- Updating the skill when only implementation details changed.
- Changing an authorization or command contract without explicit task authorization; asking again when that authorization is already clear is also a mistake.
