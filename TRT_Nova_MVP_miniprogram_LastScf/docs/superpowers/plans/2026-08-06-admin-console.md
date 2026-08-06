# TRT Nova Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Track progress with checkbox syntax.

**Goal:** Build a lightweight admin console in the same repo so we can manage knowledge articles, devices, users, and operational logs without turning the console into a second product.

**Architecture:** Put the admin UI in `admin-web/` as a static site, expose admin APIs from `dist/scf/admin-scf/`, keep shared logic in `services/modules/*`, keep `data/knowledge/articles.json` as seed/fallback, and keep OneNET / EMQX as the device connectivity layer.

**Tech Stack:** Static HTML/CSS/JS for the admin UI, Node.js SCF handlers, MySQL, Redis, COS, and the existing Node test runner.

## Global Constraints

- Keep the admin console in the same repository, but in its own directory.
- Treat `admin-web/` as the management UI only.
- Treat `dist/scf/admin-scf/` as admin-only HTTP APIs, validation, persistence, and audit logging.
- Keep `services/modules/` as shared business logic for the mini program, admin console, and SCF entry points.
- Keep `data/knowledge/articles.json` as seed/fallback, not the long-term editorial source.
- Do not replace OneNET / EMQX.
- Do not require Lighthouse for the first version.

---

### Task 1: Lock the new admin boundaries into the project skill and context checker

**Files:**
- Modify: `.claude/skills/evolving-trt-nova/SKILL.md`
- Modify: `docs/ai-project-map.md`
- Modify: `docs/ai-workflow.md`
- Modify: `scripts/check-ai-context.mjs`
- Modify: `scripts/check-ai-context.test.mjs`

**Interfaces:**
- Consumes: the current repository boundary rules.
- Produces: a skill and checker that recognize `admin-web/` and `dist/scf/admin-scf/` as first-class project areas.

- [ ] **Step 1: Add a failing checker test for the admin directories**

```js
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkAiContext } from './check-ai-context.mjs';

test('recognizes admin console directories as part of the project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trt-nova-admin-'));
  mkdirSync(join(root, 'admin-web'), { recursive: true });
  mkdirSync(join(root, 'dist', 'scf', 'admin-scf'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# AGENTS\n');
  writeFileSync(join(root, 'app.json'), '{}');
  writeFileSync(join(root, 'admin-web', 'index.html'), '<!doctype html>');
  writeFileSync(join(root, 'dist', 'scf', 'admin-scf', 'index.js'), 'module.exports = {};\n');

  const result = await checkAiContext({ projectRoot: root });
  assert.deepEqual(result.errors, []);
});
```

- [ ] **Step 2: Run the checker test and confirm it fails before the skill update**

Run:
```bash
node --test scripts/check-ai-context.test.mjs
```

- [ ] **Step 3: Update the skill, project map, workflow, and checker**

Add the admin console as a formal control plane in the skill, record the new directory boundaries in the project map, add the admin workflow rule, and make the context checker verify admin console files when they exist.

- [ ] **Step 4: Re-run the checker test and the runtime checker**

Run:
```bash
node --test scripts/check-ai-context.test.mjs
node scripts/check-ai-context.mjs
```

- [ ] **Step 5: Commit the boundary update**

```bash
git add .claude/skills/evolving-trt-nova/SKILL.md docs/ai-project-map.md docs/ai-workflow.md scripts/check-ai-context.mjs scripts/check-ai-context.test.mjs
git commit -m "docs: add admin console control-plane boundaries"
```

### Task 2: Scaffold the admin console shell and shared API contract

**Files:**
- Create: `admin-web/index.html`
- Create: `admin-web/styles.css`
- Create: `admin-web/main.js`
- Create: `admin-web/lib/api.js`
- Create: `admin-web/lib/nav.js`
- Create: `admin-web/lib/metrics.js`
- Create: `admin-web/test/nav.test.js`
- Create: `dist/scf/admin-scf/package.json`
- Create: `dist/scf/admin-scf/index.js`
- Create: `dist/scf/admin-scf/lib/router.js`
- Create: `dist/scf/admin-scf/lib/http.js`
- Create: `dist/scf/admin-scf/lib/auth.js`
- Create: `dist/scf/admin-scf/test/router.test.js`

