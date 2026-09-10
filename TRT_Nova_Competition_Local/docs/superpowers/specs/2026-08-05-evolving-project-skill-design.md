# TRT Nova Evolving Project Skill Design

## Goal

Create a repository-owned skill that helps future AI agents understand and safely modify the TRT Nova mini-program without freezing the project at its current architecture.

The skill must evolve when project conventions change, while architecture facts remain in normal project documentation. Temporary debugging configuration, local endpoints, and secrets must never become durable project rules automatically.

## Recommended Structure

```text
TRT_Nova_MVP_miniprogram_LastScf/
|-- AGENTS.md
|-- .agents/skills/evolving-trt-nova/
|   |-- SKILL.md
|   `-- agents/openai.yaml
|-- docs/
|   |-- ai-project-map.md
|   |-- ai-workflow.md
|   `-- current-architecture.md
`-- scripts/check-ai-context.mjs
```

Responsibilities are deliberately separated:

- `AGENTS.md` is the stable entry point and tells agents when to load the project skill.
- `SKILL.md` owns the discovery, change-classification, documentation-sync, and verification procedure.
- `docs/ai-project-map.md` owns changeable repository and architecture facts.
- `docs/ai-workflow.md` owns project-wide collaboration conventions and verification expectations.
- `docs/current-architecture.md` owns the detailed current runtime architecture.
- `scripts/check-ai-context.mjs` performs deterministic drift checks that should not depend on agent judgment.

The skill must reference these files instead of copying their detailed contents.

## Project Boundary

The Git root contains sibling projects and tools, while the skill belongs only to `TRT_Nova_MVP_miniprogram_LastScf`.

At startup, the skill must locate the project root by finding the nearest directory containing both `AGENTS.md` and `app.json`. It must scope discovery, validation, and documentation updates to that directory. A sibling directory may only be inspected when a project document explicitly declares it as a dependency or the user places it in scope.

## Evolution Contract

Every material change is classified before documentation is updated.

| Change class | Examples | Required update |
| --- | --- | --- |
| Implementation | UI behavior, isolated bug fix, internal refactor with unchanged ownership | Code and tests only |
| Project fact | New SCF, Redis adoption, database migration, new deployment package, source-of-truth move | Update project map and detailed architecture |
| Working convention | New owner-file rule, verification command, generated-source policy | Update workflow; update skill only when its procedure changes |
| Safety invariant | Authentication chain, authorization boundary, command schema, secret-handling rule | Require explicit user confirmation, then update docs and skill |
| Temporary configuration | Local API address, test credentials, one-off feature flag | Never promote automatically |

The skill may update itself as part of an approved repository task when its trigger conditions or operating procedure have genuinely changed. It must summarize the proposed rule change and verify the resulting skill. It must not silently reinterpret a one-off implementation as a permanent convention.

## Agent Workflow

When the skill triggers, the agent follows this sequence:

1. Locate the project root and read `AGENTS.md`, the AI project map, workflow, and current architecture.
2. Inspect only task-relevant code, configuration, recent diffs, and deployment files.
3. State the behavior owner, source of truth, fallback, affected boundary, and verification method.
4. Run the context checker before editing to expose pre-existing documentation drift.
5. Implement the smallest coherent change.
6. Classify the completed change using the evolution contract.
7. Update architecture facts or skill rules only when the classification requires it.
8. Run focused code tests, the context checker, and skill validation when `SKILL.md` changed.
9. Report code changes separately from documentation or skill evolution.

Pre-existing drift is reported but is not automatically repaired when unrelated to the user's task.

## Deterministic Context Checker

The first checker version remains intentionally small. It validates:

- every required read-first document exists;
- documented SCF entry points exist under `dist/scf`;
- documented shared service paths exist;
- canonical knowledge seed and deployment copies exist;
- the project map mentions detected infrastructure with durable configuration evidence, initially including Redis;
- no AI project document points to a missing in-project file;
- the skill and its UI metadata pass the standard skill validator.

The checker reports actionable errors and warnings. Errors cover broken required paths and invalid skill structure. Warnings cover likely architecture drift that still requires human judgment. It must not modify files.

Checks should be added only for stable, machine-observable invariants. Architectural interpretation remains in the skill workflow and user review.

## Skill Triggering

The skill description should trigger for work in this repository involving feature implementation, bug fixes, refactoring, architecture review, SCF deployment, backend optimization, Redis or database changes, authentication, device control, knowledge storage, and project documentation maintenance.

The body should stay concise and use progressive disclosure. Detailed architecture remains in `docs/`, and deterministic logic remains in the checker script.

## Safety And Error Handling

- Stop before changing a safety invariant without explicit user confirmation.
- Do not store secrets, tokens, production credentials, or private endpoints in skill files or AI documentation.
- Treat local hard-coded addresses as temporary unless deployment configuration proves otherwise.
- Do not scan or edit sibling projects by default.
- Do not overwrite unrelated dirty-worktree changes.
- If code and documentation disagree, report the evidence and identify the likely authority before updating either side.
- If the checker cannot determine an architectural fact mechanically, emit a warning rather than guessing.

## Validation

The implementation is complete when:

- the skill folder passes `quick_validate.py`;
- `agents/openai.yaml` matches the skill metadata;
- the context checker passes its fixture or focused Node tests;
- a baseline agent scenario demonstrates the current failure mode without the skill;
- the same scenario with the skill correctly locates the project, identifies the owner and source of truth, and classifies documentation impact;
- a backend-evolution scenario recognizes a durable Redis or storage change as a project-fact update;
- a temporary-local-endpoint scenario does not promote debugging configuration into project architecture;
- `AGENTS.md` exposes the skill without duplicating its body.

## Initial Scope

The first version covers repository orientation, change classification, context drift detection, and safe self-maintenance. It does not deploy services, migrate databases, edit production configuration, or autonomously choose a future backend architecture.
