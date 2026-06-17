# MindAi — How the Project Works

## Project Structure

```
src/
├── server.ts                              ← entry point, Express app, graceful shutdown
├── config.ts                              ← all env vars with typed defaults
├── types/index.ts                         ← shared TypeScript interfaces
│
├── http/
│   └── api-router.ts                      ← all HTTP routes, auth, request ID
│
├── db/
│   ├── mongo.client.ts                    ← MongoDB singleton connection
│   ├── sources-cache.ts                   ← DataSource[] loaded at startup
│   ├── aggregation.ts                     ← executes pipeline against MongoDB ($limit guard)
│   ├── source.repository.ts               ← normalizeToken() helper
│   ├── prompt-cache.ts                    ← MongoDB TTL cache (7 days, SHA-256 key)
│   └── results-history.repository.ts      ← MongoDB pipeline run log
│
├── utils/
│   └── logger.ts                          ← colored console logger + AsyncLocalStorage request ID
│
└── mastra/
    ├── index.ts                           ← Mastra instance registration
    ├── model.ts                           ← Groq LLM client + AbortSignal factory
    ├── task-plan.ts                       ← finalizeTaskPlan() — post-processes LLM plan
    ├── memory-store.ts                    ← LibSQL conversation sessions + messages
    │
    ├── tools/
    │   └── analytics.ts                   ← orchestrator: runAggregation → skill chain
    │                                         also exports 3 Mastra createTool wrappers
    └── agents/
        ├── analytics-agent.ts             ← Mastra Agent (free-text routing, 3 tools)
        ├── supervisor-plan.ts             ← LLM call #1: builds MongoDB pipeline
        ├── task-plan.ts                   ← validates/cleans the plan output
        ├── chart.render.ts                ← deterministic ECharts renderers (no LLM)
        └── skills/
            ├── index.ts                   ← re-exports all skills
            ├── aggregation.ts             ← cache check → plan → execute → save history
            ├── chart.ts                   ← deterministic chart planning (no LLM)
            └── writer.ts                  ← LLM call #2 (report/inquiry): writes narrative

scripts/
├── seed.ts                                ← populates MongoDB with sample data
└── dump-memory.ts                         ← prints all sessions/messages to stdout or file

data/
└── memory.db                              ← LibSQL/SQLite (conversation memory)
```

---

## Startup Sequence (`server.ts`)

```
1. getMongo()       → connect to MongoDB (singleton, retries on failure)
2. initSources()    → load all docs from `sources` collection → in-memory cache
3. initCache()      → create TTL index on prompt_cache (7 days) + intent index
4. app.listen(3000) → HTTP server ready
```

Security applied at boot:
- `helmet()` → sets security headers (X-Frame-Options, CSP off, etc.)
- `cors()` → open in dev; restricted to `ALLOWED_ORIGINS` env var in production
- `x-powered-by` disabled

---

## Sources Cache (`db/sources-cache.ts`)

Loaded once at startup via `initSources()`. All LLM calls read from it via `getSources()` — zero DB hits per request.

```json
{
  "name": "Projects",
  "collection": "projects",
  "description": "Municipal infrastructure projects",
  "fields": [
    { "name": "status",   "type": "enum",    "enumValues": ["Active","Closed"] },
    { "name": "region",   "type": "string"                                     },
    { "name": "budget",   "type": "number"                                     },
    { "name": "year",     "type": "integer", "role": "temporal"                },
    { "name": "muni",     "type": "string",  "desc": "reference to municipalities" }
  ]
}
```

Reference detection in `resolveReference()` handles FK fields in 3 ways:
1. Explicit `field.referenceTo` property
2. Field description contains "reference", " id", or "ref "
3. Field name is a prefix/abbreviation of a collection name (`muni` → `municipalities`)

---

## HTTP Routes (`http/api-router.ts`)

### Middleware (applied to every request)
1. **Request ID** — assigns a UUID via `AsyncLocalStorage`; every log line in that request carries it
2. **API key** — reads `x-api-key` header, validates against `process.env.API_KEY`; skipped for `/meta` and `/provider`

### Route table

