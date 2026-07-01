# MindAI Current Project Workflow Report

## 1. Executive Summary

This repository currently contains **two application generations**:

1. The **current active product path**: Angular frontend in `client/` + NestJS backend in `nest-app/`.
2. An **older root TypeScript/Express implementation** in `src/`.

For the workflow your team is using now, the important system is:

- Frontend: `client/`
- Backend API + AI orchestration: `nest-app/`
- MongoDB: source metadata, saved results, run history, agent config, memory items, cache
- LibSQL/SQLite: short-term conversation threads and messages

This report focuses on that current stack.

---

## 2. Current Runtime Architecture

### Frontend

- Angular standalone app bootstraps from [client/src/main.ts](/abs/path/client/src/main.ts) and mounts `AppComponent`.
- Main UI orchestration lives in [client/src/app/app.component.ts](/abs/path/client/src/app/app.component.ts).
- API calls are centralized in [client/src/app/analytics-api.service.ts](/abs/path/client/src/app/analytics-api.service.ts).
- Local UI/session state is held in [client/src/app/analytics-state.service.ts](/abs/path/client/src/app/analytics-state.service.ts).
- ECharts rendering is done by [client/src/app/chart-render.service.ts](/abs/path/client/src/app/chart-render.service.ts).

### Backend

- Nest app starts in [nest-app/src/main.ts](/abs/path/nest-app/src/main.ts).
- Top-level module wiring is in [nest-app/src/app.module.ts](/abs/path/nest-app/src/app.module.ts).
- Main business execution path is:
  - [nest-app/src/analytics/analytics.controller.ts](/abs/path/nest-app/src/analytics/analytics.controller.ts)
  - [nest-app/src/analytics/analytics.service.ts](/abs/path/nest-app/src/analytics/analytics.service.ts)
  - [nest-app/src/analytics/pipeline.service.ts](/abs/path/nest-app/src/analytics/pipeline.service.ts)

### Storage

- MongoDB collections:
  - `sources`
  - `prompt_cache`
  - `results_history`
  - `saved_results`
  - `user_settings`
  - `agent_config`
  - `memory_items`
- LibSQL/SQLite file:
  - `data/memory.db`
  - Used by [nest-app/src/session/memory.ts](/abs/path/nest-app/src/session/memory.ts) for conversation threads/messages

---

## 3. Startup Workflow

### Backend startup

At boot, [nest-app/src/main.ts](/abs/path/nest-app/src/main.ts) does the following:

1. Creates the Nest application.
2. Installs `AppLogger`.
3. Enables `helmet`.
4. Enables CORS from `ALLOWED_ORIGINS` if defined, otherwise open CORS.
5. Enables global validation with `ValidationPipe`.
6. Starts the HTTP server on `PORT` or `3000`.

### Module composition

[nest-app/src/app.module.ts](/abs/path/nest-app/src/app.module.ts) wires:

- `ConfigModule`
- `ScheduleModule`
- `MongooseModule`
- `SourcesModule`
- `HistoryModule`
- `CacheModule`
- `SavedResultsModule`
- `UserSettingsModule`
- `AnalyticsModule`
- `AgentConfigModule`

It also:

- installs `RequestIdMiddleware` for all routes
- installs `ApiKeyGuard` globally
- installs `AllExceptionsFilter` globally
- serves the built Angular app if `client/dist/mind-ui/browser/index.html` exists

### Health check

[nest-app/src/app.controller.ts](/abs/path/nest-app/src/app.controller.ts) exposes `/health`:

- pings MongoDB
- checks whether at least one source is loaded
- returns `503` if Mongo is unavailable or if zero sources are registered

---

## 4. Request and Logging Workflow

### Request ID

[nest-app/src/common/middleware/request-id.middleware.ts](/abs/path/nest-app/src/common/middleware/request-id.middleware.ts) assigns a UUID to every request through `AsyncLocalStorage`.

