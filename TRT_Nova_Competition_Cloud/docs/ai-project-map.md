# AI Project Map

## Competition delivery entry — 2026-09-09

The Cloud variant reuses the checked LastScf deployment: three separate SCF Function URLs, original index.main_handler, direct SCF environment variables, MySQL business data, and WeChat CloudBase storage for images AND documents. MediaStorageService coordinates /media/upload -> wx.cloud.uploadFile -> /media/complete. cloud-runtime validates inside each original handler; cloudbase-storage uses official WeChat stable_token and tcb file HTTP APIs with the same AppID/AppSecret; cloud-media owns registration, verified reads and cleanup. Incremental DDL is database/cloudbase-media.sql. See [Cloud deployment architecture](./lastscf-deployment-reuse.md). No CloudBase business functions/database or new Agent runtime were introduced.

This standalone competition directory owns its frontend, dist/scf sources, root dependency lock and deployment/cloud-initial tooling. No runtime or build step reads a sibling project. Start with [README](../README.md) and [competition delivery](./competition-delivery.md); older M0–M7 records are historical evidence, not a fresh acceptance of this copy.

Staging update — 2026-09-10: the previously reviewed 10 articles and 17 plant records are published. The existing history-cleanup-scf is deployed with an enabled every-minute timer, no Function URL, and a maximum of two media objects per invocation. Natural cleanup of nine test objects and retention of the referenced avatar passed real-cloud checks. This fixed maintenance job is not new Agent autonomy. Cross-user/phone acceptance and the newly observed task-negation defect remain open; see [environment verification](./localization-compromise-register.md).

Local setup is scripts/setup-local.mjs; safe database initialization is scripts/local-db/initialize.mjs; daily process management is scripts/local-server/manage-local-runtime.ps1. Cloud configuration and client generation live in deployment/cloud-initial/tools. MySQL currently selects legacy-direct (verified LastScf endpoint, no TLS); private-network and required remain available but unselected. The actual endpoint stays in candidate.config.local.json, not runtime source. Cloud AppID is derived from auth-scf.WECHAT_APPID; weather secrets are conditional on QWEATHER_ENABLED. Product and Agent authority remain unchanged.

> Purpose: give an AI agent a compact, reliable map of this repository so it can find the right source of truth quickly.

Current database preparation: the existing DB account is reused by explicit user decision, with no account or grants changes. The real independent database now has 30 tables and one verified media-deletion trigger; bootstrap and a built-candidate connection from the local host passed. See [database preparation evidence](../deployment/cloud-initial/verification/2026-09-09-database-preparation.md). This does not accept SCF egress or WeChat flows.

## 1. What This Repo Is

This repository is a plant-care mini program with:
- a WeChat Mini Program front end
- multiple SCF backends
- MySQL as the main business datastore
- OneNET / EMQX as device ingress and command delivery infrastructure
- Redis tracked as a future infrastructure layer in the architecture docs when scale or coordination needs justify it

The active local contest product is the four-Tab software loop: PlantPet -> AI observation -> confirmed care task -> calendar completion -> growth journal. Local implementation is not cloud deployment. The following retained infrastructure paths describe the wider system, not the default contest UI:
- Device telemetry -> `ingest-scf` -> MySQL
- Mini program auth -> `auth-scf` -> JWT
- Mini program API -> `api-scf` -> MySQL / OneNET
- Admin console -> `admin-scf` -> MySQL / operational data

## 2. Read This First

If you only read a few files, read these in order:
- [Competition delivery and verification status](./competition-delivery.md)
- [`CONTEXT.md`](../CONTEXT.md)
- [`docs/current-architecture.md`](./current-architecture.md)
- [`docs/localization-compromise-register.md`](./localization-compromise-register.md)
- [`docs/current-system-status-and-improvement-plan.md`](./current-system-status-and-improvement-plan.md)
- [`docs/scf-deploy-packages.md`](./scf-deploy-packages.md)
- [`app.js`](../app.js)
- [`services/config/runtime.js`](../services/config/runtime.js)
- [`dist/scf/api-scf/index.js`](../dist/scf/api-scf/index.js)
- [`services/core/ScfApiAdapter.js`](../services/core/ScfApiAdapter.js)

## 3. Source of Truth Map

### Front end