| Method   | Path                           | Auth | Purpose                                   |
|----------|--------------------------------|:----:|-------------------------------------------|
| `POST`   | `/api/analytics`               | ✓    | Main AI query (dashboard / report / inquiry) |
| `GET`    | `/api/meta`                    | —    | Available sources + example prompts        |
| `GET`    | `/api/cache`                   | ✓    | List prompt cache entries                  |
| `DELETE` | `/api/cache`                   | ✓    | Clear all cache, or one entry by `{ key }` |
| `GET`    | `/api/history/results`         | ✓    | List past pipeline runs (MongoDB)          |
| `GET`    | `/api/history/results/:id`     | ✓    | Full run detail (rows + pipeline)          |
| `GET`    | `/api/history/sessions`        | ✓    | List conversation sessions (LibSQL)        |
| `GET`    | `/api/history/sessions/:id`    | ✓    | Session detail with all messages           |
| `DELETE` | `/api/history/sessions/:id`    | ✓    | Delete a session                           |
| `GET`    | `/api/sources`                 | ✓    | List registered datasets                   |
| `POST`   | `/api/sources`                 | ✓    | Register / update a dataset               |
| `DELETE` | `/api/sources/:collection`     | ✓    | Remove a dataset                           |
| `GET`    | `/health`                      | —    | MongoDB ping + sources count               |
| `GET`    | `/api/provider`                | —    | Returns `{ provider: "groq" }`             |

---

## Main Analytics Flow (`POST /api/analytics`)

Request body:
```json
{ "prompt": "show projects by status", "intent": "dashboard", "sessionId": "abc-123" }
```

`prompt` is validated: min 1 char, max 1000 chars.

### Intent routing

```
intent = "dashboard"  → executeDashboard(prompt, context)
intent = "report"     → executeReport(prompt, context)
intent = "inquiry"    → executeInquiry(prompt, context)
intent = null/missing → analyticsAgent.generate(prompt)   ← agent picks the tool
```

### Session + memory (before the LLM call)

```
sessionId provided & exists in LibSQL  → reuse thread
sessionId missing / unknown            → create new UUID thread

ensureThread(sessionId, prompt, intent)  → create or update thread title
getMemoryContext(sessionId)              → load last 20 messages as CoreMessage[]
```

The `context` array is passed all the way down to the supervisor LLM call.

---

## Aggregation Skill (`skills/aggregation.ts`)

This is the central skill — called by all three executors.

```
runAggregation(prompt, intent, context)

  1. PROMPT CACHE CHECK (only when context = [])
     key = SHA-256(intent + ":" + normalised_prompt).slice(0,24)
     getCached() → MongoDB prompt_cache
       HIT  → return cached AggregationResult immediately (0 LLM calls)
       MISS → continue

  2. LLM CALL #1 — runSupervisorPlan()
     Builds MongoDB aggregation pipeline from schema + prompt + context
     Model: llama-3.3-70b-versatile (Groq), temp=0, maxRetries=3

  3. PIPELINE EXECUTION — executePipeline()
     Safety guard: if no $limit stage → inject { $limit: 500 }
     db.collection(name).aggregate(pipeline, { allowDiskUse: true })

  4. SAVE TO results_history (fire-and-forget)
     MongoDB: prompt, intent, collection, pipeline, rows, rowCount, durationMs

  5. SAVE TO prompt_cache (fire-and-forget, only when context = [])
     MongoDB: SHA-256 key, result, TTL 7 days

  return { plan, rows }
```

**Cache bypass rule:** when `context.length > 0` (follow-up in a session), the cache is skipped entirely — a cached answer from an isolated prompt cannot correctly answer a context-dependent follow-up.

---

## LLM Call #1 — Supervisor Plan (`agents/supervisor-plan.ts`)

Produces the MongoDB aggregation pipeline from natural language.

**System prompt contains:**
- Full schema for every registered collection (exact field names, types, roles)
- Ready-to-copy pipeline templates for each collection (group, sum, avg, count, trend, raw list, join)
- Join (`$lookup`) templates for any FK fields detected by `resolveReference()`
- Intent-specific rules (dashboard strategy + chartHint / report shape / inquiry patterns)
- Arabic prompt examples

**User message:**
```json
{ "prompt": "top 10 regions by budget", "intent": "dashboard" }
```