### Logging

[nest-app/src/common/logger/app.logger.ts](/abs/path/nest-app/src/common/logger/app.logger.ts):

- prefixes logs with timestamp
- includes request ID when available
- supports colored tags
- powers both standalone utility logging and the Nest logger

### API guard

[nest-app/src/common/guards/api-key.guard.ts](/abs/path/nest-app/src/common/guards/api-key.guard.ts):

- if `API_KEY` is not configured, requests are open
- if `API_KEY` is configured, requests must send `x-api-key`
- public routes include `/api/provider`, `/api/meta`, `/health`

### Global exception shaping

[nest-app/src/common/filters/all-exceptions.filter.ts](/abs/path/nest-app/src/common/filters/all-exceptions.filter.ts):

- normalizes errors to `{ error, code?, ...extraFields }`
- preserves structured extra fields like:
  - `currentLimit`
  - `suggestedLimit`
  - `agentApiKey`

This is important because the frontend token warning UI depends on those extra fields.

---

## 5. Frontend Workflow

### App initialization

`AppComponent.ngOnInit()` in [client/src/app/app.component.ts:176](/abs/path/client/src/app/app.component.ts:176) does this:

1. Creates or reuses `mind_user_id` in browser `localStorage`.
2. Loads personal settings.
3. Loads dataset meta.
4. Loads session history.
5. Loads saved results.
6. Loads long-term memory items.
7. Loads memory extraction config.
8. Loads agent config.

### UI state model

[client/src/app/analytics-state.service.ts](/abs/path/client/src/app/analytics-state.service.ts) stores:

- current mode: dashboard/report/inquiry
- prompt text
- phase: idle/loading/done/error
- current session ID
- message thread
- config sidebar state
- saved results
- memory items
- agent config
- pending report-format chooser
- pending token-limit confirmation

### Modes

The UI exposes three user-facing modes:

- `Dashboard`
- `Report`
- `Inquiry`

Mapped in [client/src/app/app.component.ts](/abs/path/client/src/app/app.component.ts) to backend intents:

- `dashboard -> dashboard`
- `report -> report`
- `inquiry -> general_question`

### Report mode special behavior

When the user clicks send in report mode, `run()` does **not** immediately call the backend.
Instead it opens a local format picker via `pendingSuggestion`, then `chooseReportFormat()` lets the user run:

- report only
- chart only
- both

This is a frontend product behavior, not a backend requirement.

### Chart rendering

The backend returns ECharts-compatible widget options.
The frontend does not rebuild charts logically; it simply renders returned options via [client/src/app/chart-render.service.ts](/abs/path/client/src/app/chart-render.service.ts).

---

## 6. Frontend API Surface

All client HTTP calls are centralized in [client/src/app/analytics-api.service.ts](/abs/path/client/src/app/analytics-api.service.ts).

Important endpoints used by the UI:

- `GET /api/meta`
- `GET /api/settings`
- `POST /api/settings/validate`
- `POST /api/settings`
- `PATCH /api/settings/token-limit`
- `DELETE /api/settings`
- `GET /api/agent-config`
- `PUT /api/agent-config`
- `PATCH /api/agent-config/token-limit`
- `POST /api/analytics`
- `GET /api/history/sessions`
- `GET /api/history/sessions/:id`
- `DELETE /api/history/sessions/:id`
- `GET /api/saved`
- `POST /api/saved`
- `DELETE /api/saved/:id`
- `GET /api/memory`
- `DELETE /api/memory`
- `GET /api/memory/config`
- `PATCH /api/memory/config`

All user-scoped endpoints send `X-User-Id`.

---

## 7. High-Level Backend Request Lifecycle

The main runtime request is `POST /api/analytics`.

### Step 1: Controller entry

[nest-app/src/analytics/analytics.controller.ts](/abs/path/nest-app/src/analytics/analytics.controller.ts):