- `app.json`
- `custom-tab-bar/index.js`
- `pages/index/index.js`
- `pages/index/plant-pet-state.js`
- `pages/plantPetForm/plantPetForm.js`
- `pages/plantPetDetail/plantPetDetail.js`
- `pages/calendar/calendar.js`
- `pages/calendar/calendar-state.js`
- `pages/taskForm/taskForm.js`
- `pages/plantJournal/plantJournal.js`
- `pages/profile/profile.js`
- `pages/profileEdit/profileEdit.js`
- `pages/weatherSettings/weatherSettings.js`
- `pages/wiki/wiki.js`
- `pages/assistant/assistant.js`
- `pages/aiMemory/aiMemory.js`
- `pages/device/device.js` (legacy route, not a default M1 tab)

These files own page behavior and UI state. Prefer extracting helper logic into a focused `*-state.js` or module before adding more page logic.

The local M1-M7 mini-program shell has four default tabs: Garden, AI Assistant, Calendar, and Profile. The governed knowledge base, PlantPet growth timeline, weather-city settings, system-settings hub, and AI-memory governance are subpages. Device pages remain registered for legacy compatibility but are outside the default PRD v0.1 entry flow.

### SCF backends

- `dist/scf/auth-scf/index.js`
- `dist/scf/api-scf/index.js`
- `dist/scf/ingest-scf/index.js`
- `dist/scf/agent-scf/index.js`
- `dist/scf/history-cleanup-scf/index.js`
- `dist/scf/admin-scf/index.js`
- `dist/scf/api-scf/lib/plant-pets.js`
- `dist/scf/api-scf/lib/care-tasks.js`
- `dist/scf/api-scf/lib/plant-journal.js`
- `dist/scf/api-scf/lib/media-storage.js`
- `dist/scf/api-scf/lib/qweather-client.js`
- `dist/scf/api-scf/lib/weather.js`
- `dist/scf/api-scf/lib/ai-records.js`
- `dist/scf/agent-scf/agent/chatHandler.js`
- `dist/scf/agent-scf/agent/documentHandler.js`
- `dist/scf/agent-scf/agent/intentRouter.js`
- `dist/scf/agent-scf/agent/userIdentity.js`
- `dist/scf/agent-scf/agent/visionHandler.js`
- `dist/scf/agent-scf/agent/petContext.js`
- `dist/scf/agent-scf/lib/agent-store.js`
- `dist/scf/agent-scf/lib/quota.js`
- `dist/scf/agent-scf/lib/visionClient.js`
- `dist/scf/agent-scf/rag/knowledgeSearch.js`

These are the deployable backend entry points. Treat them as the authoritative SCF sources for this repo.

### Admin control plane

- `admin-web/`
- `dist/scf/admin-scf/index.js`

Treat the admin console as a first-class control plane boundary in this repo. `admin-web/` owns the management UI, and `dist/scf/admin-scf/` owns admin-only APIs, validation, persistence, and audit-oriented control-plane behavior.

### Shared services

- `services/core/ScfApiAdapter.js`
- `services/modules/AuthService.js`
- `services/modules/DeviceService.js`
- `services/modules/KnowledgeService.js`
- `services/modules/PlantService.js`
- `services/modules/TodoService.js`
- `services/modules/care-task-presenter.js`
- `services/modules/PlantJournalService.js`
- `services/modules/MediaStorageService.js`
- `services/modules/WeatherService.js`
- `services/modules/SolarTermService.js`
- `services/modules/AgentService.js`
- `services/modules/AlertService.js`

These modules are the shared bridge between the mini program and SCF APIs. Keep these small and explicit.

### Knowledge content

