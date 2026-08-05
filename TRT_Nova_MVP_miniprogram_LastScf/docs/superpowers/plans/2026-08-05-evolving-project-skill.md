# TRT Nova Evolving Project Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repository-owned skill and checker that help Codex understand and safely evolve the TRT Nova mini-program without freezing project facts into the skill itself.

**Architecture:** Keep stable collaboration rules in `.agents/skills/evolving-trt-nova/SKILL.md`, keep mutable project facts in the `docs/ai-*.md` files, and use `scripts/check-ai-context.mjs` for deterministic drift checks. `AGENTS.md` stays the entry point and points agents to the project skill instead of duplicating the rules.

**Tech Stack:** Markdown, YAML, Node.js, existing repo docs, Codex skill metadata.

## Global Constraints

- Treat `dist/scf/*` as deployable backend source, not disposable build output.
- Treat `data/knowledge/articles.json` as seed/fallback data, not the long-term editorial system.
- Keep identity strict: WeChat login -> SCF auth -> JWT.
- Keep device commands action-based, such as `fan.on` and `fan.off`.
- Temporary debugging configuration, local endpoints, and secrets must never become durable project rules automatically.
- Do not scan or edit sibling projects by default.
- Do not overwrite unrelated dirty-worktree changes.

---

### Task 1: Baseline the current failure mode and lock the file boundaries

**Files:**
- Read: `AGENTS.md`
- Read: `docs/ai-project-map.md`
- Read: `docs/ai-workflow.md`
- Read: `docs/current-architecture.md`
- Read: `C:/Users/Charles/.codex/skills/.system/skill-creator/references/openai_yaml.md`

**Interfaces:**
- Consumes: the current repo docs and the skill-creator metadata rules.
- Produces: the exact skill folder shape and metadata fields we will create next.

- [ ] **Step 1: Confirm the target skill name and folder**

Use `evolving-trt-nova` under `.agents/skills/` so the skill is project-local and clearly separated from human-facing docs.

- [ ] **Step 2: Capture the current doc boundaries**

Record that `docs/ai-project-map.md` owns repository facts, `docs/ai-workflow.md` owns collaboration rules, and `docs/current-architecture.md` owns runtime architecture.

- [ ] **Step 3: Write the minimal baseline notes**

Summarize the expected failure mode in one sentence: without a project skill, future Codex runs can confuse stable rules with temporary implementation details as the repo grows.

### Task 2: Scaffold the project skill and its UI metadata

**Files:**
- Create: `.agents/skills/evolving-trt-nova/SKILL.md`
- Create or modify: `.agents/skills/evolving-trt-nova/agents/openai.yaml`

**Interfaces:**
- Consumes: the design spec and the skill-creator metadata rules.
- Produces: a loadable skill whose description triggers on TRT Nova repo work and whose body tells agents how to classify changes.

- [ ] **Step 1: Initialize the skill folder**

Run the skill-creator initializer with the project-local path and include the `agents` resource so metadata is generated in the right shape.

```bash
python C:/Users/Charles/.codex/skills/.system/skill-creator/scripts/init_skill.py evolving-trt-nova --path G:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram_LastScf/.agents/skills --resources agents
```

- [ ] **Step 2: Replace the placeholder SKILL.md**

Write concise instructions that cover project-root discovery, reading the AI docs, classifying changes, updating docs vs skill, and stopping on safety invariant changes.

- [ ] **Step 3: Regenerate or verify `agents/openai.yaml`**

Ensure the metadata stays aligned with the final `SKILL.md` trigger text and default prompt.

### Task 3: Add the deterministic AI context checker and tests

**Files:**
- Create: `scripts/check-ai-context.mjs`
- Create: `scripts/check-ai-context.test.js`

**Interfaces:**
- Consumes: repo docs, `AGENTS.md`, and the on-disk `dist/scf` / shared-service layout.
- Produces: a non-mutating checker that reports missing required files and likely architecture drift.

- [ ] **Step 1: Write the failing test first**

Add a focused Node test that feeds the checker a fixture map where one documented file is missing and one documented SCF entry point exists.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAiContext } from './check-ai-context.mjs';

test('reports missing documented files and passes on present ones', async () => {
  const result = await checkAiContext({ projectRoot: 'fixture-root' });
  assert.deepEqual(result.errors, ['missing: docs/ai-project-map.md']);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Expected failure should prove the checker does not yet exist or does not yet enforce the documented invariants.

- [ ] **Step 3: Implement the checker minimally**

Start with the existence checks from the spec: required docs, documented SCF entry points, shared service paths, knowledge seed/deploy copies, and skill metadata validation.

- [ ] **Step 4: Run the test and confirm it passes**

Keep the output focused on actionable errors and warnings only.

### Task 4: Rewire the project entry point to surface the skill without duplicating it

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/ai-project-map.md` if needed for any drift that the checker exposes and is clearly within scope

**Interfaces:**
- Consumes: the skill folder and the checker behavior.
- Produces: a clean entry point that tells agents where the project skill lives and what it owns.

- [ ] **Step 1: Update `AGENTS.md` to point at the skill**

Keep the file short and use it as the stable doorway into the repository-local skill and AI docs.

- [ ] **Step 2: Fix only clearly-owned drift in the AI docs**

If the checker reveals a durable architecture fact that is already established in the repo, update the project docs. Do not promote one-off debugging config into long-lived policy.

- [ ] **Step 3: Re-run the checker**

Verify the docs still match the on-disk structure after the entry-point update.

### Task 5: Validate the skill and context flow end to end

**Files:**
- Read and verify: `.agents/skills/evolving-trt-nova/SKILL.md`
- Read and verify: `.agents/skills/evolving-trt-nova/agents/openai.yaml`
- Run: `scripts/check-ai-context.mjs`

**Interfaces:**
- Consumes: the finished skill, the checker, and the project docs.
- Produces: a validated skill package that can be loaded and maintained safely.

- [ ] **Step 1: Run `quick_validate.py` on the skill folder**

```bash
python C:/Users/Charles/.codex/skills/.system/skill-creator/scripts/quick_validate.py G:/TRT-Nova-Soft/TRT_Nova_MVP_miniprogram_LastScf/.agents/skills/evolving-trt-nova
```

- [ ] **Step 2: Run the context checker**

Confirm the checker exits cleanly on the current repo state and reports any remaining drift clearly.

- [ ] **Step 3: Forward-test the skill against the real repo**

Use the finished skill on a repository-orientation prompt and confirm it identifies the project root, the authority files, and the change classification correctly.

- [ ] **Step 4: Commit the implementation**

Commit the skill, checker, and entry-point updates together so the repository has one coherent story for future agents.