**Interfaces:**
- Consumes: the admin control-plane boundaries from Task 1.
- Produces: a static admin shell and a thin SCF router/auth/http contract.

- [ ] **Step 1: Add the failing frontend navigation test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminNav } from '../lib/nav.js';

test('admin nav exposes the first-release modules', () => {
  const nav = buildAdminNav();
  assert.deepEqual(nav.map((item) => item.id), ['overview', 'knowledge', 'devices', 'users', 'logs']);
});
```

- [ ] **Step 2: Add the failing backend router test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminRouter } from '../lib/router.js';

test('admin router exposes a handle function', () => {
  const router = createAdminRouter({ auth: {}, knowledge: {}, devices: {}, users: {}, logs: {} });
  assert.equal(typeof router.handle, 'function');
});
```

- [ ] **Step 3: Run both tests and confirm they fail before implementation**

Run:
```bash
node --test admin-web/test/nav.test.js
node --test dist/scf/admin-scf/test/router.test.js
```

- [ ] **Step 4: Implement the smallest shell and router that satisfy the tests**

Create the static layout, sidebar, overview cards, and API wrapper in `admin-web/`, then add a thin SCF entry point plus a router/auth/http helper trio under `dist/scf/admin-scf/`.

- [ ] **Step 5: Re-run the shell and router tests**

Run:
```bash
node --test admin-web/test/nav.test.js
node --test dist/scf/admin-scf/test/router.test.js
```

- [ ] **Step 6: Commit the shell scaffolding**

```bash
git add admin-web dist/scf/admin-scf
git commit -m "feat: scaffold admin console shell"
```

### Task 3: Implement knowledge article management end to end

**Files:**
- Create: `reference/admin-console.v1.sql`
- Create: `dist/scf/admin-scf/lib/knowledgeRepository.js`
- Create: `dist/scf/admin-scf/lib/knowledgeService.js`
- Create: `dist/scf/admin-scf/test/knowledge.test.js`
- Modify: `services/modules/KnowledgeService.js`
- Modify: `scripts/import-knowledge-articles.js`
- Modify: `dist/scf/api-scf/knowledge.js`

**Interfaces:**
- Consumes: the admin shell and router from Task 2.
- Produces: article CRUD, import/export behavior, and a runtime source of truth that can move from JSON seed to MySQL while preserving fallback content.

- [ ] **Step 1: Add the failing knowledge service test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeService } from '../lib/knowledgeService.js';