- Canonical seed content: `data/knowledge/articles.json`
- Canonical plant-profile seed content: `data/knowledge/plants.json`
- Deployment copy: `dist/scf/api-scf/data/knowledge/articles.json`
- Deployment plant-profile copy: `dist/scf/api-scf/data/knowledge/plants.json`
- Agent-side copy: `dist/scf/agent-scf/data/knowledge/articles.json`
- Agent-side plant-profile copy: `dist/scf/agent-scf/data/knowledge/plants.json`
- Governed importer: `scripts/import-knowledge-articles.js`
- Existing-database M4 migration: `reference/knowledge-content.m4.sql`
- Human review index: `docs/m4-content-review-package.md`
- Existing-database M5 weather migration: `reference/weather.m5.sql`
- Local QWeather setup and verification: `docs/m5-qweather-setup.md`
- Existing-database M6 AI migration: `reference/ai_assistant.m6.sql`
- Local M6 Chat/Vision setup and verification: `docs/m6-ai-assistant-setup.md`
- Historical M6 Agent workflow and evaluation harness: `docs/m6-agent-architecture-and-harness.md`
- Historical M6 conversation/attachment decisions: `docs/m6-conversation-attachment-memory-rag-extension.md`
- M6 visual/source research record: `docs/m6-agent-platform-code-and-ui-research.md`
- Historical September 1 local closure: `docs/m7-local-v01-closure-and-acceptance.md`
- Current M7 implementation and maintenance reference: `docs/current-architecture.md`; the old full report is now an archive navigation page.
- Latest navigation work: `docs/m7-navigation-performance-acceptance-guide.md`
- Proposed M7 PI-based Agent runtime boundary and migration gates: `docs/m7-pi-agent-refactor-design-proposal.md`
- M7 Phase 3 controlled-rollout implementation, evidence, rollback, and capability ownership: `docs/m7-phase3-controlled-rollout-results.md`
- Proposed NOVA LLM-first/write-authority decision: `docs/adr/0001-nova-agent-runtime-boundary.md`
- M7 product-level Agent contract and frozen legacy-route evidence: `evals/m7-agent/`
- Isolated PI Core compatibility Spike and reproducible results: `spikes/m7-pi-agent-core/`

The app should treat the JSON seed as fallback content, not as the long-term primary storage. A successful empty MySQL result stays empty; fallback is only for database errors. Both MySQL and fallback paths expose only `published` content. Missing status defaults to `draft`.

## 4. Functional Boundaries

### Identity

Identity is a strict chain:
- WeChat login
- SCF auth
- JWT token

Do not reintroduce openid fallback flows unless they are explicitly marked legacy and gated.

Current `api-scf` and `agent-scf` behavior is fail-closed by default. Their legacy header/body/debug openid compatibility is available only when `ALLOW_LEGACY_OPENID_FALLBACK=1`, which must not be enabled in production.

In the development profile, the mini program still calls real `wx.login()` from the login page. The loopback-only `scripts/local-server` owns `/auth/login` when `LOCAL_DEV_AUTH_ENABLED=true`, maps the non-empty code to the configured stable local test identity, upserts that user, and signs the same JWT shape consumed by protected APIs. It does not trust a client-supplied openid. When the local flag is disabled, `/auth/*` routes to the real `auth-scf`; trial and release profiles never use this loopback adapter. `/dev/token` remains an API-test helper, not the login acceptance path.

### Device control

Control requests must go through the API backend:
- mini program -> `api-scf /device/cmd`
- backend validates ACL and command schema
- backend publishes to the device transport

The front end should only send logical actions like `fan.on` or `fan.off`, not arbitrary device payloads.

### PlantPet ownership

The M1 PlantPet chain is:
- mini program page -> `PlantService`
- `PlantService` -> explicit `ScfApiAdapter` method
- `api-scf` PlantPet route -> `dist/scf/api-scf/lib/plant-pets.js`
- MySQL `plant_pets`

PlantPet ownership always comes from the authenticated JWT openid. Client-provided owner fields are not authoritative. M1 supports list, detail, create, edit, archive, and permanent delete; unknown species is a valid explicit state. It does not infer a numeric health score. From M2 onward, the visible care state is derived from real pending and overdue CareTask facts rather than a fabricated score.

### CareTask lifecycle

The local M2 care-task chain is:
- mini program pages -> `TodoService`
- `TodoService` -> explicit `ScfApiAdapter` care methods
- `api-scf /care/*` -> `dist/scf/api-scf/lib/care-tasks.js`
- MySQL `todos` / `care_events` / `user_badges`

Task ownership and PlantPet access are resolved from the authenticated JWT openid. M2 supports create, edit, postpone, delete, complete, day/range queries, weekly/monthly presentation, recurring-task regeneration, streaks, and care badges. Completion and recurring-task generation share one database transaction; the next occurrence is based on the actual completion date. Dates use the Asia/Shanghai product calendar. Rule, AI, weather, and diagnosis candidates require an explicit confirmation flag before becoming tasks. Reminder time is currently an in-app plan field only; no subscription-message scheduler or template is claimed.

### Growth journal and media lifecycle

The local M3 journal chain is:
- mini program pages -> `PlantJournalService` / `MediaStorageService`
- explicit `ScfApiAdapter` journal and media methods
- `api-scf /journal/*` and local-only `/media/*`
- MySQL `plant_journal` / `media_objects`