- validates prompt length
- reads `x-user-id`
- forwards to `AnalyticsService.run()`

### Step 2: Load user and agent configuration

[nest-app/src/analytics/analytics.service.ts:241](/abs/path/nest-app/src/analytics/analytics.service.ts:241):

- loads personal user settings from `user_settings`
- loads shared agent config from `agent_config`

### Step 3: Resolve session and memory

The service:

1. resolves or creates the session thread
2. loads short-term conversation context from LibSQL
3. loads relevant long-term memory snippets from MongoDB
4. combines both into the LLM context

Code path:

- `resolveSession()` at [analytics.service.ts:447](/abs/path/nest-app/src/analytics/analytics.service.ts:447)
- `buildMemoryContext()` at [analytics.service.ts:492](/abs/path/nest-app/src/analytics/analytics.service.ts:492)
- session store functions in [nest-app/src/session/memory.ts](/abs/path/nest-app/src/session/memory.ts)

### Step 4: Resolve AI connection

`resolveAccess()` at [analytics.service.ts:417](/abs/path/nest-app/src/analytics/analytics.service.ts:417):

- if a personal key exists, it wins
- otherwise the backend picks an active agent
- it now prefers an active agent whose input limit can fit the estimated request

Connection source returned to the response is:

- `personal`
- or `agent`

### Step 5: Input token preflight

`estimateMinimumInputTokens()` at [analytics.service.ts:464](/abs/path/nest-app/src/analytics/analytics.service.ts:464):

- estimates prompt tokens
- estimates memory-context tokens
- adds fixed request overhead

If estimated input exceeds the selected connection's `inputTokenLimit`, backend raises `INPUT_TOKEN_LIMIT_TOO_LOW` before the LLM call.

### Step 6: Execute by intent

`executeByIntent()` routes to:

- `PipelineService.executeDashboard()`
- `PipelineService.executeReport()`
- `PipelineService.executeInquiry()`

### Step 7: Persist usage and response metadata

After success:

- increments token usage on agent or personal settings
- updates `lastInputTokens` for the selected agent
- returns:
  - result payload
  - input/output token usage
  - connection info
  - token warnings if limits were hit

### Step 8: Persist conversation and optionally memory

After response construction:

- saves user+assistant turn to LibSQL thread store
- optionally runs memory extraction if enabled

---

## 8. AI Execution Pipeline

### Core design

The backend uses **prompt-driven AI skills**, not separate backend services.
The execution chain is:

1. Planner skill: convert prompt -> task plan + Mongo pipeline
2. Mongo aggregation: execute pipeline against the selected collection
3. Formatter skill:
   - chart skill for dashboards
   - report writer for reports
   - inquiry writer for direct answers
4. Optional memory skill after response

### Skill files

The runtime prompt definitions are read from `skills/.../SKILL.md` via [nest-app/src/ai/skill-prompt.ts](/abs/path/nest-app/src/ai/skill-prompt.ts).

That means skills are not hardcoded only in TypeScript; part of their behavior lives in Markdown prompts.

---

## 9. Planner Workflow

### Planner entry

[nest-app/src/ai/planner.ts:227](/abs/path/nest-app/src/ai/planner.ts:227) defines `runSupervisorPlan()`.

It builds a structured plan containing:

- whether data is needed
- source name
- aggregation pipeline
- strategy
- chart hint
- whether a chart should accompany a report

### What the planner prompt contains

`buildSchemaSection()` in [planner.ts](/abs/path/nest-app/src/ai/planner.ts):

- enumerates every registered collection
- lists exact fields, types, roles, enums, sample values
- infers joins from `referenceTo`, descriptions, or name similarity
- adds copy-ready `$lookup` templates
- adds example pipeline templates
- adds raw-list template

This is why planner quality depends heavily on source metadata quality.

### Planner retry behavior

