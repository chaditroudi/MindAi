# MindAi — How the Project Works

## Project Structure

```
src/
├── server.ts                        ← entry point
├── http/
│   └── api-router.ts                ← all HTTP routes
├── db/
│   ├── mongo.client.ts              ← MongoDB singleton
│   ├── sources-cache.ts             ← datasets loaded at startup
│   ├── aggregation.ts               ← runs pipeline against MongoDB
│   └── source.repository.ts         ← findSource() helper
├── mastra/
│   ├── index.ts                     ← Mastra instance
│   ├── model.ts                     ← Groq LLM client
│   ├── tools/
│   │   └── analytics.ts             ← 3 createTool + execute functions
│   └── agents/
│       ├── supervisor.ts            ← routing Agent with 3 tools
│       ├── supervisor-plan.ts       ← builds MongoDB pipeline via LLM
│       ├── chart.ts                 ← builds ECharts config via LLM
│       ├── writer.ts                ← generates summaries/reports via LLM
│       └── search.ts                ← builds $regex search pipeline
└── types/index.ts                   ← all TypeScript types
```

---

## Layer 1 — Startup (`server.ts`)

```
node start
  → getMongo()         connects to MongoDB (singleton, retries)
  → initSources()      loads all docs from `sources` collection into memory cache
  → app.listen(3000)   HTTP server ready
```

If the `sources` collection is empty → warning logged, server still starts, every analytics request returns `400`.

---

## Layer 2 — Sources Cache (`sources-cache.ts`)

Loaded once at startup. All agents read from it via `getSources()` — no DB hit per request.

```json
{
  "name": "Films",
  "collection": "films",
  "description": "...",
  "fields": [
    { "name": "title",   "type": "string",  "role": "dimension" },
    { "name": "genre",   "type": "enum",    "enumValues": ["Action", "Drama"] },
    { "name": "year",    "type": "integer", "role": "temporal" },
    { "name": "revenue", "type": "number",  "role": "measure" }
  ]
}
```

---

## Layer 3 — HTTP Routes (`api-router.ts`)

| Method   | Path                        | Purpose                        |
|----------|-----------------------------|--------------------------------|
| `POST`   | `/api/analytics`            | main AI query                  |
| `POST`   | `/api/search`               | keyword search                 |
| `GET`    | `/api/meta`                 | available modes + example prompts |
| `GET`    | `/api/sources`              | list registered datasets       |
| `POST`   | `/api/sources`              | register / update a dataset    |
| `DELETE` | `/api/sources/:collection`  | remove a dataset               |

---

## Layer 4 — Analytics Route (the main flow)

Request body from frontend:

```json
{ "prompt": "top 5 films by revenue", "intent": "dashboard", "sourceName": "Films" }
```

Two paths in `api-router.ts`:

```
intent is "dashboard" / "report" / "inquiry"
  → call executeXxx(ctx) directly         ← NO routing LLM call, fast

intent is missing / undefined
  → supervisorAgent.generate(prompt)      ← LLM decides which tool to call
```

---

## Layer 5 — Tools (`mastra/tools/analytics.ts`)

Three `createTool` definitions. Each tool has an `execute` function that delegates to a plain `executeXxx` function. The tools are registered on the supervisor agent; the plain functions are called directly by the router.

```
analyticsInputSchema   { prompt, sourceName? }

exec(ctx, intent)      shared internal function:
  1. getSources()                          → all datasets from memory cache
  2. runSupervisorPlan(prompt, intent, sources)  → LLM builds MongoDB pipeline
  3. if needsData → executePipeline(pipeline, collection) → rows[]
  return { plan, rows }

executeDashboard(ctx)  → exec(ctx, 'dashboard')        → runChartAgent(rows, prompt)
executeReport(ctx)     → exec(ctx, 'report')           → runReportWriter(rows, prompt)
executeInquiry(ctx)    → exec(ctx, 'general_question') → runInquiryWriter(rows, prompt)

dashboardTool  → execute: ctx => executeDashboard(ctx)   ← used by supervisor agent
reportTool     → execute: ctx => executeReport(ctx)
inquiryTool    → execute: ctx => executeInquiry(ctx)
```

---

## Layer 6 — Supervisor Plan (`agents/supervisor-plan.ts`)

The most important LLM call. Given the user prompt and all source schemas, the LLM builds a complete MongoDB aggregation pipeline.

**Input sent to LLM:**

```json
{
  "prompt": "top 5 films by revenue",
  "intent": "dashboard",
  "availableSources": [
    {
      "name": "Films",
      "collection": "films",
      "fields": [
        { "name": "title",   "type": "string", "role": "dimension" },
        { "name": "revenue", "type": "number", "role": "measure"   }
      ]
    }
  ]
}
```

**Output (TaskPlan JSON):**

