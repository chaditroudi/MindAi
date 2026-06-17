# MindAi — Full Architecture & How It Works

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Data Flow Overview](#4-data-flow-overview)
5. [Layer-by-Layer Breakdown](#5-layer-by-layer-breakdown)
   - [5.1 Entry Point — server.ts](#51-entry-point--serverts)
   - [5.2 Sources Cache — sources-cache.ts](#52-sources-cache--sources-cachets)
   - [5.3 HTTP Router — api-router.ts](#53-http-router--api-routerts)
   - [5.4 Analytics Orchestrator — tools/analytics.ts](#54-analytics-orchestrator--toolsanalyticsts)
   - [5.5 Aggregation Skill — skills/aggregation.ts](#55-aggregation-skill--skillsaggregationts)
   - [5.6 Supervisor Plan — supervisor-plan.ts](#56-supervisor-plan--supervisor-plants)
   - [5.7 Pipeline Execution — db/aggregation.ts](#57-pipeline-execution--dbaggregationts)
   - [5.8 Chart Skill — skills/chart.ts](#58-chart-skill--skillschartts)
   - [5.9 Writer Skill — skills/writer.ts](#59-writer-skill--skillswriterts)
   - [5.10 Analytics Agent — agents/analytics-agent.ts](#510-analytics-agent--agentsanalytics-agentts)
   - [5.11 LLM Client — model.ts](#511-llm-client--modelts)
   - [5.12 Conversation Memory — memory-store.ts](#512-conversation-memory--memory-storets)
   - [5.13 Results History — db/results-history.repository.ts](#513-results-history--dbresults-historyrepositoryts)
6. [Full Request Flows](#6-full-request-flows)
   - [6.1 Dashboard (intent known)](#61-dashboard-intent-known)
   - [6.2 Report (intent known)](#62-report-intent-known)
   - [6.3 Inquiry (intent known)](#63-inquiry-intent-known)
   - [6.4 Free-text (no intent)](#64-free-text-no-intent)
7. [LLM Call Summary](#7-llm-call-summary)
8. [Database Layout](#8-database-layout)
9. [Environment Variables](#9-environment-variables)
10. [Key Design Decisions](#10-key-design-decisions)
11. [Console Log Tags](#11-console-log-tags)

---

## 1. What It Does

MindAi is an **AI-powered analytics backend**. It accepts a natural-language prompt from a frontend, figures out what data to query, runs a MongoDB aggregation pipeline, and returns one of three output types:

| Output type | What comes back |
|---|---|
| **Dashboard** | A complete ECharts config (widgets, titles, series) |
| **Report** | A list of `{ heading, body }` sections written as prose |
| **Inquiry** | A single-sentence factual answer |

The whole pipeline — schema understanding, pipeline generation, data retrieval, and visualization — runs in **2 LLM calls** when the intent is known, or **3** when it is not.

---

## 2. Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js + TypeScript (ESM) |
| HTTP server | Express |
| AI framework | Mastra (`@mastra/core`) |
| LLM provider | Groq (OpenAI-compatible API) |
| LLM model | `llama-3.3-70b-versatile` (default, configurable per role) |
| Structured LLM output | Vercel AI SDK `generateObject` + Zod schemas |
| Primary database | MongoDB |
| Conversation memory | LibSQL (SQLite via `@mastra/libsql`) stored in `./data/memory.db` |
| Pipeline history | MongoDB `results_history` collection |
| Frontend charts | ECharts (rendered client-side) |

---

## 3. Project Structure

```
src/
├── server.ts                              ← startup: connect DB, load cache, listen
├── config.ts                              ← all env vars with typed defaults
├── types/index.ts                         ← shared TypeScript types
│
├── http/
│   └── api-router.ts                      ← all HTTP routes
│
├── db/
│   ├── mongo.client.ts                    ← MongoDB singleton (lazy, retries)
│   ├── aggregation.ts                     ← executes a pipeline against MongoDB
│   ├── sources-cache.ts                   ← in-memory dataset schema cache
│   ├── source.repository.ts               ← normalizeToken + findSource helpers
│   └── results-history.repository.ts      ← saves pipeline results to MongoDB
│
└── mastra/
    ├── index.ts                           ← Mastra instance
    ├── model.ts                           ← Groq LLM client + per-role resolver
    ├── memory-store.ts                    ← conversation sessions (LibSQL)
    ├── task-plan.ts                       ← finalizes TaskPlan from LLM output
    │
    ├── tools/
    │   └── analytics.ts                   ← orchestrator: chains aggregation + output skill
    │
    └── agents/
        ├── analytics-agent.ts             ← Mastra Agent (supervisor, free-text routing)
        ├── supervisor-plan.ts             ← LLM call #1: builds MongoDB pipeline
        ├── chart.schema.ts                ← Zod schema for chart LLM output
        ├── chart.render.ts                ← pure renderer: plan + rows → ECharts config
        └── skills/
            ├── index.ts                   ← re-exports all skill functions
            ├── aggregation.ts             ← calls supervisor-plan + executePipeline
            ├── chart.ts                   ← LLM call #2 for dashboard
            ├── report.ts                  ← LLM call #2 for report
            ├── inquiry.ts                 ← LLM call #2 for inquiry
            └── writer.ts                  ← shared inquiry + report LLM logic
```

---

## 4. Data Flow Overview

```
User prompt
    │
    ▼
POST /api/analytics  { prompt, intent?, sessionId? }
    │
    ├─ intent known? ──YES──► executeDashboard / executeReport / executeInquiry
    │                                  │
    └─ intent unknown? ──NO──► analyticsAgent.generate()
                                       │  (LLM routes to right tool)
                                       ▼
                         ┌─────────────────────────────┐
                         │     runAggregation()         │
                         │  1. runSupervisorPlan()      │  ← LLM call #1
                         │  2. executePipeline()        │  ← MongoDB
                         │  3. historyRepo.save()       │  ← MongoDB (async)
                         └─────────────────────────────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼            ▼             ▼
                     runChart()   runReport()  runInquiry()
                    (LLM #2)      (LLM #2)     (LLM #2)
                          │            │             │
                          ▼            ▼             ▼
                    DashboardSpec  ReportSections  Summary
                          │
                          ▼
                  saveConversationTurn()  ← LibSQL memory
                          │
                          ▼
                    res.json(result)
```

---

## 5. Layer-by-Layer Breakdown

### 5.1 Entry Point — [server.ts](src/server.ts)

Runs three sequential startup steps before the HTTP server accepts connections:

```
1. getMongo()      → connects to MongoDB (singleton, retries up to MONGODB_CONNECT_RETRIES)
2. initSources()   → loads all docs from `sources` collection into memory
3. app.listen()    → HTTP server ready on PORT (default 3000)
```

If MongoDB has no sources configured the server still starts, but every analytics request returns `400 No data sources configured`.

---

### 5.2 Sources Cache — [db/sources-cache.ts](src/db/sources-cache.ts)

Loaded **once at startup**. Every agent reads `getSources()` — no MongoDB hit per request.

Each source document describes a MongoDB collection and its schema:

```json
{
  "name": "Projects",
  "collection": "projects",
  "description": "Municipal infrastructure projects",
  "fields": [
    { "name": "title",    "type": "string",  "role": "dimension" },
    { "name": "status",   "type": "enum",    "enumValues": ["active","completed"] },
    { "name": "budget",   "type": "number",  "role": "measure" },
    { "name": "year",     "type": "integer", "role": "temporal" },
    { "name": "muniId",   "type": "string",  "referenceTo": "municipalities" }
  ]
}
```

The `role` and `referenceTo` fields are used by `supervisor-plan.ts` to build pipeline templates and join instructions for the LLM.

---

### 5.3 HTTP Router — [http/api-router.ts](src/http/api-router.ts)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/analytics` | Main AI query endpoint |
| `GET` | `/api/meta` | Available modes and example prompts |
| `GET` | `/api/sources` | List registered datasets |
| `POST` | `/api/sources` | Register or update a dataset |
| `DELETE` | `/api/sources/:collection` | Remove a dataset |
| `GET` | `/api/history/sessions` | List conversation sessions |
| `GET` | `/api/history/sessions/:id` | Get session with all messages |
| `DELETE` | `/api/history/sessions/:id` | Delete a session |

**Main routing logic in `POST /api/analytics`:**

```
1. Check sources.length > 0   → 400 if empty
2. Parse { prompt, intent, sessionId }
3. Ensure/create LibSQL thread for sessionId
4. Load last N messages as context (CoreMessage[])
5. Route by intent:
     "dashboard"  → executeDashboard(prompt, context)
     "report"     → executeReport(prompt, context)
     else         → executeInquiry(prompt, context)
     undefined    → analyticsAgent.generate(prompt)   ← supervisor routing
6. Save conversation turn to LibSQL
7. Return result as JSON
```

---

### 5.4 Analytics Orchestrator — [mastra/tools/analytics.ts](src/mastra/tools/analytics.ts)

Pure coordination layer — **no LLM calls here**. Chains two skill functions based on intent:

```
executeDashboard(prompt, context)
    runAggregation(prompt, 'dashboard', context)   → { plan, rows }
    runChart(rows, prompt, plan.strategy, plan.chartHint)
    → DashboardSpec

executeReport(prompt, context)
    runAggregation(prompt, 'report', context)      → { plan, rows }
    runReport(rows, prompt)
    → { reportSections[] }

executeInquiry(prompt, context)
    runAggregation(prompt, 'general_question', context)  → { plan, rows }
    runInquiry(rows, prompt)
    → { summary }
```

Also exports three `createTool` wrappers (`buildDashboardTool`, `generateReportTool`, `executeInquiryTool`) so these same functions can be called by the Mastra supervisor agent via function-calling.

---

### 5.5 Aggregation Skill — [mastra/agents/skills/aggregation.ts](src/mastra/agents/skills/aggregation.ts)

The **data retrieval hub**. Called by every intent path.

```
runAggregation(prompt, intent, context)
    │
    ├─ getSources()                 ← schema from memory cache
    ├─ runSupervisorPlan(...)       ← LLM builds pipeline (see §5.6)
    │
    ├─ [log] plan built: skills, needsData, source, stage count
    │
    ├─ if !needsData or no pipeline → return { plan, rows: [] }
    │
    ├─ [log] pipeline JSON (full, pretty-printed)
    │
    ├─ resolveCollection()          ← maps sourceName → MongoDB collection
    ├─ executePipeline()            ← MongoDB aggregation (see §5.7)
    │
    ├─ [log] result: collection, rowCount, allEmpty flag
    │
    ├─ historyRepo.save(...)        ← writes to results_history (fire-and-forget)
    │   { prompt, intent, collection, pipeline, rows, rowCount, durationMs }
    │
    └─ return { plan, rows }
```

**`resolveCollection`** normalizes the LLM's `sourceName` (strips punctuation, lowercases) and matches it against both `.name` and `.collection` fields of every source — tolerant of model spelling drift.

---

### 5.6 Supervisor Plan — [mastra/agents/supervisor-plan.ts](src/mastra/agents/supervisor-plan.ts)

**The most critical LLM call in the system.** Receives the prompt and the full schema of all data sources, and returns a complete MongoDB aggregation pipeline.

**What the system prompt contains:**

1. Every collection name with its exact field list (name, type, role, description, references)
2. Ready-to-copy pipeline templates for every collection:
   - Sum / Avg by dimension
   - Count by dimension
   - Trend over temporal field
   - Raw list (scatter / overview)
   - Join templates for any reference fields
3. Strict rules: only use field names from the schema, always end with `$project {"_id":0}`, forbidden operators (`$function`, `$merge`, `$out`, `$where`, `$eval`)
4. For `dashboard` intent: strategy picker (`standard`, `trend`, `comparison`, `anomaly`, `overview`) and chart hint picker (`ranking`, `distribution`, `trend`, `part_of_whole`, `compare`, `scatter`)

**Input to LLM:**
```json
{ "prompt": "top 5 projects by budget", "intent": "dashboard" }
```

**Output (TaskPlan):**
```json
{
  "needsData":  true,
  "query":      { "sourceName": "Projects" },
  "pipeline": [
    { "$group":   { "_id": "$title", "value": { "$sum": "$budget" } } },
    { "$sort":    { "value": -1 } },
    { "$limit":   5 },
    { "$project": { "_id": 0, "label": "$_id", "value": 1 } }
  ],
  "strategy":  "standard",
  "chartHint": "ranking"
}
```

After the LLM responds, `finalizeTaskPlan()` adds the `skills[]` array (`['aggregation','chart']` / `['aggregation','report']` / `['aggregation','inquiry']`) based on `intent` and `needsData`.

**LLM settings:** `temperature: 0`, `maxTokens: 1200`, `mode: 'json'`, `AbortSignal` timeout per role.

---

### 5.7 Pipeline Execution — [db/aggregation.ts](src/db/aggregation.ts)

Thin wrapper around the MongoDB driver:

```ts
db.collection(collection)
  .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: config.mongodb.pipelineTimeoutMs })
  .toArray()
```

`allowDiskUse: true` handles large datasets. `maxTimeMS` defaults to 30 seconds (configurable via `MONGODB_PIPELINE_TIMEOUT_MS`).

---

### 5.8 Chart Skill — [mastra/agents/skills/chart.ts](src/mastra/agents/skills/chart.ts)

Before calling the LLM it **analyses the actual data shape** to prevent impossible chart instructions:

**Shape detection (pure code, no LLM):**

| Shape | Condition | Example |
|---|---|---|
| `grouped_pairs` | 2 fields: 1 label + 1 number | `{label, value}` |
| `time_series` | temporal field + numeric field | `{year, count}` |
| `scatter_capable` | 2+ numeric fields, 3+ total fields | `{name, budget, duration}` |
| `multi_field` | everything else | raw rows with many fields |

**chartHint reconciliation** — if the supervisor's hint is physically impossible it is silently corrected:
- `scatter` with only 1 numeric field → downgraded to `distribution` or `ranking`
- `trend` with no temporal field → downgraded to `ranking`

**LLM call:** receives `{ userPrompt, strategy, chartHint, dataShape, rowCount, sampleKeys, sampleRows[0..12] }`. Returns a widget plan with types and field name assignments only — **no data values**.

**Rendering (`chart.render.ts`):** pure TypeScript function that builds the final ECharts `option` object from the full `rows[]` dataset according to the LLM's widget plan. The LLM never touches actual data values.

**Self-healing:** if all LLM-planned widgets reference field names not present in the data, the renderer falls back to a table widget using the actual keys.

---

### 5.9 Writer Skill — [mastra/agents/skills/writer.ts](src/mastra/agents/skills/writer.ts)

Shared LLM logic for both report and inquiry outputs.

**Row serialization:** rows are character-budget-capped before being sent. If rows are truncated the LLM is explicitly told `data is TRUNCATED` so it does not extrapolate totals.

| Function | Max rows sent | Max chars | Output |
|---|---|---|---|
| `runInquirySkill` | 10 | 8 000 | `{ summary: string }` |
| `runReportSkill` | ∞ (char-capped) | 8 000 | `{ reportSections: [{ heading, body }] }` |

**Language detection:** the system prompt instructs the LLM to detect the language from the prompt and respond in the same language. Arabic and English are both supported.

**LLM settings:** `temperature: 0`, structured output via `generateObject`.

---

### 5.10 Analytics Agent — [mastra/agents/analytics-agent.ts](src/mastra/agents/analytics-agent.ts)

A Mastra `Agent` with all three tools registered. **Only used when no `intent` is provided** in the request. Uses the Groq model's function-calling capability to decide which tool to invoke.

```ts
new Mastra({
  agents: { analyticsAgent }
})
// analyticsAgent has tools: buildDashboardTool, generateReportTool, executeInquiryTool
```

When called with `maxSteps: 2`, the agent makes one routing LLM call, then invokes the matched tool which internally makes LLM calls #2 and #3.

---

### 5.11 LLM Client — [mastra/model.ts](src/mastra/model.ts)

Single Groq client using the `@ai-sdk/openai` compatible adapter pointed at `https://api.groq.com/openai/v1`.

**Per-role model resolution:**
```
resolveModel('supervisor')  → reads GROQ_SUPERVISOR_MODEL or GROQ_MODEL fallback
resolveModel('chart')       → reads GROQ_CHART_MODEL or GROQ_MODEL fallback
resolveModel('writer')      → reads GROQ_WRITER_MODEL or GROQ_MODEL fallback
resolveModel('search')      → reads GROQ_SEARCH_MODEL or GROQ_MODEL fallback
```

**Per-role AbortSignal:**
```
freshSignal('supervisor')  → AbortSignal.timeout(SUPERVISOR_TIMEOUT_MS)  default 8s
freshSignal('chart')       → AbortSignal.timeout(CHART_TIMEOUT_MS)       default 8s
freshSignal('writer')      → AbortSignal.timeout(WRITER_TIMEOUT_MS)      default 8s
```

Each LLM call gets its own fresh signal — no shared state between calls.

---

### 5.12 Conversation Memory — [mastra/memory-store.ts](src/mastra/memory-store.ts)

Stores conversation history in a **local LibSQL database** (`./data/memory.db`). Used for follow-up prompt context.

**Thread = Session.** Each session has a UUID (`sessionId`), a title derived from the first prompt, and an intent tag.

**What is stored per turn:**
- User message: `{ role: 'user', prompt, intent }`
- Assistant message: `{ role: 'assistant', result: { type, dashboardSpec | reportSections | summary, durationMs } }`

**`getMemoryContext(threadId)`** returns the last 20 messages as `CoreMessage[]` in Vercel AI SDK format. This array is passed into `runSupervisorPlan` as `context` so the LLM can refer to previous questions/answers for follow-ups.

**Follow-up detection** in `api-router.ts` passes the last context automatically on every request — no special trigger needed.

---

### 5.13 Results History — [db/results-history.repository.ts](src/db/results-history.repository.ts)

Writes every completed pipeline run to the `results_history` MongoDB collection. Called fire-and-forget from `runAggregation` so it never delays the HTTP response.

**Document shape saved:**
```json
{
  "prompt":      "top 5 projects by budget",
  "intent":      "dashboard",
  "collection":  "projects",
  "pipeline":    [ ...stages ],
  "rows":        [ ...all result rows ],
  "rowCount":    5,
  "durationMs":  1240,
  "createdAt":   "2026-06-12T10:30:00.000Z"
}
```

**Available methods:** `save()`, `list({ intent?, skip?, limit? })`, `findById(id)`, `count({ intent? })`, `deleteById(id)`.

---

## 6. Full Request Flows

### 6.1 Dashboard (intent known)

```
POST /api/analytics
{ "prompt": "top 5 projects by budget", "intent": "dashboard", "sessionId": "abc" }

api-router.ts
  ├─ getSources() check                  → must be non-empty
  ├─ ensureThread('abc', prompt)         → LibSQL: create/update session
  ├─ getMemoryContext('abc')             → last 20 messages as context[]
  └─ executeDashboard(prompt, context)

      analytics.ts: executeDashboard()
        └─ runAggregation(prompt, 'dashboard', context)
               │
               ├─ runSupervisorPlan()              ← LLM CALL #1  (~0.8s)
               │    system: schema + templates
               │    user:   { prompt, intent }
               │    output: { needsData, pipeline[], chartHint, strategy }
               │
               ├─ executePipeline(pipeline, 'projects')  ← MongoDB (~50ms)
               │    returns rows[]
               │
               ├─ historyRepo.save({ rows, pipeline, ... })  ← MongoDB async
               └─ returns { plan, rows }

           runChart(rows, prompt, 'standard', 'ranking')
               │
               ├─ analyzeDataShape(rows)           ← pure code: detects shape
               ├─ reconcileChartHint('ranking', shape)  ← validates hint
               │
               ├─ generateObject()                 ← LLM CALL #2  (~0.6s)
               │    system: widget rules
               │    user:   { userPrompt, dataShape, sampleRows, sampleKeys }
               │    output: { widgets[{type, labelField, valueField}], layout }
               │
               └─ renderWidget(w, rows)            ← pure code: builds ECharts option

  ├─ saveConversationTurn()              ← LibSQL: store user + assistant messages
  └─ res.json({ intent:'dashboard', chart: { layout, title, summary, widgets[] } })

Total: 2 LLM calls. Response time ~1.5–3s.
```

---

### 6.2 Report (intent known)

```
POST /api/analytics
{ "prompt": "analyze projects by municipality", "intent": "report" }

  └─ executeReport(prompt, context)
        └─ runAggregation(prompt, 'report', context)   ← LLM #1 + MongoDB
        └─ runReport(rows, prompt)
               └─ runReportSkill()                     ← LLM CALL #2
                    generates { reportSections: [{ heading, body }] }

res.json({ intent:'report', reportSections: [...] })

Total: 2 LLM calls.
```

---

### 6.3 Inquiry (intent known)

```
POST /api/analytics
{ "prompt": "how many projects are in progress?", "intent": "inquiry" }

  └─ executeInquiry(prompt, context)
        └─ runAggregation(prompt, 'general_question', context)  ← LLM #1 + MongoDB
        └─ runInquiry(rows, prompt)
               └─ runInquirySkill()                    ← LLM CALL #2
                    generates { summary: "There are 143 projects in progress." }

res.json({ intent:'inquiry', summary: "..." })

Total: 2 LLM calls.
```

---

### 6.4 Free-text (no intent)

```
POST /api/analytics
{ "prompt": "show me something interesting about the data" }

api-router.ts
  └─ analyticsAgent.generate(prompt, { maxSteps: 2 })

      analyticsAgent (Mastra Agent)
        └─ LLM CALL #1  ← routing: decides which tool to call
             → calls buildDashboardTool / generateReportTool / executeInquiryTool

           chosen tool calls executeDashboard / executeReport / executeInquiry
             └─ LLM CALL #2  (supervisor plan)
             └─ MongoDB
             └─ LLM CALL #3  (chart / report / inquiry writer)

res.json({ intent: '...', ... })

Total: 3 LLM calls.
```

---

## 7. LLM Call Summary

| Scenario | Routing | Plan | Output | Total |
|---|:---:|:---:|:---:|:---:|
| Intent from dropdown/frontend | — | ✓ | ✓ | **2** |
| Free-text, no intent | ✓ | ✓ | ✓ | **3** |
| `needsData = false` (schema cannot answer) | — | ✓ | — | **1** |

---

## 8. Database Layout

### MongoDB collections

| Collection | Written by | Contains |
|---|---|---|
| `sources` | `POST /api/sources` or seed script | Dataset schemas (field names, types, roles) |
| `projects` / `inspections` / etc. | seed script | Actual domain data queried by pipelines |
| `results_history` | `historyRepo.save()` in `runAggregation` | Every pipeline run: prompt, pipeline stages, full rows, timing |

### LibSQL (`./data/memory.db`)

| Table (managed by Mastra) | Contains |
|---|---|
| threads | One row per session (id, title, intent metadata) |
| messages | One row per user/assistant turn, with full result embedded in metadata |

---

## 9. Environment Variables

```env
# Required
GROQ_API_KEY=gsk_...

# MongoDB (one of these two)
MONGODB_URI=mongodb://localhost:27017
DB_URL=mongodb://localhost:27017          # alias

# Optional MongoDB settings
MONGODB_DB=mindai                         # default: none (uses connection default)
MONGODB_SERVER_SELECTION_TIMEOUT_MS=8000
MONGODB_CONNECT_RETRIES=1
MONGODB_PIPELINE_TIMEOUT_MS=30000        # max time for a single aggregation

# Optional LLM model overrides (per agent role)
GROQ_MODEL=llama-3.3-70b-versatile       # fallback for all roles
GROQ_SUPERVISOR_MODEL=...                # overrides plan-building model
GROQ_CHART_MODEL=...                     # overrides chart widget model
GROQ_WRITER_MODEL=...                    # overrides report/inquiry writer model
GROQ_SEARCH_MODEL=...                    # overrides search model

# Optional LLM timeouts (milliseconds)
SUPERVISOR_TIMEOUT_MS=8000
CHART_TIMEOUT_MS=8000
WRITER_TIMEOUT_MS=8000
SEARCH_TIMEOUT_MS=8000

# Optional server
PORT=3000
SHUTDOWN_TIMEOUT_MS=10000

# Optional memory storage
LIBSQL_URL=file:./data/memory.db         # default: local SQLite file
```

---

## 10. Key Design Decisions

### Schema injected into the system prompt — not retrieved at query time
The full dataset schema (field names, types, templates) is embedded in the LLM's system prompt on every supervisor call. This means the LLM **cannot hallucinate field names** — it can only use names that appear in the prompt. The cost is a larger prompt; the benefit is near-zero hallucination rate on pipelines.

### Sources loaded once at startup, never per-request
`getSources()` returns a cached in-memory array. No DB round-trip during analytics. The cache can be refreshed via `POST /api/sources` or `reloadSources()`.

### Data-shape analysis before the chart LLM call
`analyzeDataShape()` inspects the actual rows returned by MongoDB before asking the LLM to plan widgets. If the data physically cannot support the supervisor's `chartHint` (e.g. scatter requires 2 numeric fields), the hint is **silently corrected** before the LLM ever sees it. This prevents a whole class of wrong charts.

### Rendering is pure code, LLM only picks types and field names
The chart LLM never sees or produces data values. It outputs `{ type: 'bar_chart', labelField: 'status', valueField: 'count' }`. The `renderWidget()` function reads the full `rows[]` and builds the complete ECharts `option`. This makes the output deterministic and auditable.

### Fire-and-forget for `historyRepo.save()`
The results history write is non-blocking (`void promise.then(log)`). A slow or failed write never delays the HTTP response. Failures are silently swallowed in the repository (returns empty string on error).

### Direct tool call when intent is known — skip the routing LLM
The HTTP router checks `intent` from the request body and calls the correct `execute*` function directly. The supervisor agent (routing LLM call) is only invoked when `intent` is missing. This saves one full LLM round-trip (~0.5–1s) on the majority of requests.

### Conversation context is minimal and structured
`getMemoryContext()` returns the last 20 messages in Vercel AI SDK `CoreMessage[]` format. Each assistant message is stored as a compact text summary (not the full ECharts JSON). This keeps follow-up context small and cheap while still letting the supervisor understand previous questions.

### AbortSignal per call, not shared
Each LLM call gets `AbortSignal.timeout(roleTimeout)` via `freshSignal()`. A slow supervisor call does not cancel a fast chart call. Timeouts are independently configurable per role.

---

## 11. Console Log Tags

All server logs use structured color-coded tags via `log(tag, message, data?)` in `utils/logger.ts`:

| Tag | Color | Emitted by |
|---|---|---|
| `router` | Cyan | `api-router.ts` — HTTP request/response |
| `analytics` | Blue | `tools/analytics.ts` — intent routing |
| `supervisor-plan` | Magenta | `supervisor-plan.ts` — LLM call + result |
| `aggregation` | Yellow | `skills/aggregation.ts` — pipeline build, execute, save |
| `skill:chart` | Green | `skills/chart.ts` — data shape, LLM plan, widget render |
| `skill:report` | Green | `skills/report.ts` |
| `skill:inquiry` | Green | `skills/inquiry.ts` |
| `writer:inquiry` | Gray | `writer.ts` — inquiry LLM call |
| `writer:report` | Gray | `writer.ts` — report LLM call |
| `sources` | Gray | `sources-cache.ts` — cache load/reload |
| `memory` | Gray | `memory-store.ts` — thread/message operations |

**Example console output for a dashboard request:**

```
[10:30:01.123] [router]          POST /api/analytics | prompt: "top 5 projects by budget" | intent: dashboard
[10:30:01.130] [supervisor-plan] LLM call | intent: dashboard | sources: 4 | context: 0
[10:30:02.010] [supervisor-plan] strategy: standard | chartHint: ranking | stages: 4
[10:30:02.015] [aggregation]     plan built | skills: [aggregation, chart] | source: Projects | stages: 4
[10:30:02.016] [aggregation]     pipeline to execute
                                 [{"$group":...}, {"$sort":...}, {"$limit":5}, {"$project":...}]
[10:30:02.080] [aggregation]     pipeline result | collection: projects | rows: 5 | allEmpty: false
[10:30:02.081] [aggregation]     saved to results_history | id: 6849a... | rows: 5
[10:30:02.082] [skill:chart]     rows: 5 | strategy: standard | hint: ranking → ranking | shape: grouped_pairs
[10:30:02.700] [skill:chart]     done | widgets: 1 | layout: analytical
[10:30:02.705] [router]          done | 1582ms
```