[nest-app/src/analytics/pipeline.service.ts:173](/abs/path/nest-app/src/analytics/pipeline.service.ts:173):

- planner gets up to 2 planning attempts
- second attempt receives a corrective hint when the first plan fails field validation or Mongo execution

Corrective hints explicitly cover:

- multi-operator invalid pipeline stages
- bad field names
- projection inclusion/exclusion conflicts
- incorrect date conversions
- bad enum casing

---

## 10. MongoDB Aggregation Workflow

### Aggregate entry

[nest-app/src/analytics/pipeline.service.ts:148](/abs/path/nest-app/src/analytics/pipeline.service.ts:148) is the core aggregation entry.

### Data source resolution

It resolves `plan.query.sourceName` against the in-memory source registry from [nest-app/src/sources/sources-cache.ts](/abs/path/nest-app/src/sources/sources-cache.ts).

### Pipeline normalization

Each stage must contain exactly one MongoDB operator key.
Non-operator decoration keys are stripped and warned on.

### Field validation

[pipeline.service.ts:343](/abs/path/nest-app/src/analytics/pipeline.service.ts:343) validates referenced fields against the declared source schema.

This is an important protection layer:

- planner may hallucinate fields
- runtime rejects pipelines that use undeclared fields

### Mongo execution

[pipeline.service.ts:397](/abs/path/nest-app/src/analytics/pipeline.service.ts:397):

- uses `db.collection(collection).aggregate(...)`
- enables `allowDiskUse`
- applies `maxTimeMS` from env or 30s

### Empty-row behavior

Current behavior is product-specific by intent:

- Dashboard: returns an empty dashboard state instead of throwing
- Report: returns a report section explaining no data was found
- Inquiry: may fall back to a generic “could not be answered” summary

---

## 11. Dashboard Workflow

### Entry

[nest-app/src/analytics/pipeline.service.ts:499](/abs/path/nest-app/src/analytics/pipeline.service.ts:499)

### Flow

1. Check full dashboard cache if there is no conversation context.
2. Aggregate rows through planner + Mongo pipeline.
3. If no chart skill is selected, fall back to inquiry behavior.
4. If zero rows, return an empty dashboard state.
5. Otherwise call `runChart()`.
6. Cache the full dashboard result.

### Chart skill

[nest-app/src/ai/chart.ts:273](/abs/path/nest-app/src/ai/chart.ts:273):

- asks LLM for structured dashboard/widget JSON
- sanitizes the option object
- injects dataset source rows when needed
- validates renderable signal
- supports table widgets
- logs unknown encode references

The frontend then renders those ECharts options directly.

---

## 12. Report Workflow

### Entry

[nest-app/src/analytics/pipeline.service.ts:540](/abs/path/nest-app/src/analytics/pipeline.service.ts:540)

### Flow

1. Check full report cache if no context.
2. Aggregate rows.
3. If planner says no report skill, return a `No Data` report section.
4. If rows are empty, return a `No Data` report section.
5. Call `runReportSkill()`.
6. If `wantChart` and enough rows, also call `runChart()`.
7. Merge report sections with optional chart payload.
8. Cache full report.

### Writer skill

[nest-app/src/ai/writer.ts:69](/abs/path/nest-app/src/ai/writer.ts:69):

- uses report runtime prompt from `skills/report/SKILL.md`
- returns structured `reportSections`
- supports a “withChart” hint to reduce redundant prose when a chart will also be shown

---

## 13. Inquiry Workflow

### Entry

[nest-app/src/analytics/pipeline.service.ts:568](/abs/path/nest-app/src/analytics/pipeline.service.ts:568)

### Flow

1. Aggregate rows.
2. If planner selected inquiry, call `runInquirySkill()`.
3. If no usable execution path remains, return:
   - `The request could not be answered from the available sources.`

### Inquiry skill

[nest-app/src/ai/writer.ts:42](/abs/path/nest-app/src/ai/writer.ts:42):

