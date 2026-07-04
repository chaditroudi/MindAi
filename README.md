# MindAi

MindAi turns a plain-language question into a MongoDB query and a finished answer — a dashboard of charts, a written report, or a one-line factual answer. Someone (a user, or another system) asks *"top 5 projects by budget"*, and the backend figures out which collection to query, builds and runs a MongoDB aggregation pipeline, and formats the result. No manual query-building, no fixed report templates, no hardcoded chart types.

> **Active codebase — read this first.** The real, running application is **[`nest-app/`](nest-app/)** (NestJS API) and **[`client/`](client/)** (Angular UI). The `src/` folder at the repo root is an earlier standalone Mastra/Express prototype and **is not used** — do not build on it, and do not trust `ARCHITECTURE.md`, `HOW_IT_WORKS.md`, or `PROJECT_WORKFLOW_REPORT.md` at the repo root, which document that old prototype (different framework, different file layout, different LLM provider). This README describes the current system end-to-end and supersedes those three files.

## Quick Reference

| | |
|---|---|
| **Backend** | `nest-app/` — NestJS 11 + Mongoose, port `3000` |
| **Frontend** | `client/` — Angular 21, proxies to the backend in dev |
| **Primary datastore** | MongoDB (data sources, cache, history, settings, memory, agents) |
| **Conversation memory** | LibSQL/SQLite file at `./data/memory.db` |
| **Main endpoint** | `POST /api/analytics` — `{ prompt, intent?, sessionId? }` |
| **LLM calls per request** | 2 (planner + writer/chart), 0 on a cache hit |
| **Supported LLM providers** | OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together, Perplexity |
| **Auth model** | Optional shared `x-api-key`; per-request `x-user-id` is **not verified** (see [§15](#15-security-model--trust-boundaries)) |
| **Run backend** | `cd nest-app && npm run start:dev` |
| **Run frontend** | `cd client && npm start` |
| **Run backend tests** | `cd nest-app && npm run test` |

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [Architecture](#4-architecture)
5. [Backend Modules (nest-app/src)](#5-backend-modules-nest-appsrc)
6. [AI Pipeline in Detail](#6-ai-pipeline-in-detail)
7. [Data Model — MongoDB Collections](#7-data-model--mongodb-collections)
8. [API Reference](#8-api-reference)
9. [Examples — Prompts, Requests & Responses](#9-examples--prompts-requests--responses)
10. [Frontend (client/)](#10-frontend-client)
11. [Getting Started](#11-getting-started)
12. [Configuration Reference](#12-configuration-reference)
13. [Error Handling & Resilience](#13-error-handling--resilience)
14. [Testing](#14-testing)
15. [Security Model & Trust Boundaries](#15-security-model--trust-boundaries)
16. [Background Jobs](#16-background-jobs)
17. [Deployment](#17-deployment)
18. [Error Response Format](#18-error-response-format)
19. [Common Workflows](#19-common-workflows)
20. [Glossary](#20-glossary)
21. [Troubleshooting](#21-troubleshooting)
22. [Contributing](#22-contributing)

---

## 1. What It Does

A client sends a natural-language prompt to `POST /api/analytics`. The backend classifies (or is told) the **intent** and returns one of three shapes:

| Intent | Output type | Example prompt | What comes back |
|---|---|---|---|
| `dashboard` | `DashboardSpec` | *"show projects by status"* | One or more ECharts-ready chart widgets + a title/summary |
| `report` | `ReportResult` | *"analyze infrastructure projects"* | 1–5 narrative sections (`{ heading, body }`), optionally with a chart |
| `inquiry` | `InquiryResult` | *"how many projects are active?"* | A short factual `summary` string |

If `intent` is omitted, the same pipeline is still run generically (`PipelineService.execute()`) and dispatches based on whatever skills the planner decided the prompt needs.

Everything is driven by **data sources** registered at runtime (`POST /api/sources`): a MongoDB collection plus a field schema (name, type, role, enum values, references to other sources). The LLM is only ever shown field names that exist in a registered source's schema, and any pipeline stage referencing an unregistered field is rejected before it ever reaches MongoDB — this is the single biggest design decision in the codebase, because it turns "LLM hallucinates a field name" from a runtime bug into a caught, retryable validation error.

Full worked examples of every intent — request bodies and complete JSON responses, including real ECharts chart options — are in [§9](#9-examples--prompts-requests--responses).

## 2. Repository Layout

```
MindAi/
├── nest-app/                    ← THE BACKEND (NestJS + MongoDB). All backend work happens here.
│   ├── src/
│   │   ├── ai/                  ← LLM orchestration: planner, chart builder, writer, model client
│   │   │   ├── model.ts             resolveModel(), provider adapters, rate-limit retry
│   │   │   ├── planner.ts           LLM call #1 — builds the MongoDB pipeline (TaskPlan)
│   │   │   ├── chart.ts             LLM call #2 (dashboard) — builds DashboardSpec widgets
│   │   │   ├── writer.ts            LLM call #2 (report/inquiry) — narrative output
│   │   │   ├── memory-skill.ts      extracts long-term memories from a finished turn
│   │   │   ├── skill-prompt.ts      loads prompt sections from skills/*/SKILL.md
│   │   │   ├── token.ts             TokenUsage add/zero helpers
│   │   │   └── chart-results.repository.ts   audit log of generated dashboards
│   │   ├── analytics/            ← top-level orchestration
│   │   │   ├── analytics.controller.ts   POST /api/analytics, GET /api/provider
│   │   │   ├── analytics.service.ts      access resolution, session/memory, error classification
│   │   │   └── pipeline.service.ts       plan → validate → execute → dispatch skill
│   │   ├── sources/               ← registered dataset schemas (Mongo-backed, cached in memory)
│   │   ├── history/                ← past pipeline runs + conversation sessions
│   │   ├── cache/                  ← prompt→result cache (MongoDB, 7-day TTL)
│   │   ├── saved-results/          ← user-pinned dashboards/reports/inquiries
│   │   ├── user-settings/          ← per-user "bring your own API key" config
│   │   ├── agent-config/           ← shared/fallback AI connections ("agents") + health checks
│   │   ├── memory/                 ← long-term per-user memory extraction (opt-in)
│   │   ├── session/memory.ts       ← LibSQL-backed conversation memory (short-term, per session)
│   │   ├── config/configuration.ts ← typed env var loader
│   │   ├── common/                 ← guards, filters, middleware, logger, helpers
│   │   ├── types/index.ts          ← shared TypeScript interfaces (DataSource, TaskPlan, DashboardSpec…)
│   │   ├── prompts/index.ts        ← builds inquiry/report/chart user messages from rows
│   │   ├── app.module.ts           ← wires every module, Mongo connection, static Angular serving
│   │   └── main.ts                 ← bootstrap: helmet, CORS, validation pipe, shutdown hooks
│   └── test/                      ← e2e tests (Jest)
│
├── client/                      ← THE FRONTEND (Angular 21 + ECharts + Tailwind)
│   └── src/app/                 ← flat, single-view SPA (see §10)
│
├── skills/                      ← Markdown "skill" prompt files consumed by nest-app/src/ai
│   ├── aggregation/SKILL.md         planner system prompt + pipeline-stage semantics config
│   ├── chart/SKILL.md               chart-widget system prompt (full ECharts authoring contract)
│   ├── writer/SKILL.md, report/SKILL.md, inquiry/SKILL.md   writer system prompts
│   ├── memory/SKILL.md              memory-extraction system prompt
│   ├── analytics/SKILL.md, suggestions/SKILL.md   supporting prompt text
│
├── src/                         ← LEGACY prototype (Mastra + Express). Not used — do not build on this.
├── ARCHITECTURE.md, HOW_IT_WORKS.md, PROJECT_WORKFLOW_REPORT.md
│                                ← LEGACY docs describing the src/ prototype above. Superseded by this README.
│
├── data/                        ← local SQLite (LibSQL) memory store, gitignored
└── scripts/                     ← seed/reset scripts for the legacy prototype only
```

## 3. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Backend framework | NestJS 11 (Express platform) | Modules per feature area; see [`nest-app/package.json`](nest-app/package.json) |
| Database | MongoDB via Mongoose (`@nestjs/mongoose`) | One connection; every module injects its own model |
| Conversation memory | `@mastra/memory` + `@mastra/libsql` | Local SQLite file, `./data/memory.db` — the only piece of the old Mastra stack still in active use |
| LLM access | Vercel AI SDK (`ai`) + `@mastra/core` `Agent` | One `Agent` instance created per call, per role (`supervisor`, `writer`, `chart`, `memory`) |
| Provider adapters | `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq` | Mistral / Together / Perplexity ride the OpenAI-compatible adapter with a custom `fetch` |
| Structured LLM output | `zod` schemas passed as `structuredOutput` on every agent call | Guarantees the shape of `TaskPlan`, `DashboardSpec`, report sections, etc. |
| Charting | ECharts, authored directly by the chart LLM (see [§6](#6-ai-pipeline-in-detail) and [§9](#9-examples--prompts-requests--responses)) | The model designs the full `option` object; the runtime only sanitizes and injects live row data |
| Validation | `class-validator` / `class-transformer` | Applied globally via `ValidationPipe({ whitelist: true, transform: true })` |
| Scheduling | `@nestjs/schedule` | Two cron jobs in `agent-config` (see [§16](#16-background-jobs)) |
| Security | `helmet`, optional `x-api-key` guard, CORS allow-list | See [§15](#15-security-model--trust-boundaries) for the gaps |
| Frontend | Angular 21 (standalone components, no NgModules) | Tailwind CSS for styling, ECharts for rendering |

## 4. Architecture

```mermaid
flowchart TD
    U[Client / Angular UI] -->|POST /api/analytics| AC[AnalyticsController]
    AC --> AS[AnalyticsService]
    AS -->|resolve API key| US[UserSettingsService]
    AS -->|fallback pool| ACFG[AgentConfigService]
    AS -->|short-term memory| SM[session/memory.ts — LibSQL]
    AS -->|long-term memory| MEM[MemoryService]
    AS --> PS[PipelineService]
    PS -->|LLM call 1| PLAN[ai/planner.ts]
    PLAN --> MDB[(MongoDB)]
    PS --> MDB
    PS -->|LLM call 2| CHART[ai/chart.ts]
    PS -->|LLM call 2| WRITE[ai/writer.ts]
    PS -->|cache read/write| CACHE[(prompt_cache)]
    PS -->|fire-and-forget| HIST[(results_history)]
    AS -->|persist turn| SM
    AS -->|extract memories| MEM
    MEM --> MDB
    ACFG --> MDB
    US --> MDB
```

### Request sequence — dashboard, cache miss

```mermaid
sequenceDiagram
    participant C as Client
    participant AC as AnalyticsController
    participant AS as AnalyticsService
    participant PS as PipelineService
    participant P as planner.ts (LLM #1)
    participant DB as MongoDB
    participant CH as chart.ts (LLM #2)

    C->>AC: POST /api/analytics {prompt, intent:"dashboard"}
    AC->>AS: run(req)
    AS->>AS: resolve API key / agent, load memory context
    AS->>PS: executeDashboard(prompt, context, opts)
    PS->>PS: cache lookup (miss)
    PS->>P: runSupervisorPlan()
    P-->>PS: TaskPlan {pipeline, strategy, chartHint}
    PS->>PS: validate pipeline fields & stages
    PS->>DB: aggregate(pipeline)
    DB-->>PS: rows[]
    PS->>PS: cache.setCached() + history.save() (fire-and-forget)
    PS->>CH: runChart(rows, prompt, strategy, chartHint)
    CH-->>PS: DashboardSpec
    PS-->>AS: {result, usage}
    AS->>AS: persist turn, extract memory, track usage
    AS-->>C: {intent:"dashboard", chart, sessionId, messageId, inputTokens, outputTokens}
```

Two LLM calls per request (planner + writer/chart) is the norm. The **prompt cache** (SHA-256 of `intent:prompt`, 7-day TTL) can skip both LLM calls entirely when there is no active conversation context — see [§7](#7-data-model--mongodb-collections) for the exact cache document shape.

## 5. Backend Modules (nest-app/src)

| Module | Responsibility |
|---|---|
| **`ai/`** | `model.ts` resolves a `LanguageModel` for a given provider/model/API key and wraps calls with rate-limit retry; `planner.ts` builds the MongoDB pipeline (LLM call #1); `chart.ts` turns rows into `DashboardSpec` widgets; `writer.ts` turns rows into report sections or an inquiry summary; `memory-skill.ts` extracts long-term memories from a finished response; `skill-prompt.ts` loads prompt text from `skills/*/SKILL.md`; `token.ts` tracks input/output token usage; `chart-results.repository.ts` logs every generated dashboard for audit/debugging. |
| **`analytics/`** | `AnalyticsController` (`/api/analytics`, `/api/provider`) is the single public entry point. `AnalyticsService` resolves which AI connection to use, manages sessions/memory, classifies and reacts to provider errors (invalid key, rate limit, context-too-long, truncated output, unsupported structured output, model not found), tracks token usage, and shapes the final response. `PipelineService` is the actual query+format engine. |
| **`sources/`** | Data source (dataset) registry: MongoDB-backed CRUD (`SourcesService` / `Source` schema) plus an in-memory cache (`sources-cache.ts`) refreshed on every register/remove so the hot analytics path never hits the DB for schema lookups. |
| **`history/`** | Read/query past aggregation runs (`results_history`) and conversation sessions (delegates session logic to `session/memory.ts`). |
| **`cache/`** | SHA-256 `intent:prompt` → cached `{plan, rows, usage}` (or full dashboard/report), stored in MongoDB with a 7-day TTL index; endpoints to list/clear entries. |
| **`saved-results/`** | Lets a user pin a dashboard/report/inquiry result under a title for later retrieval, scoped by the `x-user-id` header. |
| **`user-settings/`** | Per-user "bring your own API key" configuration: provider, model, token limits, usage counters; validates a key/provider/model combination live against the provider before saving. |
| **`agent-config/`** | A pool of shared fallback AI connections ("agents") used when a user has no personal key configured. Tracks per-agent status (`active`/`disabled`/`expired`/`idle`), cooldowns after rate limits, and usage; `AgentHealthService` periodically re-probes each provider. |
| **`memory/`** | Opt-in long-term memory: extracts durable facts (goal, insight, preference, context, decision, entity, correction) from a conversation turn and retrieves the most relevant ones for future prompts, scoped per user. |
| **`session/memory.ts`** | Short-term, per-session conversation memory backed by a local LibSQL/SQLite file — a functional store (not a Nest module/service) used directly by `AnalyticsService`. |
| **`common/`** | `ApiKeyGuard` (optional global `x-api-key` auth, with `/health`, `/api/meta`, `/api/provider`, `/api/key*` as public exceptions), `RequestIdMiddleware` (per-request UUID via `AsyncLocalStorage`), `AllExceptionsFilter` (normalizes every error response), structured `AppLogger`, `requireUserId()` helper. |

## 6. AI Pipeline in Detail

### Planner (`ai/planner.ts`) — LLM call #1

Builds the *"YOUR DATABASE SCHEMA"* section of the system prompt from every registered `DataSource`: field names, types, roles, enum/sample values, detected foreign-key references (`resolveReference()` — matches an explicit `referenceTo`, a description hint, or a name/collection prefix match), and ready-to-copy `$lookup`/`$group`/count/sum pipeline templates per collection. The model must return a `TaskPlan`:

```jsonc
{
  "needsData": true,
  "query": { "sourceName": "Projects" },
  "pipeline": [ /* MongoDB aggregation stages, one operator per stage */ ],
  "strategy": "standard",     // dashboard only: standard | trend | comparison | anomaly | overview
  "chartHint": "ranking"      // dashboard only — free-form hint consumed by chart.ts
}
```

`buildPlanSchema(intent)` (Zod) enforces: exactly one `$`-prefixed operator key per pipeline stage, `strategy` restricted to `PLANNER_STRATEGIES` (`standard | trend | comparison | anomaly | overview`), and intent-specific shape (dashboard requires `strategy`/`chartHint`; report adds `wantChart`). `finalizeTaskPlan()` then normalizes `sourceName` against the actual registered source list and derives `skills[]` (`deriveExecutionSkills()`) from `needsData` + `intent`.

`PipelineService.runWithRetry()` (in `pipeline.service.ts`) validates the plan further — no forbidden stages (`$function`, `$merge`, `$out`, `$where`, `$eval`, loaded from `skills/aggregation/SKILL.md`'s `Pipeline Config` section), only known field references (`validatePipelineFields()`) — and retries **once** with a targeted correction hint if validation or the MongoDB execution itself fails. The hint text is built specifically for the failure class, for example:

| Failure pattern detected | Hint given back to the LLM |
|---|---|
| Stage has 0 or >1 `$`-operator keys | "Each pipeline item must be exactly one MongoDB stage object like `{ "$match": {...} }`…" |
| `$convert` to date without `onError`/`onNull` | "…always use `$convert` with `onError: null` and `onNull: null`…" |
| Mixed inclusion/exclusion in `$project` | "…add a separate `$unset` stage BEFORE `$project` to remove the joined `_id`…" |
| Date operator (`$year`, `$dateToString`, …) on an integer field | Names the exact field(s) stored as integers and says not to use date operators on them |
| Pipeline returned 0 rows but a `$match` used a string literal | "…enum values use exact casing from schema allowed values" |

If both attempts fail, `aggregate()` throws — the analytics layer surfaces this as a generic 500 unless it matches one of the classified error types in [§13](#13-error-handling--resilience).

### Chart builder (`ai/chart.ts`) — LLM call #2 (dashboard, and report when `wantChart`)

Unlike the planner, the chart LLM is **not** filling in a fixed template — per `skills/chart/SKILL.md` it is instructed to author a *complete, arbitrary ECharts `option` object* (bar/line/area/scatter/pie/funnel/radar/heatmap, stacked/dual-axis/multi-series, `dataset`+`encode`, `visualMap`, `markLine`, etc.), or to fall back to `type: "table"` with a `columns[]` list when a raw table is clearly better than a chart. The only hard constraints:

- **No live data required from the model.** The model may omit `option.dataset.source` entirely — `attachDatasetSource()` injects the real MongoDB rows into `dataset.source` (or wraps a bare `series[].data`-free option in `{ dataset: { source: rows }, ...option }`) after generation, so the LLM never has to transcribe row values into its response.
- **Widget count** is capped at `CHART_MAX_WIDGETS` (default 4); each widget needs a `title`, and either a non-empty `option` or `type: "table"`.
- **Size/depth guard.** The returned option is walked by `sanitizeJson()`, which drops anything past `CHART_JSON_MAX_DEPTH` (default 20) or once `CHART_JSON_MAX_PROPERTIES` (default 8,000) values have been counted — a guard against a runaway or adversarial LLM response ballooning the response payload.
- **Renderability check.** `hasRenderableSignal()` drops any widget whose sanitized option has none of the known ECharts top-level keys (`series`, `dataset`, `graphic`, `geo`, etc.) — an empty or decorative-only option never reaches the client.
- **Heatmap safety net.** If a `heatmap` series exists with no `visualMap`, `ensureHeatmapVisualMap()` computes a `min`/`max` continuous `visualMap` from the actual row values so the heatmap isn't rendered uncolored.
- `strategy` and `chartHint` from the plan are advisory, not mandatory — the skill prompt explicitly tells the model to reconcile an infeasible hint (e.g. `scatter` requested but only one numeric field exists) against what the actual data supports, silently choosing the best fit.

See [§9](#9-examples--prompts-requests--responses) for full, realistic `option` payloads (bar, donut/pie, dual-axis line+bar, and table widgets).

### Writer (`ai/writer.ts`) — LLM call #2 (report/inquiry)

`runInquirySkill` returns a 1–3 sentence `{ summary }` (max `INQUIRY_MAX_TOKENS`, sees at most `INQUIRY_MAX_ROWS` rows). `runReportSkill` returns 1–5 `{ heading, body }` sections (max `REPORT_MAX_TOKENS`), optionally paired with a chart when `withChart` is set (report intent + chart skill + ≥2 rows). Row data sent to either is character-capped at `WRITER_MAX_CHARS` by `prompts/index.ts`'s `buildInquiryMessage`/`buildReportMessage`.

### Model client (`ai/model.ts`)

One function, `resolveModel()`, maps a `{ apiKey, provider, model }` triple to a Vercel AI SDK `LanguageModel`:

```
anthropic → createAnthropic({ apiKey })(model)
google    → createGoogleGenerativeAI({ apiKey, baseURL })(model)
groq      → createGroq({ apiKey, baseURL })(model)
openai    → createOpenAI({ apiKey, baseURL }).chat(model)
mistral / together / perplexity / <unknown-but-known-baseURL>
          → createOpenAI({ apiKey, baseURL, fetch: openAICompatFetch }).chat(model)
```

Provider can be auto-detected from the API key's prefix (`gsk_` → groq, `sk-ant-` → anthropic, `AIza` → google, `sk-` → openai) if not given explicitly — used mainly as a fallback in `skillProviderOptions()`. `withRateLimitRetry()` retries up to 3 times on a 429, backing off using `Retry-After` / `x-ratelimit-reset-tokens` response headers when present, and gives up immediately if the provider signals a long-term (not just short backoff) limit.

### Access resolution (`analytics/analytics.service.ts`)

Every request first tries the caller's personal API key (`UserSettingsService`, keyed by `x-user-id`); if none is configured it falls back to the shared **agent pool** (`AgentConfigService`), picking the currently active agent, or the next one whose input/memory token limits fit the request. On failure the service classifies the error and either:
- retries with the next agent in the pool (invalid key, rate limit, model not found),
- drops the oldest half of the conversation context and retries in-process (context length exceeded), or
- returns a structured error with a suggested fix, e.g. a computed `suggestedLimit` (truncated output, token limit too low).

## 7. Data Model — MongoDB Collections

### `sources` — registered datasets (`sources/sources.service.ts`)

```ts
interface DataSource {
  name: string;              // human label; planner refers to it as query.sourceName
  collection: string;        // actual MongoDB collection name (unique, indexed)
  description?: string;
  fields: DataSourceField[]; // { name, label?, description?, type, role?, enumValues?, referenceTo?, sampleValues?, searchable?, tags? }
  joins?: DataSourceJoin[];  // explicit { from, localField, foreignField, as } $lookup hints
  suggestedCharts?: SuggestedChart[];
}
```
`field.type` ∈ `string | number | integer | boolean | date | datetime | enum | reference | array | object | geo | text`. `field.role` ∈ `dimension | measure | temporal | id | text`. Registering rejects `$`-prefixed or `system.*` collection names, and any field name containing `$` or a NUL byte. See [§9](#9-examples--prompts-requests--responses) for a full `POST /api/sources` request body.

### `prompt_cache` — cached pipeline/dashboard/report results (`cache/cache.service.ts`)

```ts
{
  key: string;        // sha256(`${intent}:${normalizedPrompt}`).slice(0, 24), unique+indexed
  prompt: string;
  intent: string;      // 'dashboard' | 'report' | 'general_question' | 'dashboard:full' | 'report:full'
  result: unknown;     // AggregationResult, or a full DashboardSpec/ReportResult for the ":full" variants
  hitCount: number;
  lastHitAt: Date;
  createdAt: Date;     // TTL-indexed, expires after 7 days
}
```
Bypassed entirely whenever the request carries session context (a follow-up turn) — a cached answer to an isolated prompt cannot correctly answer a context-dependent follow-up.

### `results_history` — every executed pipeline (`history/results-history.repository.ts`)

```ts
{ prompt, intent, collection, pipeline: unknown[], rows: Record<string, unknown>[], rowCount, durationMs, createdAt }
```
Written fire-and-forget from `PipelineService.flush()` whenever a pipeline returns rows. `list()` supports `{ intent?, skip, limit≤100 }`; `findById`/`deleteById` validate the id is a 24-hex ObjectId first.

### `saved_results` — user-pinned outputs (`saved-results/saved-results.repository.ts`)

```ts
{ userId, title (≤200), prompt (≤1000), intent: 'dashboard'|'report'|'inquiry', result: unknown, createdAt, updatedAt }
```
Indexed on `{ userId: 1, createdAt: -1 }`. All reads/writes are scoped to the `x-user-id` header (see [§15](#15-security-model--trust-boundaries) for why that's not real per-user isolation).

### `user_settings` — per-user BYO API key (`user-settings/user-settings.repository.ts`)

```ts
{ userId (unique), apiKey, provider, model, responseTokenLimit=4000, inputTokenLimit, inputTokensUsed=0, outputTokensUsed=0 }
```

### `agent_config` — shared fallback AI connection pool (`agent-config/agent-config.repository.ts`)

A **single document** holding:
```ts
{
  memoryLimit: number;             // default 50 — max long-term memory items injected per request
  currentAgentId: string | null;   // the agent tried first
  agents: AgentEntry[];            // see below
}
interface AgentEntry {
  id: string; status: 'active'|'disabled'|'expired'|'idle';
  provider: string; model: string; apiKey: string;
  inputTokenLimit=8000; outputTokenLimit=8000; memoryTokenLimit=4000;
  inputTokensUsed=0; outputTokensUsed=0; lastInputTokens=0;
  cooldownUntil?: Date|null; lastFailureReason?: string;
}
```
Status transitions are driven by `AgentHealthService` (probe results) and by `AnalyticsService` reacting to live call failures (`updateRuntime()`), see [§16](#16-background-jobs).

### `memory_items` / `memory_settings` — long-term memory (`memory/memory.repository.ts`)

```ts
{ userId, sessionId, type: 'goal'|'insight'|'preference'|'context'|'decision'|'entity'|'correction', content, tags: string[], importance: 1-5, createdAt }
```
`findRelevant()` is a lightweight keyword/tag overlap scorer (`hits/words + importance/20`) over the user's most recent 100 items — not a vector/embedding search despite the field name suggesting otherwise. `memory_settings` holds a single global `extractionEnabled` boolean toggled via `PATCH /api/memory/config`.

### `chart_results` — dashboard audit log (`ai/chart-results.repository.ts`)

```ts
{ prompt, sourceName, dashboard: DashboardSpec, createdAt }
```
Saved fire-and-forget whenever a chart with ≥1 widget is produced; write failures are logged and swallowed (never affects the response).

### LibSQL (`./data/memory.db`) — short-term conversation memory (`session/memory.ts`)

Not MongoDB — a local SQLite file managed by `@mastra/memory`/`@mastra/libsql`. One thread per `sessionId`, with `title`, `metadata.intent`, and up to the last N messages retrievable as `CoreMessage[]` via `getMemoryContext()`. Each assistant message embeds the full `MessageResult` (`dashboardSpec` / `reportSections` / `summary` + `durationMs`) in `metadata.uiMessage` so the history endpoints can reconstruct rich turns.

## 8. API Reference

All routes are prefixed `/api` unless noted. When `API_KEY` is set, every route requires an `x-api-key` header **except** `/health`, `/api/meta`, `/api/provider`, and anything under `/api/key*`.

### `POST /api/analytics` — the main entry point

Request:
```jsonc
{ "prompt": "top 5 projects by budget", "intent": "dashboard", "sessionId": "optional-uuid" }
```
Headers: `x-user-id: <any non-empty string>` (required — see [§15](#15-security-model--trust-boundaries)).

Response (dashboard example — abbreviated; see [§9](#9-examples--prompts-requests--responses) for the complete, unabbreviated payload):
```jsonc
{
  "intent": "dashboard",
  "chart": {
    "layout": "analytical",
    "title": "top 5 projects by budget",
    "summary": "Downtown Transit Hub leads with $12.4M, more than double the next project.",
    "widgets": [ { "id": "w1", "type": "bar chart", "title": "...", "option": { /* full ECharts option */ } } ]
  },
  "sessionId": "…", "messageId": "…",
  "inputTokens": 812, "outputTokens": 240,
  "connection": { "source": "agent", "provider": "groq", "model": "llama-3.3-70b-versatile", "agentId": "…" }
}
```
Report/inquiry responses replace `chart` with `reportSections: [{heading, body}]` or `summary: string` respectively. See [§18](#18-error-response-format) for the error shape and possible `code`s.

### Full route table

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Mongo ping + registered source count (`503` if Mongo is down or 0 sources) |
| `POST` | `/api/analytics` | ✓ + `x-user-id` | Main AI query — see above |
| `GET` | `/api/provider` | — | Static placeholder (`{ provider: '', hasGlobalKey: false }`) |
| `GET` | `/api/sources` | ✓ | List registered datasets |
| `POST` | `/api/sources` | ✓ | Register/update a dataset — `{ name, collection, description?, fields[] }` |
| `DELETE` | `/api/sources/:collection` | ✓ | Remove a dataset |
| `GET` | `/api/meta` | — | Available modes + example prompts derived from registered sources |
| `GET` | `/api/history/results?intent=&skip=&limit=` | ✓ | Past pipeline runs (`limit` capped at 100) |
| `GET` | `/api/history/results/:id` | ✓ | Full pipeline run detail |
| `GET` | `/api/history/sessions` | ✓ | List conversation sessions |
| `GET` | `/api/history/sessions/:sessionId` | ✓ | Session detail with all messages |
| `DELETE` | `/api/history/sessions/:sessionId` | ✓ | Delete a session |
| `GET` | `/api/cache` | ✓ | List prompt-cache entries (result payload excluded) |
| `DELETE` | `/api/cache/:key` | ✓ | Delete one cache entry |
| `DELETE` | `/api/cache` | ✓ | Clear all cache entries |
| `GET` | `/api/saved` | ✓ + `x-user-id` | List a user's saved results |
| `POST` | `/api/saved` | ✓ + `x-user-id` | Save a result — `{ title, prompt?, intent, result }` → `201` |
| `GET` | `/api/saved/:id` | ✓ + `x-user-id` | Fetch one saved result |
| `DELETE` | `/api/saved/:id` | ✓ + `x-user-id` | Delete a saved result |
| `POST` | `/api/settings/models` | ✓ | List models for a provider — `{ provider }` |
| `POST` | `/api/settings/validate` | ✓ | Validate an API key/provider/model combo live |
| `GET` | `/api/settings` | ✓ + `x-user-id` | Get current settings (masked key preview + usage) |
| `POST` | `/api/settings` | ✓ + `x-user-id` | Save personal API key/provider/model/limits |
| `PATCH` | `/api/settings/token-limit` | ✓ + `x-user-id` | Update response/input token limit |
| `DELETE` | `/api/settings` | ✓ + `x-user-id` | Remove personal settings (falls back to shared agents) |
| `GET` | `/api/memory` | ✓ + `x-user-id` | List long-term memory items |
| `DELETE` | `/api/memory` | ✓ + `x-user-id` | Clear a user's long-term memory |
| `GET` | `/api/memory/config` | ✓ | Get global memory-extraction toggle |
| `PATCH` | `/api/memory/config` | ✓ | Enable/disable memory extraction globally |
| `GET` | `/api/agent-config` | ✓ | Get the shared agent pool config |
| `PUT` | `/api/agent-config` | ✓ | Replace the agent pool (triggers an immediate health check) |
| `PATCH` | `/api/agent-config/token-limit` | ✓ | Update one agent's input/output/memory token limit |

## 9. Examples — Prompts, Requests & Responses

All examples below use a `Projects` source registered like this:

```jsonc
// POST /api/sources
{
  "name": "Projects",
  "collection": "projects",
  "description": "Municipal infrastructure projects",
  "fields": [
    { "name": "title",    "type": "string",  "role": "dimension" },
    { "name": "status",   "type": "enum",    "role": "dimension", "enumValues": ["planned", "active", "completed"] },
    { "name": "region",   "type": "string",  "role": "dimension" },
    { "name": "budget",   "type": "number",  "role": "measure" },
    { "name": "year",     "type": "integer", "role": "temporal" }
  ]
}
```

Every `/api/analytics` call below also sends:
```
Content-Type: application/json
x-user-id: user-123
```

### 9.1 Dashboard — single ranking chart

**Prompt:** *"top 5 projects by budget"*

Request:
```jsonc
POST /api/analytics
{ "prompt": "top 5 projects by budget", "intent": "dashboard" }
```

Response:
```jsonc
{
  "intent": "dashboard",
  "chart": {
    "layout": "analytical",
    "title": "Top 5 Projects by Budget",
    "summary": "Downtown Transit Hub leads at $12.4M — more than double the next project.",
    "widgets": [
      {
        "id": "w1",
        "type": "bar chart",
        "title": "Top 5 Projects by Budget",
        "insight": "Downtown Transit Hub accounts for over a third of the combined top-5 budget.",
        "option": {
          "tooltip": { "trigger": "axis" },
          "grid": { "left": 16, "right": 16, "top": 24, "bottom": 24, "containLabel": true },
          "xAxis": { "type": "category" },
          "yAxis": { "type": "value", "name": "Budget (USD)" },
          "series": [
            { "type": "bar", "name": "Budget", "encode": { "x": "title", "y": "budget" } }
          ],
          "dataset": {
            "source": [
              { "title": "Downtown Transit Hub",       "budget": 12400000 },
              { "title": "Riverside Water Treatment",   "budget": 5800000 },
              { "title": "North Bridge Rehabilitation", "budget": 4200000 },
              { "title": "Solar Grid Expansion",        "budget": 3100000 },
              { "title": "Central Library Renovation",  "budget": 2600000 }
            ]
          }
        }
      }
    ]
  },
  "sessionId": "5b6e2a8e-2b41-4c9a-9f2d-3a7e0c1d9b44",
  "messageId": "9d3f4b21-7a6e-4e0a-8c3d-1f5a2b6e9c70",
  "inputTokens": 812,
  "outputTokens": 236,
  "connection": {
    "source": "agent",
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "agentId": "a1f3c9d0-...",
    "outputTokenLimit": 8000,
    "inputTokenLimit": 8000
  }
}
```

> Note the `dataset.source` array: the LLM only had to decide `series.type: "bar"` and `encode: { x: "title", y: "budget" }` — the runtime (`attachDatasetSource()` in `ai/chart.ts`) filled in the real rows returned by MongoDB. This is true for every chart widget in this codebase; the model never transcribes data values by hand.

### 9.2 Dashboard — composition (donut/pie)

**Prompt:** *"breakdown of projects by status"*

Request:
```jsonc
POST /api/analytics
{ "prompt": "breakdown of projects by status", "intent": "dashboard" }
```

Response widget (rest of the envelope is the same shape as 9.1):
```jsonc
{
  "id": "w1",
  "type": "donut chart",
  "title": "Project Status Composition",
  "insight": "58% of projects are still active; only 12% have been completed.",
  "option": {
    "tooltip": { "trigger": "item" },
    "legend": { "bottom": 0 },
    "series": [
      {
        "type": "pie",
        "radius": ["42%", "72%"],
        "encode": { "itemName": "status", "value": "count" }
      }
    ],
    "dataset": {
      "source": [
        { "status": "active",    "count": 58 },
        { "status": "planned",   "count": 30 },
        { "status": "completed", "count": 12 }
      ]
    }
  }
}
```

### 9.3 Dashboard — trend / dual-axis comparison

**Prompt:** *"show budget and project count by region"*

Response widget:
```jsonc
{
  "id": "w1",
  "type": "dual-axis bar+line",
  "title": "Budget vs. Project Count by Region",
  "insight": "The Central region has the most projects but not the highest total budget — North does, concentrated in fewer, larger projects.",
  "option": {
    "tooltip": { "trigger": "axis" },
    "legend": { "top": 0 },
    "xAxis": [{ "type": "category" }],
    "yAxis": [
      { "type": "value", "name": "Budget (USD)" },
      { "type": "value", "name": "Project Count" }
    ],
    "series": [
      { "type": "bar",  "name": "Budget",        "encode": { "x": "region", "y": "budget" } },
      { "type": "line", "name": "Project Count", "yAxisIndex": 1, "encode": { "x": "region", "y": "projectCount" } }
    ],
    "dataset": {
      "source": [
        { "region": "North",   "budget": 18200000, "projectCount": 9 },
        { "region": "Central", "budget": 15600000, "projectCount": 14 },
        { "region": "South",   "budget": 9800000,  "projectCount": 7 }
      ]
    }
  }
}
```

### 9.4 Dashboard — overview (multiple widgets, `strategy: "overview"`)

**Prompt:** *"give me an overview of the projects data"*

Response `chart.widgets` (2–4 complementary widgets per the chart skill's overview guidance — table included when a raw list is clearly useful alongside the charts):
```jsonc
[
  { "id": "w1", "type": "donut chart", "title": "Projects by Status", "option": { "...": "as in 9.2" } },
  { "id": "w2", "type": "bar chart",   "title": "Budget by Region",   "option": { "...": "as in 9.1, dimension=region" } },
  {
    "id": "w3",
    "type": "table",
    "title": "All Active Projects",
    "insight": "27 active projects across 3 regions.",
    "columns": ["title", "region", "budget", "year"],
    "rows": [
      { "title": "Downtown Transit Hub",     "region": "North",   "budget": 12400000, "year": 2025 },
      { "title": "Riverside Water Treatment","region": "Central", "budget": 5800000,  "year": 2024 }
    ]
  }
]
```
(`rows` on a table widget is capped at `CHART_TABLE_MAX_ROWS`, default 100 — see [§12](#12-configuration-reference).)

### 9.5 Report — with an attached chart

**Prompt:** *"analyze infrastructure projects by region"*

Request:
```jsonc
POST /api/analytics
{ "prompt": "analyze infrastructure projects by region", "intent": "report" }
```

Response:
```jsonc
{
  "intent": "report",
  "reportSections": [
    {
      "heading": "Overview",
      "body": "The portfolio spans 30 projects across three regions with a combined budget of $43.6M. North region holds the largest share of committed funds despite having fewer projects than Central."
    },
    {
      "heading": "Key Findings",
      "body": "Downtown Transit Hub ($12.4M) is the single largest project in the portfolio, representing 28% of total spend. Central region has the highest project count (14) but a lower average budget per project ($1.1M vs. North's $2.0M)."
    },
    {
      "heading": "Regional Breakdown",
      "body": "North: 9 projects, $18.2M. Central: 14 projects, $15.6M. South: 7 projects, $9.8M."
    },
    {
      "heading": "Recommendations",
      "body": "Review South region's lower project velocity relative to its budget allocation; consider reallocating Central's smaller, high-volume projects toward fewer higher-impact initiatives."
    }
  ],
  "chart": {
    "layout": "analytical",
    "title": "analyze infrastructure projects by region",
    "summary": "North leads in budget despite fewer projects than Central.",
    "widgets": [ { "id": "w1", "type": "bar chart", "title": "Budget by Region", "option": { "...": "as in 9.1" } } ]
  },
  "sessionId": "…", "messageId": "…",
  "inputTokens": 1204, "outputTokens": 512,
  "connection": { "source": "personal", "provider": "openai", "model": "gpt-4o-mini" }
}
```
`chart` is only present when the report intent's plan set `wantChart: true` **and** at least 2 rows were returned — otherwise the response has no `chart` key at all.

### 9.6 Inquiry — short factual answer

**Prompt:** *"how many projects are active?"*

Request:
```jsonc
POST /api/analytics
{ "prompt": "how many projects are active?", "intent": "inquiry" }
```

Response:
```jsonc
{
  "intent": "inquiry",
  "summary": "There are 58 active projects across 3 regions, with North holding the largest share at 24.",
  "sessionId": "…", "messageId": "…",
  "inputTokens": 340, "outputTokens": 42,
  "connection": { "source": "agent", "provider": "groq", "model": "llama-3.3-70b-versatile", "agentId": "…" }
}
```

### 9.7 Follow-up in the same session

**Prompt 1:** *"show projects by status"* → note the returned `sessionId`.
**Prompt 2 (same session):** *"now filter to just the North region"*

```jsonc
POST /api/analytics
{ "prompt": "now filter to just the North region", "intent": "dashboard", "sessionId": "5b6e2a8e-2b41-4c9a-9f2d-3a7e0c1d9b44" }
```
The prompt cache is bypassed for this call (session context is non-empty), and the planner receives the prior turn as conversation context so it can add a `$match: { region: "North" }` stage without the user having to repeat the original ask.

### 9.8 No matching data

**Prompt:** *"show projects in Antarctica"* (no such region in the data)

```jsonc
{
  "intent": "dashboard",
  "chart": {
    "layout": "operational",
    "title": "show projects in Antarctica",
    "summary": "No matching records were found for this dashboard request. Try broadening the filters or rephrasing the question.",
    "widgets": []
  },
  "sessionId": "…", "messageId": "…",
  "inputTokens": 640, "outputTokens": 0
}
```

### 9.9 Error example — no active AI connection

```jsonc
// 401 Unauthorized
{
  "error": "No active AI connection. Your agent may be expired, disabled, or quota-exhausted. Open Config to re-enable it or add a new connection.",
  "code": "NO_ACTIVE_CONNECTION"
}
```

See [§18](#18-error-response-format) for the full list of error `code`s and [§21](#21-troubleshooting) for how to resolve each one.

## 10. Frontend (client/)

An Angular 21 single-page app (`client/src/app/`, standalone components, no routing module — one view):

- **`app.component.ts`** — top-level shell: prompt input, intent selector, session handling.
- **`analytics-api.service.ts`** — thin HTTP client for the `/api/*` endpoints above.
- **`analytics-state.service.ts`** — client-side state (current session, last result, loading/error state).
- **`widget-grid.component.ts`** — renders a `DashboardSpec`'s widgets in a responsive grid.
- **`chart-render.service.ts`** — turns a widget's `option` into an ECharts instance.
- **`markdown.pipe.ts`** — renders report section bodies as Markdown.
- **`app.types.ts`** — the frontend's mirror of the backend's `DashboardSpec`/`ReportResult`/`InquiryResult` shapes.

Run it with `npm start` from `client/` (proxies API calls to the NestJS server per [`client/proxy.conf.json`](client/proxy.conf.json)). Production build: `npm run build` → `client/dist/mind-ui/browser`, which the backend can serve directly (see [§17](#17-deployment)).

## 11. Getting Started

Prerequisites: Node.js 20+, a running MongoDB instance, and an API key for at least one supported LLM provider (or plan to configure a shared agent after boot).

```powershell
# 1. Backend
cd nest-app
copy .env.example .env    # if present — otherwise create .env, see §12
npm install
npm run start:dev         # http://localhost:3000

# 2. Frontend (separate terminal)
cd client
npm install
npm start                 # proxies to the backend above
```

First-run checklist:
1. Confirm MongoDB is reachable — `GET /health` should report `mongo: "connected"`.
2. Register at least one dataset: `POST /api/sources` with `{ name, collection, fields: [...] }` (it must already exist in MongoDB with data, or point at an empty collection you plan to seed) — see [§9.1](#9-examples--prompts-requests--responses) for a full example body.
3. Configure an AI connection — either `POST /api/settings` with a personal key (per `x-user-id`), or `PUT /api/agent-config` for a connection shared by everyone with no personal key.
4. Send a prompt: `POST /api/analytics { "prompt": "...", "intent": "inquiry" }` with headers `x-user-id: dev` — see [§9](#9-examples--prompts-requests--responses) for more prompt/response examples.

## 12. Configuration Reference

Read from [`nest-app/src/config/configuration.ts`](nest-app/src/config/configuration.ts) and env vars read directly across `nest-app/src`:

```env
# MongoDB (required)
MONGODB_URI=mongodb://127.0.0.1:27017/mindai     # or DB_URL as an alias
MONGODB_DB=mindai
MONGODB_SERVER_SELECTION_TIMEOUT_MS=8000
MONGODB_CONNECT_RETRIES=1
MONGODB_PIPELINE_TIMEOUT_MS=30000                 # maxTimeMS per aggregation

# Server
PORT=3000
SHUTDOWN_TIMEOUT_MS=10000
ALLOWED_ORIGINS=                                  # comma-separated; empty = allow all (dev default)
API_KEY=                                          # enables the x-api-key guard when set

# Conversation memory
LIBSQL_URL=file:./data/memory.db
MEMORY_EXTRACTION_ENABLED=true                    # long-term memory toggle default at boot

# AI pipeline token budgets (all optional, shown with defaults)
PLANNER_MAX_TOKENS=600
CHART_MAX_TOKENS=2000
INQUIRY_MAX_TOKENS=400
REPORT_MAX_TOKENS=1500
INQUIRY_MAX_ROWS=10
WRITER_MAX_CHARS=8000
CHART_MAX_WIDGETS=4
CHART_JSON_MAX_PROPERTIES=8000
CHART_JSON_MAX_DEPTH=20
CHART_TABLE_MAX_ROWS=100
```

LLM provider credentials are **not** set as server env vars in normal operation — they come from per-user Settings (`/api/settings`) or the shared Agent Config pool (`/api/agent-config`), both stored in MongoDB. This is different from the legacy `src/` prototype, which read a single `GROQ_API_KEY` from the environment — do not port that pattern back in.

## 13. Error Handling & Resilience

`AnalyticsService.run()` classifies provider/LLM failures and reacts specifically instead of surfacing a raw stack trace:

| Condition | Behavior |
|---|---|
| Invalid API key | Marks the agent `expired` and tries the next one (if using the shared pool), otherwise `401` with `code: INVALID_API_KEY` |
| Rate limit (429) | Reads `Retry-After`/rate-limit headers, cools the agent down and tries the next one, otherwise `429` with `code: LLM_RATE_LIMIT` and a human-readable retry time |
| Free-tier quota exhausted | Marks the agent `expired` rather than just cooling down (it won't recover on its own) |
| Model not found / retired | Marks the agent `expired` and tries the next one, otherwise `400` asking the user to pick a valid model |
| Context length exceeded | Drops the oldest half of the conversation context and retries in-process (no error surfaced unless it still fails at empty context) |
| Output truncated (cut off before valid JSON) | `422` with `code: TOKEN_LIMIT_TOO_LOW` and a computed `suggestedLimit` |
| Structured output unsupported by model | `400` asking for a model that supports structured/JSON output |
| Memory context exceeds the connection's memory token limit | `422` with `code: MEMORY_TOKEN_LIMIT_TOO_LOW` before any LLM call is even made |
| Estimated request size exceeds the connection's input limit | `422` with `code: INPUT_TOKEN_LIMIT_TOO_LOW` before any LLM call is even made |
| No usable connection at all | `401` with `code: NO_ACTIVE_CONNECTION` |

Aggregation pipeline generation itself gets **one automatic retry** with a targeted hint describing exactly what validation or MongoDB rule was violated (unknown field, bad `$convert` usage, mixed `$project` exclusion/inclusion, wrong stage shape) — see the table in [§6](#6-ai-pipeline-in-detail).

## 14. Testing

```powershell
cd nest-app
npm run test        # Jest unit tests (*.spec.ts, colocated with source)
npm run test:watch
npm run test:cov    # with coverage
npm run test:e2e    # end-to-end, test/jest-e2e.json + test/test-app.module.ts
```

Existing spec coverage: `common/helpers/user-id`, `analytics/pipeline.service`, `analytics/analytics.service`, `sources/sources.service`, `user-settings/user-settings.service`, `agent-config/agent-config.service`, `ai/model`, `ai/planner`, `ai/writer`. When adding a new service, colocate a `*.spec.ts` next to it — that's the existing convention, not a separate `__tests__` tree.

## 15. Security Model & Trust Boundaries

Read this before building anything that assumes real authentication — the current model is deliberately lightweight and has gaps the team should be aware of.

- **`x-api-key` is a single shared secret, not per-user auth.** `ApiKeyGuard` ([`common/guards/api-key.guard.ts`](nest-app/src/common/guards/api-key.guard.ts)) only activates if the `API_KEY` env var is set; when unset, **every route is open**. It gates access to the whole API, not to any particular user's data.
- **`x-user-id` is client-supplied and unverified.** `requireUserId()` ([`common/helpers/user-id.ts`](nest-app/src/common/helpers/user-id.ts)) only checks that the header is non-empty — there is no session, token, or lookup that proves the caller actually owns that ID. Any caller who knows or guesses another user's ID can read/modify their saved results, settings, and memory. Treat `x-user-id` as a **tenant/namespace key, not an authentication credential** — if you need real auth (login, JWT, OAuth), it has to be added in front of this layer (e.g. an API gateway, or a new Nest guard that derives the trusted ID from a verified session instead of trusting the header).
- **API keys are stored in MongoDB in plaintext** (`user_settings`, `agent_config` collections) — there is no encryption-at-rest for provider keys in this codebase. Anyone with DB access can read every configured key. Lock down MongoDB network access and backups accordingly.
- **CORS defaults to allow-all** (`origin: true`) when `ALLOWED_ORIGINS` is unset — fine for local dev, but set `ALLOWED_ORIGINS` explicitly before exposing a deployment publicly.
- **`helmet()` is applied with CSP disabled** (`contentSecurityPolicy: false` in [`main.ts`](nest-app/src/main.ts)) since the app serves its own Angular bundle; re-enable/tune CSP if that changes.
- Registering a data source (`POST /api/sources`) blocks Mongo system collections and `$`-prefixed names, but does **not** otherwise sandbox which collections can be exposed — only register collections that are meant to be queryable through prompts.

## 16. Background Jobs

`AgentHealthService` ([`agent-config/agent-health.service.ts`](nest-app/src/agent-config/agent-health.service.ts)) runs two `@nestjs/schedule` cron jobs:

| Schedule | Job | What it does |
|---|---|---|
| Every minute | `checkAllAgents()` | Probes every non-disabled, non-cooldown agent's provider (a lightweight "list models" call via `buildProviderValidationRequest()`) and flips its status between `active`/`expired` based on the response (429 with a quota-exhausted body counts as unhealthy; any other 4xx counts as unhealthy; a listed-but-missing model marks it `expired` too); re-syncs which agent is "current" if the active one changed. |
| `0 0 1 * *` (1st of month, midnight) | `resetMonthlyUsage()` | Resets all agents' tracked input/output token usage counters back to zero. |

Both jobs append a line to `nest-app/logs/agent-health.log` (created on demand) in addition to the NestJS logger, so you can audit agent status flips without digging through general server logs. `AgentHealthService.checkAllAgents()` is also invoked synchronously right after `PUT /api/agent-config` saves a new pool, so status is fresh immediately after an edit rather than waiting up to a minute.

## 17. Deployment

The backend can serve the built Angular app directly, so a single NestJS process can be the whole deployment:

```powershell
# From the client/ directory — build the Angular app
cd client
npm run build            # outputs to client/dist/mind-ui/browser

# From nest-app/ — build and start the API
cd ../nest-app
npm run build             # nest build → nest-app/dist
npm run start:prod        # node dist/main
```

`AppModule` ([`app.module.ts`](nest-app/src/app.module.ts)) checks at boot whether `client/dist/mind-ui/browser/index.html` exists; if it does, it registers `ServeStaticModule` to serve the Angular bundle for every route that isn't `/api/*` or `/health`. If the Angular build is missing, the backend still runs as an API-only server — this is expected in split-deployment setups (e.g. API on one host, static frontend on a CDN).

Production checklist:
- Set `MONGODB_URI`, `API_KEY`, and `ALLOWED_ORIGINS` explicitly.
- Point `LIBSQL_URL` at a persistent volume (the default `file:./data/memory.db` is local disk — it will not survive a container redeploy unless that path is mounted).
- Configure at least one working AI connection via `PUT /api/agent-config` (shared) so the app isn't dependent on every user bringing their own key.
- `app.enableShutdownHooks()` is already wired up — NestJS will close the Mongo connection cleanly on `SIGTERM`; make sure your process manager/orchestrator sends that signal and waits up to `SHUTDOWN_TIMEOUT_MS`.
- Build the Angular app *before* starting the backend if you want single-process serving — the static-file check only runs once, at boot.

## 18. Error Response Format

Every error response (validation, guards, unhandled exceptions) is normalized by `AllExceptionsFilter` ([`common/filters/all-exceptions.filter.ts`](nest-app/src/common/filters/all-exceptions.filter.ts)) to a single shape:

```jsonc
{
  "error": "Human-readable message",
  "code": "INVALID_API_KEY",       // optional — only present for a known subset of error types
  // any additional fields the throwing site attached, e.g.:
  "currentLimit": 4000,
  "suggestedLimit": 6000
}
```

Known `code` values (see `ERROR_CODES` in [`analytics/analytics.service.ts`](nest-app/src/analytics/analytics.service.ts)): `INVALID_API_KEY`, `LLM_RATE_LIMIT`, `MEMORY_TOKEN_LIMIT_TOO_LOW`, `TOKEN_LIMIT_TOO_LOW`, `INPUT_TOKEN_LIMIT_TOO_LOW`, `NO_ACTIVE_CONNECTION`. Frontend code should switch on `code` rather than parsing `error` text, since the message wording can change. See [§9.9](#9-examples--prompts-requests--responses) for a worked example.

5xx errors are logged server-side with a stack trace; 4xx errors are not (they're expected client mistakes, not bugs).

## 19. Common Workflows

**Add a new queryable dataset**
1. Make sure the MongoDB collection exists (empty is fine).
2. `POST /api/sources` with `{ name, collection, description?, fields: [{ name, type, role?, enumValues?, referenceTo? }, ...] }` — see [§9](#9-examples--prompts-requests--responses) for a full example.
3. The in-memory sources cache reloads automatically (`SourcesService.reloadCache()`); no restart needed.
4. Test with an inquiry prompt first (cheapest/fastest LLM call) before trying dashboard/report.

**Add support for a new LLM provider**
1. Add its base URL to `PROVIDERS` in [`ai/model.ts`](nest-app/src/ai/model.ts).
2. Add a case to `resolveModel()` — reuse `createOpenAI({..., fetch: openAICompatFetch})` if it's OpenAI-compatible.
3. Add its model list to `PROVIDER_MODELS` (used by `POST /api/settings/models`), or rely on `fetchProviderModels()` if it exposes a `GET /models` endpoint in an OpenAI/Anthropic/Google-shaped response.
4. If it needs special request tweaks (e.g. Groq disabling structured outputs), add a branch in `skillProviderOptions()`.

**Add or rotate a shared fallback connection**
- `PUT /api/agent-config` with the full `agents[]` array (existing entries merge by `id` or `apiKey` so runtime state like usage counters isn't lost) — this triggers an immediate health check, so a bad key shows as `expired` within seconds rather than up to a minute later.

**Change token limits after hitting a `422`**
- The error body already includes `suggestedLimit` — for a personal connection, `PATCH /api/settings/token-limit`; for a shared agent, `PATCH /api/agent-config/token-limit` with `{ agentId, field: 'input'|'output'|'memory', value }`.

**Tune prompt/system-prompt behavior**
- Edit the relevant `skills/*/SKILL.md` file (loaded via `ai/skill-prompt.ts`'s `readMarkdownSection`/`readJsonSection`) rather than inlining prompt strings in TypeScript. `skills/aggregation/SKILL.md` also holds the `Pipeline Config` JSON block (`forbiddenStages`, `stageSemantics`) that `pipeline.service.ts` and `planner.ts` both read at import time. `skills/chart/SKILL.md` holds the full ECharts authoring contract described in [§6](#6-ai-pipeline-in-detail).

## 20. Glossary

| Term | Meaning |
|---|---|
| **Intent** | Which of the three output shapes a prompt should produce: `dashboard`, `report`, or `inquiry`. Either passed explicitly by the client or inferred from `needsData`/skills. |
| **Source** (data source) | A registered MongoDB collection + field schema that the planner is allowed to query. Not the same as a MongoDB collection itself — a source is the *description* of one. |
| **Plan** (`TaskPlan`) | The structured output of the planner LLM call: which source to query, the aggregation pipeline, and (for dashboards) a chart strategy/hint. |
| **Skill** | A `skills/*/SKILL.md` markdown file holding the system-prompt text for one LLM role (aggregation, chart, writer, inquiry, report, memory, suggestions, analytics). Loaded via `ai/skill-prompt.ts`, not hardcoded in TypeScript. Also used loosely for `TaskPlan.skills[]` (`aggregation`/`chart`/`report`/`inquiry`) — the set of execution steps a plan requires. |
| **Agent** (in `agent-config`) | A shared, pre-configured AI provider connection (API key + provider + model + limits) that requests fall back to when the calling user has no personal key. Not to be confused with the Mastra `Agent` class instantiated per-LLM-call in `ai/model.ts`. |
| **Session** | A conversation thread (`sessionId`), backed by LibSQL, holding recent user/assistant turns used as short-term memory for follow-up prompts. |
| **Memory** (long-term) | Durable, per-user facts extracted from past conversations (opt-in via `MEMORY_EXTRACTION_ENABLED` / `PATCH /api/memory/config`), retrieved and injected into future prompts. Distinct from session memory. |
| **Widget** | One chart/table entry inside a `DashboardSpec.widgets[]` — either a free-form ECharts `option` object the LLM authored, or `{ type: "table", columns, rows }`. |
| **Strategy** / **chartHint** | Planner-chosen hints (`standard`/`trend`/`comparison`/`anomaly`/`overview` and a free-form string like `ranking`/`distribution`) that steer, but don't dictate, what `ai/chart.ts` builds. |

## 21. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `/health` returns `503 { sources: 0 }` | No data sources registered yet — `POST /api/sources` with at least one dataset (see [§9](#9-examples--prompts-requests--responses)). |
| `401 NO_ACTIVE_CONNECTION` | No personal API key saved for this `x-user-id`, and no active shared agent in `agent-config` (all disabled/expired/cooling down). Add one via `/api/settings` or fix an agent via `/api/agent-config`. |
| `401 INVALID_API_KEY` | The configured key was rejected by the provider — re-validate via `POST /api/settings/validate`, or check `agent-config` for an agent stuck in `expired`. |
| `429` with a retry time | Provider rate limit hit; if using the shared agent pool this should self-heal (next agent, or cooldown expiry) — check `logs/agent-health.log`. |
| `422 TOKEN_LIMIT_TOO_LOW` / `INPUT_TOKEN_LIMIT_TOO_LOW` / `MEMORY_TOKEN_LIMIT_TOO_LOW` | Response, request, or memory context is larger than the configured limit — the error body includes `suggestedLimit`; raise it via `PATCH /api/settings/token-limit` or `PATCH /api/agent-config/token-limit`. |
| Pipeline retried once then still failed with a MongoDB error | The planner produced an invalid stage or referenced an unregistered field — check the server log for the `PipelineService` retry hint; it usually names the exact bad field/operator. |
| Dashboard response has `widgets: []` | No rows matched the filters (see [§9.8](#9-examples--prompts-requests--responses)) — broaden the prompt or check the data actually exists for that filter. |
| Angular app not served at `/` in production | `client/dist/mind-ui/browser/index.html` doesn't exist yet — run `npm run build` in `client/` before starting the backend, then restart it (the check happens once at boot). |
| Conversation memory resets after a restart/redeploy | `LIBSQL_URL` is pointing at a non-persistent path — mount `./data` as a volume, or point `LIBSQL_URL` at a durable location. |
| Long-term memory never shows up in a prompt | `MEMORY_EXTRACTION_ENABLED` (or the runtime toggle via `PATCH /api/memory/config`) is off, or the previous response summary was ≤30 characters (`MIN_SUMMARY_LENGTH_FOR_MEMORY`) so nothing was extracted. |

## 22. Contributing

- **All backend changes go in `nest-app/`.** The root `src/` folder is a legacy prototype — do not add features there.
- Match existing module conventions: a Nest module per feature area with `*.controller.ts` / `*.service.ts` / `*.repository.ts`, DTOs validated with `class-validator`, and a colocated `*.spec.ts` for service logic.
- Run `npm run lint` and `npm run test` in `nest-app/` before opening a PR; `npm run format` (Prettier) keeps diffs clean.
- If you change planner/chart/writer prompt behavior, edit the relevant `skills/*/SKILL.md` file rather than inlining prompt strings in TypeScript — that's the pattern `ai/skill-prompt.ts` expects.
- Keep `README.md` (this file) in sync when you add a module, route, or env var — it's the primary onboarding doc for the team.