**Output (TaskPlan):**
```json
{
  "needsData":  true,
  "strategy":   "ranking",
  "chartHint":  "ranking",
  "query":      { "sourceName": "Projects" },
  "pipeline": [
    { "$group":   { "_id": "$region", "value": { "$sum": "$budget" } } },
    { "$sort":    { "value": -1 } },
    { "$limit":   10 },
    { "$project": { "_id": 0, "label": "$_id", "value": 1 } }
  ]
}
```

`finalizeTaskPlan()` post-processes the output: normalises `sourceName`, fills missing `skills[]`, validates that `needsData=false` pipelines are truly empty.

---

## Chart Skill — fully deterministic (`skills/chart.ts`)

Called only for `dashboard` intent. **Zero LLM calls** — all decisions are pure code.

**Step 1 — Data shape analysis:**
```
analyzeDataShape(rows, schemaFields?) → DataShapeAnalysis {
  detectedShape:       "grouped_pairs" | "time_series" | "scatter_capable" | "multi_field"
  numericFields:       ["value"]
  temporalFields:      ["year"]
  categoricalFields:   ["label"]
  isGroupedPairs:      true
  isTimeSeriesCapable: false
  isScatterCapable:    false
}
```

Temporal detection uses three layers (most to least reliable):
1. **Name-based** — field name is or contains `year`, `month`, `quarter`, `date`, `week`, `day`
2. **Schema-based** — field has `role=temporal` or `type=date/datetime` in the DataSource definition
3. **Value-based** — every non-null value is a year integer (1900–2100) or an ISO date string (`YYYY-MM-DD`)

`schemaFields` comes from `getSources()` (the in-memory sources cache), passed in from `analytics.ts` via `source?.fields`.

**Step 2 — chartHint reconciliation:**

`reconcileChartHint(hint, shape)` downgrades impossible hints from the supervisor:
- `scatter` but `isScatterCapable=false` → `distribution` or `ranking`
- `trend` but `isTimeSeriesCapable=false` → `distribution` or `ranking`

**Step 3 — Deterministic chart type selection:**

```
determineChartType(shape, chartHint, rowCount) → ChartableType

  time_series shape:
    chartHint=compare  → bar_chart
    default            → line_chart

  all-numeric, no labels → scatter_plot

  chartHint=scatter + isScatterCapable → scatter_plot

  chartHint=ranking | compare  → rowCount > 8 ? horizontal_bar_chart : bar_chart
  chartHint=part_of_whole      → donut_chart
  chartHint=distribution       → rowCount <= 12 ? donut_chart : horizontal_bar_chart
  chartHint=trend (non-series) → rowCount > 8 ? horizontal_bar_chart : bar_chart
  default                      → rowCount <= 10 ? donut_chart : horizontal_bar_chart
```

**Step 4 — Field assignment, title, insight:**

```
assignFields(shape, type)    → { labelField, valueField } or { xField, valueField } or { xField, yField }
deriveTitle(type, fields)    → "region by budget" / "value over year" / "x vs y"
computeInsight(rows, plan)   → "Paris leads with 1,200 (34%)." / "Peak at 2023: 8,500."
```

**Step 5 — Deterministic rendering (`chart.render.ts`):**

```
renderWidget(plan, rows, keys, id)
  → validates every field name against actual row keys (drops widget if unknown field)
  → renderBar / renderLine / renderDonut / renderScatter / renderTable
  → each renderer computes all values from the real rows
```

**Overview vs analytical layout:**
- `strategy=overview` or `shape=multi_field` → `buildOverviewPlans()` → up to 3 widgets (distribution + top-10 + trend line)
- All other strategies → `buildPrimaryPlan()` → single focused widget

Output: `DashboardSpec { layout, title, summary, widgets[] }` — complete ECharts configs.

---

## LLM Call #2 — Writer Skill (`skills/writer.ts`)

Called for `report` and `inquiry` intents.

**Inquiry** (1–3 sentences, lead with key number):
```
runInquirySkill({ prompt, rows })
  maxTokens: 512
  → { summary: "There are 342 active projects across 8 municipalities. ..." }
```

**Report** (5-section structure):
```
runReportWriter({ prompt, rows })
  maxTokens: 2048
  → { reportSections: [
      { heading: "Overview",         body: "..." },
      { heading: "Key Findings",     body: "..." },
      { heading: "Breakdown",        body: "..." },
      { heading: "Trends",           body: "..." },
      { heading: "Recommendations",  body: "..." }
    ]}
```