Journal ownership and media resolution always come from the authenticated JWT openid. A journal belongs to a PlantPet, accepts zero to three persistent image references, and is ordered by event date plus creation order. Archiving a PlantPet retains journal and media facts; permanent PlantPet deletion removes its journal, tasks, care events, and media in one local backend lifecycle. Replacing an avatar, PlantPet cover, or journal photo removes the replaced local object after the new reference is claimed.

The local media provider stores test bytes in MySQL only for development. Product data stores persistent `fileID` values separately from resolved display URLs or local cache paths. Current local validation detects JPEG, PNG, and WebP from the actual bytes rather than trusting a filename suffix. Real CloudBase storage and deployed endpoints require separate cloud verification.

### Admin console

The admin console is the TRT Nova control plane, not a second product.

- `admin-web/` is the management UI boundary
- `dist/scf/admin-scf/` is the admin API boundary
- admin flows manage business data and operational views, not device transport infrastructure
- OneNET / EMQX remain the transport and connectivity layer

### Knowledge

The local M4 knowledge chain is:

- wiki page -> `KnowledgeService` -> explicit `ScfApiAdapter` methods
- `api-scf /knowledge/*` -> MySQL `knowledge_articles` / `plant_library`
- `agent-scf/rag/knowledgeSearch.js` -> the same published MySQL content

Knowledge content is searchable and reusable by both the wiki page and the agent backend only after human review. Every item carries a readable source title, publisher, source URL/source ID, content update date, team review evidence, and image authorization statement. No match means unknown; sort order must never turn an unrelated item into a match.

The actual article and plant-profile body belongs in MySQL. The JSON files are seed and database-error fallback only. The 17 plant profiles and 10 articles were approved by `dola` on 2026-08-27 for the current local MVP. This is a temporary MVP data decision: retain, revise, or replace the dataset later without blocking M4, and do not treat the approval as online deployment authority or a final long-term content decision.

### Weather and solar terms

The local M5 weather chain is:

- home/weather-settings pages -> `WeatherService`
- explicit `ScfApiAdapter` weather methods -> protected `api-scf /weather/*` routes
- `dist/scf/api-scf/lib/weather.js` -> MySQL `user_weather_preferences` / `weather_cache`
- `dist/scf/api-scf/lib/qweather-client.js` -> QWeather dedicated API Host with a short-lived Ed25519 JWT

The mini program never holds the weather private key or calls QWeather directly. Long-term preference storage contains LocationID, city, administrative area, and selection source only; coordinates from an explicit location action are rounded before lookup and not persisted. Real weather is cached for 30 minutes. If refresh fails, only an existing real cache may be shown as stale; without a real cache the UI shows an unavailable state rather than example numbers.

`SolarTermService` calculates the 24 solar terms deterministically for Asia/Shanghai. Its care copy is a generic seasonal reminder and explicitly does not claim to represent current local phenology. The real local QWeather chain and WeChat DevTools E2E were verified on 2026-08-27; this is not evidence of an online deployment. The local private-key file boundary and required cloud restoration are registered as `LC-09`.

### NOVA assistant, Vision, and memory

Current as of 2026-09-07: M7 Phase 0-5 is locally implemented. Human M7 acceptance/performance closure and M8 cloud/physical-device acceptance remain separate. Start with [the plain-language product guide](./先看这里.md); use [current architecture](./current-architecture.md) for implementation ownership.

Approved correction (2026-09-07 evening): full raw session history, session compaction and one-opt-in AI-maintained cross-session summaries now run through `lib/conversation-context.js`. Existing Phase 4 preference CRUD remains compatibility-only. Human acceptance is still separate from real-model local tests.

Native editor follow-up: `components/conversation-composer` owns Delta and atomic inline function projection; Enter is newline, the arrow sends. `pages/aiMemory` edits one narrative `summary_text` via revision-checked `replace_summary`; `facts_json` remains internal for provenance. The user accepted the caret correction on September 8. Earlier failed system-key automation is preserved, and physical-device acceptance remains separate.