```json
{
  "intent":     "dashboard",
  "needsData":  true,
  "needsChart": true,
  "chartHint":  "ranking",
  "query":      { "sourceName": "Films" },
  "pipeline": [
    { "$group":   { "_id": "$title", "revenue": { "$sum": "$revenue" } } },
    { "$sort":    { "revenue": -1 } },
    { "$limit":   5 },
    { "$project": { "_id": 0, "title": "$_id", "revenue": 1 } }
  ]
}
```

---

## Layer 7 — Pipeline Execution (`db/aggregation.ts`)

```ts
db.collection('films').aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 30000 })
```

Returns rows like:

```json
[
  { "title": "Avatar",   "revenue": 2847246203 },
  { "title": "Avengers", "revenue": 2797800564 }
]
```

---

## Layer 8 — Chart Agent (`agents/chart.ts`)

Receives `{ rows, userPrompt, intentHint }`, returns a complete ECharts `option` config.

```json
{
  "chartType": "horizontalBar",
  "title": "Top 5 Films by Revenue",
  "option": {
    "xAxis": { "type": "value" },
    "yAxis": { "type": "category", "data": ["Avatar", "Avengers"] },
    "series": [{ "type": "bar", "data": [2847246203, 2797800564] }]
  }
}
```

Frontend renders this directly with ECharts — no transformation needed.

---

## Layer 8 — Writer Agent (`agents/writer.ts`)

Two functions depending on intent:

```
runInquiryWriter({ prompt, rows })
  → { summary: "There are 1,240 films in the database..." }

runReportWriter({ prompt, rows })
  → { reportSections: [
        { heading: "Overview",      body: "..." },
        { heading: "Key Findings",  body: "..." }
    ]}
```

---

## Layer 9 — Supervisor Agent (`agents/supervisor.ts`)

Only used when **no intent is provided** (free-text mode). Mastra `Agent` with 3 tools registered. LLM reads the prompt and calls the matching tool via function calling.

```ts
new Agent({
  model: resolveModel('supervisor'),   // Groq llama-3.3-70b-versatile
  tools: { dashboardTool, reportTool, inquiryTool }
})
```

---

## Layer 10 — Model (`mastra/model.ts`)

Single Groq client using `@ai-sdk/openai` compatible adapter. Role-specific model override via env:

```
GROQ_SUPERVISOR_MODEL=...   (default: llama-3.3-70b-versatile)
GROQ_WRITER_MODEL=...
GROQ_CHART_MODEL=...
GROQ_SEARCH_MODEL=...
GROQ_MODEL=...              (fallback for all roles)
```

---

## Full Request Flow — Dashboard (intent known)

```
Frontend
  POST /api/analytics
  { prompt: "top 5 films by revenue", intent: "dashboard", sourceName: "Films" }

api-router.ts
  → getSources().length check               if 0 → 400
  → intent === "dashboard"
  → executeDashboard({ prompt, sourceName })

analytics.ts: executeDashboard()
  → exec(ctx, 'dashboard')
      → getSources()                        cache, no DB hit
      → runSupervisorPlan(...)              LLM call #1 — builds pipeline
      → executePipeline(pipeline, 'films')  MongoDB aggregation
      → returns { plan, rows }
  → runChartAgent({ rows, prompt, intentHint: "ranking" })   LLM call #2
  → returns { chartType, title, option }

api-router.ts
  → res.json({ intent: "dashboard", chart: { chartType, title, option } })

Frontend
  → renders ECharts with option config
```

**2 LLM calls total. No wasted routing call.**

---

## Full Request Flow — No Intent (free-text)

```
Frontend
  POST /api/analytics
  { prompt: "show me something interesting" }   ← no intent

api-router.ts
  → intent is undefined
  → supervisorAgent.generate(prompt, { maxSteps: 2 })

supervisor.ts (Mastra Agent)
  → LLM call #1: reads prompt → decides "build-dashboard"
  → calls dashboardTool.execute(ctx)
      → executeDashboard(ctx)
          → LLM call #2: supervisor-plan builds pipeline
          → MongoDB aggregation
          → LLM call #3: chart agent

api-router.ts
  → toolResults[0].toolName === "build-dashboard"
  → res.json({ intent: "dashboard", chart: ... })
```

**3 LLM calls. The routing call is justified — intent was genuinely unknown.**

---

## LLM Call Summary

| Scenario             | Routing call | Plan call | Output call | Total |
|----------------------|:------------:|:---------:|:-----------:|:-----:|
| Intent from dropdown | —            | ✓         | ✓           | 2     |
| Free-text, no intent | ✓            | ✓         | ✓           | 3     |
| needsData = false    | —            | ✓         | —           | 1     |

---

## Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=mindai
GROQ_API_KEY=your_key_here
GROQ_MODEL=llama-3.3-70b-versatile     # optional, overrides all roles
PORT=3000                               # optional, default 3000
```