- takes question + capped rows
- returns one structured summary string

---

## 14. Source and Meta Workflow

### Source registry

[nest-app/src/sources/sources.service.ts](/abs/path/nest-app/src/sources/sources.service.ts):

- loads sources on module init
- caches them in memory
- allows source registration/removal through API

### Meta endpoint

`GET /api/meta` in [nest-app/src/sources/sources.controller.ts](/abs/path/nest-app/src/sources/sources.controller.ts):

- generates prompt suggestions from currently loaded sources
- these suggestions are dynamic, not hardcoded

This is how the frontend example chips are populated.

---

## 15. Personal Key Workflow

### Storage

Personal settings are stored in `user_settings` via:

- [nest-app/src/user-settings/user-settings.repository.ts](/abs/path/nest-app/src/user-settings/user-settings.repository.ts)

Fields include:

- `userId`
- `apiKey`
- `provider`
- `model`
- `responseTokenLimit`
- legacy-compatible `inputTokenLimit`
- cumulative token usage

### Validation

[nest-app/src/user-settings/user-settings.service.ts:68](/abs/path/nest-app/src/user-settings/user-settings.service.ts:68):

- normalizes provider/model/key
- validates provider existence
- performs provider API key validation request

### Model list behavior

Current model dropdowns are **static curated lists** from [nest-app/src/ai/model.ts:31](/abs/path/nest-app/src/ai/model.ts:31), exposed by `POST /api/settings/models`.

This means:

- model lists no longer depend on a live provider fetch for the dropdown
- validation still checks the key against the provider

---

## 16. Shared Agent Workflow

### What an agent means in this project

An “agent” here is a **shared saved AI connection entry**, not a separate autonomous AI worker.

Each agent stores:

- provider
- model
- api key
- input token limit
- output token limit
- cumulative input usage
- cumulative output usage
- last successful request input size
- status

Schema: [nest-app/src/agent-config/agent-config.repository.ts](/abs/path/nest-app/src/agent-config/agent-config.repository.ts)

### Status meanings

- `active`: eligible for selection
- `idle`: temporarily rate-limited
- `disabled`: manually turned off
- `expired`: invalid key, model failure, or quota exhaustion

### Selection logic

[nest-app/src/analytics/analytics.service.ts:417](/abs/path/nest-app/src/analytics/analytics.service.ts:417):

- personal key takes priority if present
- otherwise backend filters active agents
- prefers an active agent whose input limit can fit the estimated request
- otherwise falls back to the first remaining active agent

### Save behavior

`PUT /api/agent-config` in [agent-config.controller.ts:54](/abs/path/nest-app/src/agent-config/agent-config.controller.ts:54):

1. saves the config document
2. immediately probes every non-disabled saved agent
3. returns refreshed config

That immediate probe is why statuses may change right after save.

### Runtime failover

During a request, [analytics.service.ts:241](/abs/path/nest-app/src/analytics/analytics.service.ts:241) can fail over between agents when:

- key is invalid -> mark `expired`, try next
- model is not found -> mark `expired`, try next
- provider is rate-limited:
  - permanent exhaustion -> `expired`
  - temporary rate limit -> `idle`
  - then try next active agent

If no agent remains, backend returns `NO_ACTIVE_CONNECTION`.

---

## 17. Cron and Agent Health Workflow

### Cron schedule

[nest-app/src/agent-config/agent-health.service.ts:54](/abs/path/nest-app/src/agent-config/agent-health.service.ts:54)

Runs every 5 minutes:

- `@Cron('*/5 * * * *')`

### What it checks

For each non-disabled agent:

1. builds a provider-specific model-list or validation request
2. sends a probe to the provider
3. marks:
   - `active` if probe is considered healthy
   - `expired` if auth failure or permanently exhausted quota is detected

### Important current behavior

The cron currently treats some cases as **best effort / optimistic**:

- provider `404` or `500` does not expire the agent
- model-not-in-list does **not** expire the agent; it only logs a warning
- temporary provider failures do not necessarily disable the agent

This means a card can still say `active` even if the next real generation call later fails for provider-side reasons.

---

## 18. Token Workflow

This is one of the most important parts of the current system.

### Token dimensions used by the app

There are two separate concepts:

1. **Input token limit**
   - how large the request sent to the model can be
   - relevant mainly for agent connections
2. **Output/response token limit**
   - how many tokens the model is allowed to generate back
   - relevant for both personal and agent connections

### Personal key token settings

Personal settings use `responseTokenLimit` as the main field.
For backward compatibility, backend also mirrors it to `inputTokenLimit`.

### Agent token settings

Each agent stores:

- `inputTokenLimit`
- `outputTokenLimit`
- `inputTokensUsed`
- `outputTokensUsed`
- `lastInputTokens`

### Input preflight

[analytics.service.ts:264](/abs/path/nest-app/src/analytics/analytics.service.ts:264):

- estimates minimum request size from current prompt + memory context + base overhead
- compares that against selected agent input limit
- also compares against `lastInputTokens` from the previous successful call
- if too small, throws `INPUT_TOKEN_LIMIT_TOO_LOW`

This is smarter than the older behavior because it no longer waits for a second request to detect an obviously impossible input limit.

### Output limit execution

The selected connection's output limit is sent into the LLM call as `maxTokens` / `maxOutputTokens`.

This limit then gets further clamped per stage:

- planner fallback cap: `PLANNER_MAX_TOKENS`
- chart fallback cap: `CHART_MAX_TOKENS`
- inquiry fallback cap: `INQUIRY_MAX_TOKENS`
- report writer fallback cap: `REPORT_MAX_TOKENS`

So the effective token allowance is:

- connection output limit
- then stage-specific cap if lower

### Post-call warnings

[analytics.service.ts:538](/abs/path/nest-app/src/analytics/analytics.service.ts:538):

- if output tokens reached the configured output limit, response includes `tokenLimitExceeded` and `outputLimitWarning`
- if actual input tokens exceeded input limit, response includes `inputLimitWarning`

This is why a successful answer can still come back with a warning card asking to raise limits.

### Usage accounting

After a successful response:

- agent mode:
  - increment `inputTokensUsed`
  - increment `outputTokensUsed`
  - set `lastInputTokens`
- personal mode:
  - increment `user_settings.inputTokensUsed`
  - increment `user_settings.outputTokensUsed`

Memory extraction tokens are also charged back to the same active connection source.

---

## 19. Frontend Token UX Workflow

### Error-triggered token dialog

If backend throws:

- `TOKEN_LIMIT_TOO_LOW`
- or `INPUT_TOKEN_LIMIT_TOO_LOW`

Frontend builds a pending token confirmation card through:

- `buildTokenConfirm()` in [client/src/app/app.component.ts:500](/abs/path/client/src/app/app.component.ts:500)

### Success-triggered token dialog

If the request succeeds but includes:

- `tokenLimitExceeded`
- or `inputLimitWarning`

Frontend uses:

- `buildPostCallConfirm()` in [client/src/app/app.component.ts:515](/abs/path/client/src/app/app.component.ts:515)

### User actions available now

Current token warning card supports:

- `Apply limit`
- `Apply & Retry`
- `Open Config`
- `Dismiss`
- `Keep partial response`

Application logic is in:

- `confirmMaximizeTokens()` at [client/src/app/app.component.ts:874](/abs/path/client/src/app/app.component.ts:874)
- `openConfigTab()` at [client/src/app/app.component.ts:690](/abs/path/client/src/app/app.component.ts:690)

### Automatic limit application

When user chooses apply:

- personal connection -> `PATCH /api/settings/token-limit`
- agent connection -> `PATCH /api/agent-config/token-limit`