test('knowledge service lists seed articles when the database is empty', async () => {
  const service = createKnowledgeService({
    repository: {
      listArticles: async () => []
    },
    seedArticles: [
      { id: 1, slug: 'watering-basics', title: 'watering-basics' }
    ]
  });

  const result = await service.listArticles();
  assert.equal(result.articles.length, 1);
});
```

- [ ] **Step 2: Run the knowledge test and confirm it fails**

Run:
```bash
node --test dist/scf/admin-scf/test/knowledge.test.js
```

- [ ] **Step 3: Add the minimal schema and repository layer**

Create `reference/admin-console.v1.sql` with article tables and implement the repository/service pair so the admin API can create, list, update, delete, publish, and export articles while falling back to seed data when needed.

- [ ] **Step 4: Update the shared knowledge service and importer**

Make `services/modules/KnowledgeService.js` treat MySQL as the runtime source after import, keep `data/knowledge/articles.json` as seed/fallback, and adjust `scripts/import-knowledge-articles.js` to move the current mock article set into the database.

- [ ] **Step 5: Re-run the knowledge tests and the existing wiki path**

Run:
```bash
node --test dist/scf/admin-scf/test/knowledge.test.js
node --test scripts/check-ai-context.test.mjs
```

- [ ] **Step 6: Commit the knowledge workflow**

```bash
git add reference/admin-console.v1.sql dist/scf/admin-scf/lib/knowledgeRepository.js dist/scf/admin-scf/lib/knowledgeService.js dist/scf/admin-scf/test/knowledge.test.js services/modules/KnowledgeService.js scripts/import-knowledge-articles.js dist/scf/api-scf/knowledge.js
git commit -m "feat: add admin knowledge management"
```

### Task 4: Add device, user, and log views with read-first admin APIs

**Files:**
- Create: `dist/scf/admin-scf/lib/deviceService.js`
- Create: `dist/scf/admin-scf/lib/userService.js`
- Create: `dist/scf/admin-scf/lib/logService.js`
- Create: `dist/scf/admin-scf/test/admin-data.test.js`
- Create: `admin-web/pages/devices.js`
- Create: `admin-web/pages/users.js`
- Create: `admin-web/pages/logs.js`
- Modify: `admin-web/main.js`
- Modify: `dist/scf/admin-scf/index.js`

**Interfaces:**
- Consumes: the admin shell and knowledge stack from Tasks 2 and 3.
- Produces: read-first dashboards for devices, users, and logs, plus the overview data they depend on.

- [ ] **Step 1: Add the failing admin data test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceService } from '../lib/deviceService.js';

test('device service builds an operational summary from device rows', async () => {
  const service = createDeviceService({
    repository: {
      listDevices: async () => [{ id: 1, name: 'balcony-pot', status: 'online' }]
    }
  });

  const result = await service.getSummary();
  assert.equal(result.total, 1);
  assert.equal(result.online, 1);
});
```

- [ ] **Step 2: Run the admin data test and confirm it fails**

Run:
```bash
node --test dist/scf/admin-scf/test/admin-data.test.js
```

- [ ] **Step 3: Implement the minimal read-only services and views**

Add the device, user, and log services plus matching admin pages so the first version can display real operational data without requiring write flows for every module.

- [ ] **Step 4: Re-run the admin data test and preview the static console**

Run:
```bash
node --test dist/scf/admin-scf/test/admin-data.test.js
```

- [ ] **Step 5: Commit the read-first modules**

```bash
git add admin-web dist/scf/admin-scf
git commit -m "feat: add admin read-only dashboards"
```

### Task 5: Finalize deployment wiring and release checks

**Files:**
- Modify: `docs/current-architecture.md`
- Modify: `docs/ai-project-map.md`
- Modify: `docs/ai-workflow.md`
- Modify: `docs/superpowers/specs/2026-08-06-admin-console-design.md` if the implementation changes a durable boundary
- Modify: `docs/superpowers/plans/2026-08-06-admin-console.md` only to keep the checklist current

**Interfaces:**
- Consumes: the admin shell, API, and data flows from Tasks 1-4.
- Produces: a stable release checklist for static hosting, SCF deployment, and skill-aware maintenance.

- [ ] **Step 1: Add a release smoke test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAiContext } from './check-ai-context.mjs';

test('project context recognizes the admin console release shape', async () => {
  const result = await checkAiContext({ projectRoot: process.cwd() });
  assert.deepEqual(result.errors, []);
});
```

- [ ] **Step 2: Run the release smoke check**

Run:
```bash
node --test scripts/check-ai-context.test.mjs
node scripts/check-ai-context.mjs
```

- [ ] **Step 3: Update the architecture docs for the new control plane**

Document the admin console as a formal control plane and keep the static-site-plus-SCF deployment shape visible to future agents.

- [ ] **Step 4: Confirm the deployment shape is static site + SCF, not Lighthouse**

Verify the release notes and docs say the admin console deploys as a static web site backed by SCF APIs, with MySQL / Redis / COS underneath and OneNET / EMQX unchanged.

- [ ] **Step 5: Commit the release wiring**

```bash
git add docs/current-architecture.md docs/ai-project-map.md docs/ai-workflow.md docs/superpowers/specs/2026-08-06-admin-console-design.md docs/superpowers/plans/2026-08-06-admin-console.md
git commit -m "docs: finalize admin console release wiring"
```