Both calls: `temperature=0`, `maxRetries=3`, language auto-detected (Arabic or English).

Empty data handling: 0 rows → fixed response without speculating ("No records found…").

---

## Analytics Agent (`agents/analytics-agent.ts`)

Used **only** when `intent` is missing or unknown. Mastra `Agent` with 3 tools.

The agent reads the prompt and calls exactly one tool (`buildDashboard`, `generateReport`, or `executeInquiry`). The tool then runs the normal 2-call path internally.

Disambiguation rules built into the agent instructions:
- `"show"`, `"chart"`, `"dashboard"`, `"اعرض"`, `"مخطط"` → `buildDashboard`
- `"report"`, `"analysis"`, `"تقرير"`, `"تحليل"` → `generateReport`
- `"how many"`, `"count"`, `"كم عدد"`, `"find"` → `executeInquiry`
- Ambiguous → `buildDashboard` (default)

---

## Conversation Memory (`mastra/memory-store.ts`)

Stored in **SQLite** (`./data/memory.db`) via LibSQL + `@mastra/memory`.

```
LibSQL tables:
  mastra_threads   → one row per session (id, title, intent, createdAt, updatedAt)
  mastra_messages  → one row per message (role, content, metadata.uiMessage)
```

`uiMessage` in metadata stores the full `ConversationMessage` object (prompt, intent, result type, durationMs) for the UI history endpoints.

**What memory does:**
- Loads last 20 messages as `CoreMessage[]` per request
- Passes them to the supervisor LLM so follow-up prompts work ("now filter by X")

**What memory does NOT do:**
- Does not cache results (that is `prompt_cache`)
- Does not store raw pipeline rows (that is `results_history`)
- Does not affect rendering or report content directly

**Dump memory to text:**
```bash
npm run dump:memory
npx tsx scripts/dump-memory.ts output.txt
```

---

## Prompt Cache (`db/prompt-cache.ts`)

Stored in **MongoDB** collection `prompt_cache`.

```
Key:    SHA-256(intent + ":" + normalised_prompt).slice(0, 24)
TTL:    7 days (MongoDB TTL index on createdAt)
Bypass: always when context.length > 0 (multi-turn session)

On HIT:  returns full AggregationResult — 0 LLM calls, 0 DB aggregation
On MISS: runs full pipeline, saves result fire-and-forget
```

```json
{
  "_id":       "a3f2b1c9d4e5f6a7b8c9d0e1",
  "intent":    "dashboard",
  "prompt":    "show projects by status",
  "result":    { "plan": {...}, "rows": [...] },
  "createdAt": "2026-06-13T09:00:00Z",
  "hitCount":  3,
  "lastHitAt": "2026-06-13T11:00:00Z"
}
```

Manage via API:
```
GET    /api/cache         → list all entries (result payload excluded)
DELETE /api/cache         → clear all entries
DELETE /api/cache + body { key } → delete one entry
```

---

## Results History (`db/results-history.repository.ts`)

Every pipeline execution is saved to MongoDB collection `results_history` (fire-and-forget).

```json
{
  "_id":        "ObjectId",
  "prompt":     "show projects by status",
  "intent":     "dashboard",
  "collection": "projects",
  "pipeline":   [...],
  "rows":       [...],
  "rowCount":   8,
  "durationMs": 312,
  "createdAt":  "2026-06-13T09:00:00Z"
}
```

Query via API:
```
GET /api/history/results?intent=dashboard&skip=0&limit=20
GET /api/history/results/:id
```

---

## MongoDB Collections Summary

| Collection        | Purpose                            | TTL       |
|-------------------|------------------------------------|-----------|
| `sources`         | DataSource definitions             | permanent |
| `prompt_cache`    | Cached AggregationResult per prompt| 7 days    |
| `results_history` | Every pipeline run log             | permanent |

---

## LLM Call Summary

| Scenario                          | Routing | Plan  | Writer | Total |
|-----------------------------------|:-------:|:-----:|:------:|:-----:|
| Intent known, cache HIT           | —       | —     | —      | **0** |
| Dashboard — cache MISS            | —       | ✓     | —      | **1** |
| Report / inquiry — cache MISS     | —       | ✓     | ✓      | **2** |
| Any intent — follow-up (ctx)      | —       | ✓     | ✓/—    | **1–2** |
| Free-text (agent routing)         | ✓       | ✓     | ✓/—    | **2–3** |
| `needsData = false`               | —       | ✓     | —      | **1** |