Then:

- retry happens for output-limit errors
- only configuration is updated for post-success input warnings unless retry is needed

---

## 20. Memory Workflow

The project uses **two memory layers**.

### Short-term conversation memory

[nest-app/src/session/memory.ts](/abs/path/nest-app/src/session/memory.ts):

- stores sessions/threads/messages in LibSQL
- keeps conversation continuity
- powers history sidebar and contextual follow-ups

Used functions:

- `ensureThread()`
- `getMemoryContext()`
- `saveConversationTurn()`
- `listSessions()`
- `getSessionDetail()`
- `deleteSession()`

### Long-term extracted memory

[nest-app/src/memory/memory.service.ts](/abs/path/nest-app/src/memory/memory.service.ts):

- retrieves relevant stored memory snippets before a request
- optionally extracts new memory items after a response

Extraction is done by:

- [nest-app/src/ai/memory-skill.ts](/abs/path/nest-app/src/ai/memory-skill.ts)

Storage is in MongoDB:

- [nest-app/src/memory/memory.repository.ts](/abs/path/nest-app/src/memory/memory.repository.ts)

### Toggle behavior

`MEMORY_EXTRACTION_ENABLED=false` disables extraction at startup.
The frontend can also toggle extraction at runtime using `/api/memory/config`.

Even when extraction is disabled:

- existing memory items remain visible
- retrieval can still occur from already-stored items

---

## 21. Cache Workflow

### Prompt cache

[nest-app/src/cache/cache.service.ts](/abs/path/nest-app/src/cache/cache.service.ts):

- caches aggregation results by normalized prompt + intent hash
- TTL is 7 days
- cache key is SHA-256 truncated to 24 chars

### Cache usage rules

Cache is used mainly when:

- no conversation context is present

This avoids reusing cached answers for follow-up prompts that depend on session memory.

### Full-result caches

`PipelineService` also uses full-result caches for:

- `dashboard:full`
- `report:full`

These skip repeated LLM work for identical context-free prompts.

---

## 22. History and Saved Result Workflow

### Pipeline run history

[nest-app/src/history/results-history.repository.ts](/abs/path/nest-app/src/history/results-history.repository.ts):

- stores executed prompt
- intent
- Mongo collection
- aggregation pipeline
- rows
- row count
- duration

This is a technical execution history.

### Conversation history

LibSQL session history in [nest-app/src/session/memory.ts](/abs/path/nest-app/src/session/memory.ts):

- stores user and assistant turns
- powers the left “History” tab

### Saved results

[nest-app/src/saved-results/saved-results.controller.ts](/abs/path/nest-app/src/saved-results/saved-results.controller.ts):

- lets users bookmark results they want to keep
- saved items are user-scoped
- stored separately from raw history

This is a product-layer saved view, not just technical logging.

---

## 23. Error and Recovery Behavior

### Backend recoveries

Current backend has several graceful behaviors:

- drops oldest memory context if provider rejects request due to context length
- retries planner once with corrective hint when pipeline fails
- retries provider calls on short-term rate limits in `withRateLimitRetry()`
- fails over across active agents at runtime
- returns friendly empty states for dashboard/report no-data scenarios

### Backend hard failures

Important hard-stop cases include:

- invalid personal API key
- no active connection available
- input limit too low
- output limit too low
- unsupported structured-output model

### Frontend recoveries

Frontend reacts by:

- refreshing agent config after failures
- opening config when no connection exists
- offering limit-raise actions
- showing result footer connection info so user can see which key/model answered

---

## 24. Provider and Model Workflow

### Supported providers

Defined in [nest-app/src/ai/model.ts](/abs/path/nest-app/src/ai/model.ts):

- OpenAI
- Anthropic
- Google Gemini
- Groq
- Mistral
- Together AI
- Perplexity

### Model resolution

`resolveModel()` in [nest-app/src/ai/model.ts](/abs/path/nest-app/src/ai/model.ts):