- Frontend: `pages/assistant`, `AgentService`, `ScfApiAdapter`. Attachments/functions enter the composer before sending. Own-message operations appear only on long press. Rewrite restores saved attachments and creates a branch; withdrawal is limited to the latest complete exchange.
- Composer correction: native attachment picker results tolerate hide/show only for the same account/plant/session and mounted page; network epoch guards remain strict. A single inline function chip is independent of user text, passes the existing selectedFunction metadata, and removes without template text left behind. Navigation-based task/memory entries remain unchanged.
- `agent/chatHandler.js` selects the controlled runtime or legacy path. Route A uses the internal Node-compatible `runtime/plantPetRuntime.js`, not the official PI package in production.
- `runtime/modelAdapter.js` owns provider messages; `toolRegistry.js` owns tools; `capabilityPolicy.js` constrains tool availability and required data. Model-selected tools are not business authorization. The policy still contains deterministic task/memory parsing; do not claim every capability is LLM-decided.
- `lib/conversation-context.js` assembles recent full exchanges, session summary and enabled user summary through request-local context. It owns owner-scoped history search, automatic summary generation and revision checks. `contextProjector.js` / `sessionAdapter.js` / `memoryAdapter.js` remain legacy compatibility helpers, not the default memory system.
- `lib/agent-store.js` retains full exchanges until user deletion, paginates 40 messages and copies complete branch prefixes. `reference/conversation_context.m7.sql` adds session projections and auto-summary settings/facts to the four existing M7 runtime tables.
- Phase 5 task proposals become business records only via confirmed owner-checked API transactions. Automatic low-risk context summaries are separately user-opted-in; no per-fact proposals. Model image/document advice cannot autonomously create tasks.
- Image/document handlers remain specialized, but now consume the same session context. Raw chat is not auto-pruned. Only published knowledge enters RAG.
- Document adapter corrected: legacy `llmClient` now uses the same explicit DeepSeek short-answer thinking setting as Vision/runtime; disabled, empty and truncated responses have separate errors. Current document contents take precedence over prior image observations. Real local document send/reopen has passed.
- Chat/Vision are unlimited for all accounts while usage is recorded. Current local acceptance config and the September 8 cloud candidate explicitly enable rollout; shadow remains off. Older disabled examples do not describe this candidate. Legacy fallback can still over-reject, and this is not a production cutover.
- No token-by-token frontend streaming, generic AgentHarness, multi-agent, background autonomy, knowledge graph or autonomous hardware authority is claimed.

Current implementation: `docs/current-architecture.md`. Current product status and dated evidence: `docs/先看这里.md`. Human-only checks: `docs/m7-final-human-acceptance-guide.md`. Maintenance decisions: ADR 0002/0004. M6/Phase reports and the archived long M7 report are historical snapshots, not current capability inventories.

## 5. File-Sizing Rules

If a file starts to do too many jobs, split it early:
- page UI state + data shaping -> extract to `*-state.js`
- API request wiring -> keep in `services/core/ScfApiAdapter.js`
- domain logic -> keep in `services/modules/*`
- backend route handlers -> keep in `dist/scf/*/index.js` until a real split is justified

Good split candidates are files that:
- mix transport and domain rules
- contain repeated transforms
- are hard to test without loading the whole page or SCF entry file

## 6. What Not To Assume

- `dist/` is not disposable build trash in this repo; it contains the SCF deployment source currently used by the project.
- A string in the UI is not always a presentation-only concern; some values are normalized by shared helpers first.
- A fallback that makes the UI look “not broken” is not necessarily the right production source of truth.
- A successful command dispatch does not mean the device executed it; command acknowledgment and device state are separate.
- A locally implemented M1-M6 route is not an online deployment. Verify deployment evidence before describing it as available in the experience version.

## 7. Minimal Mental Model For AI Work

When changing something, answer these questions first:
- What layer owns this behavior?
- What is the source of truth?
- What is the fallback?
- What is the verification step?

If you cannot answer those four questions, the change is probably too broad and should be split.

## 8. Encoding Guard

Deployment decision updated 2026-09-09: reuse LastScf SCF + MySQL, direct environment variables and independent Function URLs; images and documents use native WeChat CloudBase storage. This does not migrate business functions or databases to CloudBase. 

Cloud candidate ownership (2026-09-09): deployment/cloud-initial/overlays holds in-handler runtime checks and CloudBase media adapters; tools/migrate-database.mjs owns schema verification, tools/seed-reviewed-content.mjs explicitly seeds an empty reviewed library, and test-local-candidate.ps1 owns local-only rehearsal. Source business code still lives in dist/scf. The generated client is an isolated snapshot, not a second hand-maintained UI. See deployment/cloud-initial/README.md for evidence boundaries.

- Active source and current documentation use UTF-8 without BOM.
- `node scripts/check-ai-context.mjs` also reports common mojibake signatures in the active project boundary.
- The scan excludes archived content and `node_modules`; it complements, rather than replaces, reading edited Chinese back through the same UTF-8 toolchain.