> Dashboard intent costs **1 LLM call** — the chart skill is fully deterministic code (no LLM).

All LLM calls: `temperature=0`, `maxRetries=3`, per-role `AbortSignal` timeout.

---

## Full Request Flows

### Dashboard — intent known, cache miss

```
POST /api/analytics  { prompt, intent: "dashboard", sessionId }
  │
  ├─ Zod validate prompt (min 1, max 1000)
  ├─ Load / create LibSQL session thread
  ├─ getMemoryContext() → last 20 msgs as CoreMessage[]
  │
  └─ executeDashboard(prompt, context)
       └─ runAggregation(prompt, "dashboard", context)
            ├─ getCached() → MISS
            ├─ runSupervisorPlan() → LLM #1 → TaskPlan + pipeline
            ├─ executePipeline() → MongoDB → rows[]
            │    └─ $limit guard injects { $limit: 500 } if missing
            ├─ historyRepo.save() → results_history (async)
            └─ setCached() → prompt_cache (async)
         └─ runChart(rows, prompt, strategy, chartHint, source?.fields)
              ├─ analyzeDataShape(rows, schemaFields) → shape analysis
              ├─ reconcileChartHint()                 → fix impossible hints
              ├─ determineChartType() + assignFields() → deterministic plan
              ├─ deriveTitle() + computeInsight()      → from real data
              └─ renderWidget() × N                   → deterministic ECharts configs

  ├─ saveConversationTurn() → LibSQL thread
  └─ res.json({ intent: "dashboard", chart: DashboardSpec, sessionId })
```

### Free-text — no intent

```
POST /api/analytics  { prompt: "analyse our data", sessionId }
  │
  └─ analyticsAgent.generate(prompt, { maxSteps: 2 })
       ├─ LLM #1 (routing): reads prompt → picks "buildDashboard"
       └─ buildDashboardTool.execute() → executeDashboard()
            └─ (same path as above: LLM #2 = supervisor only; chart is deterministic)
```

### Follow-up in same session

```
Turn 1: "show projects by status"     → context=[], cache eligible
Turn 2: "now filter only completed"   → context=[2 msgs], cache BYPASSED
                                         supervisor sees prior turn → adds $match
```

---

## Model & Retry (`mastra/model.ts`)

```typescript
const groq = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey:  GROQ_API_KEY,
});

resolveModel(role)  → checks GROQ_${ROLE}_MODEL env var, falls back to GROQ_MODEL
freshSignal(role)   → AbortSignal.timeout(config.llm.timeouts[role])
```

All `generateObject` calls pass `maxRetries: 3` — the AI SDK retries automatically on Groq 429 rate-limit errors with exponential backoff.

---

## Environment Variables

```env
# Required
MONGODB_URI=mongodb://localhost:27017
GROQ_API_KEY=gsk_...

# Optional — server
PORT=3000
MONGODB_DB=mindai
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
API_KEY=your-secret-key                  # enables x-api-key header auth
SHUTDOWN_TIMEOUT_MS=10000

# Optional — LLM models (all default to llama-3.3-70b-versatile)
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_SUPERVISOR_MODEL=...           # plan generation
GROQ_WRITER_MODEL=...               # report / inquiry narrative

# Optional — timeouts (ms)
SUPERVISOR_TIMEOUT_MS=8000
WRITER_TIMEOUT_MS=8000

# Optional — LibSQL (defaults to local file)
LIBSQL_URL=file:./data/memory.db
```

---

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Schema injected into every LLM system prompt | Prevents hallucinated field names |
| `temperature: 0` on all LLM calls | Reproducible, deterministic pipelines |
| Chart skill is 100% deterministic code | No LLM for dashboards — type, fields, title, insight all derived from data shape + schema |
| Prompt cache bypassed when `context.length > 0` | Context-dependent answers must not be served from cache |
| Fire-and-forget for cache + history writes | Never blocks the HTTP response |
| `$limit: 500` safety guard | Prevents unbounded aggregations from crashing the server |
| `maxRetries: 3` on all LLM calls | Handles Groq 429 rate limits transparently |
| Request ID via `AsyncLocalStorage` | Every log line for a request shares the same ID — easy tracing |