- requires API key
- requires provider
- requires model
- builds correct SDK client per provider

### Provider-specific compatibility fixes

[nest-app/src/ai/model.ts](/abs/path/nest-app/src/ai/model.ts) includes important runtime compatibility patches:

- OpenAI-compatible fetch wrapper rewrites `developer` role to `system` for some providers
- `skillProviderOptions()` disables Groq strict structured output mode when needed
- short-term 429 rate limits are retried with delay handling

---

## 25. Known Product Behaviors the Team Should Know

### 1. Personal key has priority over agents

If a valid personal key exists, backend uses it before shared agents.

### 2. Agent “active” does not guarantee the next request succeeds

Cron health is optimistic in some cases.
A provider can still reject the real generation call later.

### 3. Skills are prompt-based, not deterministic business rules

The planner, report writer, inquiry writer, and memory extractor all rely partly on Markdown prompt files in `skills/`.

### 4. Source metadata quality controls AI quality

If fields, enums, roles, descriptions, and references are weak, planning quality drops.

### 5. Dashboard/report empty responses are now intentionally user-friendly

The app no longer treats every zero-row result as a raw backend failure.

### 6. Token behavior is intentionally advisory as well as blocking

The app can return:

- a valid response
- plus a warning asking the user to raise limits

That is expected behavior, not necessarily a bug.

---

## 26. End-to-End Example: Dashboard Request

1. User types prompt in Angular UI.
2. `AppComponent.run()` sends `POST /api/analytics`.
3. Backend loads settings + agent config.
4. Backend resolves session and memory context.
5. Backend picks personal key or active agent.
6. Backend performs input token preflight.
7. Planner skill creates `TaskPlan`.
8. Pipeline service validates and executes Mongo aggregation.
9. Chart skill generates dashboard widget plan.
10. Backend returns dashboard + token usage + connection info.
11. Frontend stores the message.
12. ECharts renders widgets.
13. Backend asynchronously saves conversation turn.
14. Backend may extract long-term memory.
15. Backend increments token usage counters.

---

## 27. End-to-End Example: Report Request

1. User chooses `Report`.
2. Frontend first opens local format chooser.
3. User selects report, chart, or both.
4. Frontend makes one or two `/api/analytics` calls depending on choice.
5. Backend aggregates rows.
6. Report writer returns structured sections.
7. Optional chart skill also runs.
8. Frontend merges and displays combined result.
9. If token warnings are present, token confirmation card appears.

---

## 28. End-to-End Example: Inquiry Request

1. User sends direct data question.
2. Backend aggregates rows through planner.
3. Inquiry writer summarizes rows into one answer.
4. If planner or data cannot support an answer, fallback summary is returned.

---

## 29. Legacy Layer Note

The repo root still contains an older Express-based implementation under `src/`, documented by files like:

- [README.md](/abs/path/README.md)
- [HOW_IT_WORKS.md](/abs/path/HOW_IT_WORKS.md)
- [src/server.ts](/abs/path/src/server.ts)

That layer is useful for historical reference, but the **current workflow in use now is the Nest app plus Angular client**.

When explaining the current system to the team, do not mix the old Express flow with the active Nest flow unless you are specifically discussing migration history.

---

## 30. Recommended Team Mental Model

The cleanest way to explain the current project is:

1. **Frontend is a conversation-driven analytics UI.**
2. **Nest backend is the orchestrator.**
3. **The planner skill converts user language into a safe Mongo pipeline.**
4. **MongoDB is the source of truth for data and most app persistence.**
5. **Writer/chart/memory skills transform rows into product-friendly outputs.**
6. **Personal keys and shared agents are two alternative connection sources.**
7. **Token limits, health probes, and failover are product controls around the LLM layer.**

If the team keeps those 7 ideas in mind, the rest of the codebase becomes much easier to navigate.
