# MindAi

MindAi turns a plain-language question into a MongoDB query and a finished answer — a dashboard of charts, a written report, or a one-line inquiry response. A user (or another system) asks something like *"top 5 projects by budget"*, and the backend figures out what data to pull, runs the query, and formats the result. No manual query-building, no fixed report templates.

> **Active codebase:** the real, running application is **[`nest-app/`](nest-app/)** (NestJS API) and **[`client/`](client/)** (Angular UI). The `src/` folder at the repo root is an earlier standalone Mastra/Express prototype and **is not used** — ignore it, and ignore `ARCHITECTURE.md` / `HOW_IT_WORKS.md` / `PROJECT_WORKFLOW_REPORT.md` at the root, which document that old prototype. This README documents the current system.

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Repository Layout](#2-repository-layout)
3. [Tech Stack](#3-tech-stack)
4. [How a Request Flows](#4-how-a-request-flows)
5. [Backend Modules (nest-app/src)](#5-backend-modules-nest-appsrc)
6. [AI Pipeline in Detail](#6-ai-pipeline-in-detail)
7. [Data Model](#7-data-model)
8. [API Reference](#8-api-reference)
9. [Frontend (client/)](#9-frontend-client)
10. [Getting Started](#10-getting-started)
11. [Configuration Reference](#11-configuration-reference)
12. [Error Handling & Resilience](#12-error-handling--resilience)
13. [Testing](#13-testing)

---

## 1. What It Does

A client sends a natural-language prompt to `POST /api/analytics`. The backend classifies (or is told) the **intent** and returns one of three shapes:

| Intent | Output |
|---|---|
| `dashboard` | A `DashboardSpec` — one or more ECharts-ready chart widgets, with a title/summary |
| `report` | A `ReportResult` — narrative sections (`{ heading, body }`), optionally with a chart |
| `inquiry` | An `InquiryResult` — a short factual `summary` string |

Everything is driven by **data sources** registered at runtime (`POST /api/sources`): a MongoDB collection plus a field schema (name, type, role, enum values, references to other sources). The LLM never sees or invents field names outside that registered schema, which is what keeps generated MongoDB pipelines from hallucinating.

## 2. Repository Layout

```
MindAi/
├── nest-app/            ← THE BACKEND (NestJS + MongoDB). All backend work happens here.
│   └── src/
│       ├── ai/          ← LLM orchestration: planner, chart builder, writer, model client
│       ├── analytics/   ← top-level orchestration service + controller (/api/analytics)
│       ├── sources/     ← registered dataset schemas (Mongo-backed cache)
│       ├── history/     ← past pipeline runs + conversation sessions
│       ├── cache/       ← prompt→result cache (MongoDB, 7-day TTL)
│       ├── saved-results/   ← user-saved dashboards/reports
│       ├── user-settings/   ← per-user BYO API key / model / token limits
│       ├── agent-config/    ← shared/fallback AI connections ("agents") + health checks
│       ├── memory/      ← long-term per-user memory extraction (opt-in)
│       ├── session/     ← LibSQL-backed conversation memory (short-term, per session)
│       └── common/      ← guards, filters, middleware, logger
│
├── client/              ← THE FRONTEND (Angular 21 + ECharts + Tailwind)
│
├── skills/              ← Markdown "skill" prompt files consumed by nest-app/src/ai
│
├── src/                 ← LEGACY prototype (Mastra + Express). Not used — do not build on this.
├── ARCHITECTURE.md, HOW_IT_WORKS.md, PROJECT_WORKFLOW_REPORT.md
│                        ← LEGACY docs describing the src/ prototype above. Superseded by this README.
│
├── data/                ← local SQLite (LibSQL) memory store, gitignored
└── scripts/             ← seed/reset scripts for the legacy prototype
```

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | [NestJS 11](nest-app/package.json) (Express platform) |
| Database | MongoDB via Mongoose |
| Conversation memory | `@mastra/memory` + `@mastra/libsql` (local SQLite file, `./data/memory.db`) |
| LLM access | Vercel AI SDK (`ai`) + `@mastra/core` `Agent`, provider adapters for OpenAI, Anthropic, Google Gemini, Groq, and any OpenAI-compatible endpoint (Mistral, Together, Perplexity) |
| Structured LLM output | `zod` schemas passed as `structuredOutput` to each agent call |
| Validation | `class-validator` / `class-transformer` on all DTOs |
| Security | `helmet`, optional `x-api-key` guard, CORS allow-list |
| Frontend | Angular 21 (standalone components), Tailwind CSS, ECharts |

## 4. How a Request Flows

```
Client
  │  POST /api/analytics { prompt, intent?, sessionId? }
  ▼
AnalyticsController → AnalyticsService.run()
  │
  ├─ Resolve AI access: per-user API key (Settings) → else shared "agent" pool (Agent Config)
  ├─ Resolve/create session, load short-term memory (session/memory.ts, LibSQL)
  ├─ Load long-term memory relevant to the prompt (memory/memory.service.ts, opt-in)
  │
  ▼
PipelineService.execute*(prompt, memoryContext, opts)
  │
  ├─ 1) aggregate()      → runSupervisorPlan()  [LLM call #1: planner]
  │        builds a validated MongoDB aggregation pipeline against the registered schema
  │        → PipelineService runs it against MongoDB → rows[]
  │        (checked against/saved to the prompt cache when there's no session context)
  │
  └─ 2) dispatchSkills() → runChart() / runReportSkill() / runInquirySkill()  [LLM call #2]
           formats rows[] into a DashboardSpec / ReportResult / InquiryResult
  │
  ▼
AnalyticsService.buildResponse()
  ├─ persists the turn to session memory (session/memory.ts)
  ├─ fires memory extraction if the response is substantial (memory/memory.service.ts)
  ├─ tracks token usage against the user's or agent's quota
  └─ returns AnalyticsResponse (result + sessionId + messageId + token/usage info)
```

Two LLM calls per request (planner + writer/chart) is the norm. A prompt-level cache can skip both when there is no active conversation context.

## 5. Backend Modules (nest-app/src)

| Module | Responsibility |
|---|---|
| **`ai/`** | `model.ts` resolves a `LanguageModel` for a given provider/model/API key and wraps calls with rate-limit retry; `planner.ts` builds the MongoDB pipeline (LLM call #1); `chart.ts` turns rows into `DashboardSpec` widgets; `writer.ts` turns rows into report sections or an inquiry summary; `memory-skill.ts` extracts long-term memories from a finished response; `skill-prompt.ts` loads prompt text from the `skills/*/SKILL.md` files; `token.ts` tracks input/output token usage. |
| **`analytics/`** | `AnalyticsController` (`/api/analytics`, `/api/provider`) is the single public entry point. `AnalyticsService` resolves which AI connection to use, manages sessions/memory, classifies and retries provider errors (invalid key, rate limit, context-too-long, truncated output, unsupported structured output, model not found), and shapes the final response. `PipelineService` is the actual query+format engine described above. |
| **`sources/`** | Data source (dataset) registry: MongoDB-backed CRUD (`SourcesService`/`Source` schema) plus an in-memory cache (`sources-cache.ts`) refreshed on every register/remove so hot-path reads never hit the DB. |
| **`history/`** | Read/query past aggregation runs (`results_history`) and conversation sessions (delegates to `session/memory.ts`). |
| **`cache/`** | SHA-256 prompt+intent → cached pipeline result, stored in MongoDB with a 7-day TTL index; endpoints to list/clear entries. |
| **`saved-results/`** | Lets a user pin a dashboard/report/inquiry result under a title for later retrieval, scoped by `x-user-id` header. |
| **`user-settings/`** | Per-user "bring your own API key" configuration: provider, model, token limits, usage counters; validates a key/provider/model combination live against the provider. |
| **`agent-config/`** | A pool of shared fallback AI connections ("agents") used when a user has no personal key configured. Tracks per-agent status (`active`/`disabled`/`expired`/`idle`), cooldowns after rate limits, and usage; `AgentHealthService` periodically re-checks agents. |
| **`memory/`** | Opt-in long-term memory: extracts durable facts from a conversation turn and retrieves relevant ones for future prompts, scoped per user. |
| **`session/memory.ts`** | Short-term, per-session conversation memory backed by a local LibSQL/SQLite file — not a NestJS module, just a functional store used by `AnalyticsService`. |
| **`common/`** | `ApiKeyGuard` (optional global `x-api-key` auth, with `/health`, `/api/meta`, `/api/provider`, `/api/key*` as public exceptions), `RequestIdMiddleware`, `AllExceptionsFilter`, structured `AppLogger`. |

## 6. AI Pipeline in Detail

### Planner (`ai/planner.ts`) — LLM call #1

Builds the *"YOUR DATABASE SCHEMA"* section of the system prompt from every registered `DataSource`: field names, types, roles, enum/sample values, detected foreign-key references, and ready-to-copy `$lookup`/`$group` pipeline templates. The model must return a `TaskPlan`:

```jsonc
{
  "needsData": true,
  "query": { "sourceName": "Projects" },
  "pipeline": [ /* MongoDB aggregation stages */ ],
  "strategy": "standard",     // dashboard only: standard | trend | comparison | anomaly | overview
  "chartHint": "ranking"      // dashboard only
}
```

`PipelineService.runWithRetry()` validates the plan (exactly one `$*` operator per stage, no forbidden stages, only known field references) and retries once with a targeted correction hint if validation or the MongoDB execution itself fails (e.g. wrong date-conversion pattern, mixed inclusion/exclusion `$project`, unknown field name).

### Chart builder (`ai/chart.ts`) — LLM call #2 (dashboard/report)

Takes the resolved rows and asks the model to choose widget types/fields for a `DashboardSpec`; JSON depth/size is bounded (`MAX_JSON_DEPTH`, `MAX_JSON_PROPERTIES`) before the option payload is sanitized and returned.

### Writer (`ai/writer.ts`) — LLM call #2 (report/inquiry)

`runInquirySkill` returns a 1–3 sentence `{ summary }`; `runReportSkill` returns 1–5 `{ heading, body }` sections, optionally paired with a chart. Row data sent to the model is character-capped (`WRITER_MAX_CHARS`) and row-capped for inquiries (`INQUIRY_MAX_ROWS`).

### Model client (`ai/model.ts`)

One function, `resolveModel()`, maps a `{ apiKey, provider, model }` triple to a Vercel AI SDK `LanguageModel` for OpenAI, Anthropic, Google, Groq, Mistral, Together, or Perplexity (last three via an OpenAI-compatible adapter). Provider can be auto-detected from the API key's prefix if not given explicitly. `withRateLimitRetry()` backs off on provider 429s using `Retry-After`/rate-limit headers when present.

### Access resolution (`analytics/analytics.service.ts`)

Every request first tries the caller's personal API key (`UserSettingsService`); if none is configured it falls back to the shared **agent pool** (`AgentConfigService`), picking the currently active agent or the next one whose token limits fit the request. On failure the service classifies the error (invalid key, rate limit, model not found, context too long, truncated output) and either retries with the next agent, trims conversation context and retries, or returns a structured error with a suggested fix (e.g. a suggested token limit).

## 7. Data Model

A **data source** (`nest-app/src/types/index.ts`, persisted via `sources/sources.service.ts`) describes one queryable MongoDB collection:

```ts
interface DataSource {
  name: string;              // human label the planner refers to as query.sourceName
  collection: string;        // actual MongoDB collection name
  description?: string;
  fields: DataSourceField[]; // name, type, role (dimension/measure/temporal/id/text), enumValues, referenceTo, sampleValues
  joins?: DataSourceJoin[];  // explicit $lookup hints
  suggestedCharts?: SuggestedChart[];
}
```

Registered sources are the only surface the LLM is allowed to query — `PipelineService.validatePipelineFields()` rejects any generated pipeline stage that references a field not present in the schema.

## 8. API Reference

All routes are prefixed `/api` unless noted, and (when `API_KEY` is set) require an `x-api-key` header except `/health`, `/api/meta`, `/api/provider`, and `/api/key*`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Mongo ping + registered source count |
| `POST` | `/api/analytics` | Main entry point — `{ prompt, intent?, sessionId? }` → dashboard/report/inquiry |
| `GET` | `/api/provider` | Static placeholder (`{ provider: '', hasGlobalKey: false }`) |
| `GET` / `POST` / `DELETE` | `/api/sources` | List / register / remove a dataset schema |
| `GET` | `/api/meta` | Available modes + example prompts derived from registered sources |
| `GET` | `/api/history/results`, `/results/:id` | Past pipeline runs |
| `GET` / `DELETE` | `/api/history/sessions`, `/sessions/:id` | Conversation sessions |
| `GET` / `DELETE` | `/api/cache`, `/cache/:key` | Inspect / clear the prompt cache |
| `GET` / `POST` / `DELETE` | `/api/saved` (`x-user-id` header) | Save / list / delete a pinned result |
| `POST` `/api/settings/models` · `POST /validate` · `GET`/`POST`/`PATCH`/`DELETE` `/api/settings` | Per-user BYO API key/provider/model configuration |
| `GET` / `PATCH` / `DELETE` `/api/memory`, `PATCH /config` | Long-term memory listing, clearing, and enable/disable toggle |
| `GET` / `PUT` `/api/agent-config`, `PATCH /token-limit` | Shared fallback AI connection pool |

## 9. Frontend (client/)

An Angular 21 single-page app (`client/src/app/`, standalone components, no routing module — one view):

- **`app.component.ts`** — top-level shell: prompt input, intent selector, session handling.
- **`analytics-api.service.ts`** — thin HTTP client for the `/api/*` endpoints above.
- **`analytics-state.service.ts`** — client-side state (current session, last result, loading/error state).
- **`widget-grid.component.ts`** — renders a `DashboardSpec`'s widgets in a responsive grid.
- **`chart-render.service.ts`** — turns a widget's `option` into an ECharts instance.
- **`markdown.pipe.ts`** — renders report section bodies as Markdown.

Run it with `npm start` from `client/` (proxies API calls to the NestJS server per `client/proxy.conf.json`).

## 10. Getting Started

Prerequisites: Node.js 20+, a running MongoDB instance, and an API key for at least one supported LLM provider (or configure a shared agent after boot).

```powershell
# 1. Backend
cd nest-app
copy .env.example .env    # if present — otherwise create .env, see below
npm install
npm run start:dev         # http://localhost:3000

# 2. Frontend (separate terminal)
cd client
npm install
npm start                 # proxies to the backend above
```

On first boot with no sources registered, the backend still starts but `/health` reports `sources: 0` — register at least one dataset via `POST /api/sources` before running analytics prompts. Then either add a personal key via `POST /api/settings`, or configure a shared connection via `PUT /api/agent-config`.

## 11. Configuration Reference

Read from `nest-app/src/config/configuration.ts` and env vars read directly across `nest-app/src`:

```env
# MongoDB (required)
MONGODB_URI=mongodb://127.0.0.1:27017/mindai     # or DB_URL as an alias
MONGODB_DB=mindai
MONGODB_SERVER_SELECTION_TIMEOUT_MS=8000
MONGODB_CONNECT_RETRIES=1
MONGODB_PIPELINE_TIMEOUT_MS=30000

# Server
PORT=3000
SHUTDOWN_TIMEOUT_MS=10000
ALLOWED_ORIGINS=                                  # comma-separated; empty = allow all
API_KEY=                                          # enables the x-api-key guard when set

# Conversation memory
LIBSQL_URL=file:./data/memory.db
MEMORY_EXTRACTION_ENABLED=true                    # long-term memory toggle default

# AI pipeline token budgets
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

LLM provider credentials are **not** set as server env vars in normal operation — they come from per-user Settings (`/api/settings`) or the shared Agent Config pool (`/api/agent-config`), both stored in MongoDB.

## 12. Error Handling & Resilience

`AnalyticsService.run()` classifies provider/LLM failures and reacts specifically instead of surfacing a raw stack trace:

| Condition | Behavior |
|---|---|
| Invalid API key | Marks the agent `expired` and tries the next one (if using the shared pool), otherwise `401` |
| Rate limit (429) | Reads `Retry-After`, cools the agent down and tries the next one, otherwise `429` with a human-readable retry time |
| Free-tier quota exhausted | Marks the agent `expired` rather than just cooling down |
| Model not found / retired | Marks the agent `expired` and tries the next one, otherwise `400` asking the user to pick a valid model |
| Context length exceeded | Drops the oldest half of the conversation context and retries in-process |
| Output truncated (cut off before valid JSON) | Returns `422` with a suggested higher token limit |
| Structured output unsupported by model | `400` asking for a model that supports structured/JSON output |

Aggregation pipeline generation itself gets **one automatic retry** with a targeted hint describing exactly what validation or MongoDB rule was violated (unknown field, bad `$convert` usage, mixed `$project` exclusion/inclusion, wrong stage shape).

## 13. Testing

```powershell
cd nest-app
npm run test        # Jest unit tests (*.spec.ts, colocated with source)
npm run test:cov    # with coverage
npm run test:e2e    # end-to-end (test/jest-e2e.json)
```

Existing spec coverage: `common/helpers/user-id`, `analytics/pipeline.service`, `analytics/analytics.service`, `sources/sources.service`, `user-settings/user-settings.service`, `agent-config/agent-config.service`, `ai/model`, `ai/planner`, `ai/writer`.
