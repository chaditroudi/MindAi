# Mind Viz Agents: Complete Team Documentation

## Purpose

This document is the main handover guide for the team. It explains what the app does, how it is built, how a user request becomes a MongoDB query and a chart/report, what the JSON DB export is used for, where the query is visible, how to run the system, and what is still missing before production.

The short version:

Mind Viz Agents is a Node.js and TypeScript analytics service that lets a user ask natural-language questions and receive one of three outputs:

- an inquiry answer with record links
- a structured report
- a dashboard chart

The app uses Mastra workflows, LLM agents, MongoDB, blueprints, and deterministic tools. The LLM plans and writes. The backend code builds and executes the actual MongoDB aggregation pipeline.

## Table of Contents

1. Product Overview
2. Current Status
3. Tech Stack
4. High-Level Architecture
5. Runtime Request Flow
6. Important Concept: JSON Export vs Runtime MongoDB Query
7. Where the Query Is
8. Data Model
9. Agents
10. Workflows
11. Tools
12. API Reference
13. Frontend Demo UI
14. Local Setup
15. Environment Variables
16. Scripts
17. Database and Seed Data
18. Knowledge Index and JSON Export
19. Chart Generation
20. Error Handling and Known Recent Issues
21. Security and Permissions
22. Observability and Audit
23. File and Folder Map
24. How to Explain the App to a Manager
25. Known Limitations
26. Recommended Next Steps
27. Troubleshooting

## 1. Product Overview

The app is a demo and integration base for a Mind Platform analytics assistant.

Mind Platform is modeled as a configurable operational platform. Instead of hardcoding one domain, tenants define data structures through Blueprints and Data Stores. The analytics layer reads those definitions and lets users ask questions in natural language.

In the current local demo, the sample data is municipal operations in Qatar. Example questions:

- service request count by municipality this month
- open permits by municipality
- inspection violations by zone
- write a report about inspection outcomes in the last 30 days

The app is generic in design. The Qatar municipal data is only sample data.

## 2. Current Status

The application is functional as a local demo and prototype.

Working:

- Express API server
- Static demo frontend
- Mastra workflows
- Supervisor planning agent
- MongoDB data access
- Tenant-safe aggregation pipeline construction
- Report writing through writer agent
- Chart generation
- Optional search enrichment
- Internal knowledge index built from JSON export
- Frontend loading/progress states
- TypeScript build

Not production-complete:

- request scope is accepted from the request body
- no production auth middleware
- no streaming backend progress endpoint
- limited automated tests
- LLM structured JSON calls can fail if provider returns invalid JSON
- audit pipeline is exposed for dashboard, but not yet for report/inquiry responses

## 3. Tech Stack

Runtime:

- Node.js 20.9+
- TypeScript
- Express

AI and orchestration:

- Mastra
- OpenRouter through OpenAI-compatible SDK
- Zod schemas for structured outputs

Database:

- MongoDB
- Docker Compose for local MongoDB

Frontend:

- static HTML/CSS/JavaScript
- ECharts from CDN

Development:

- tsx
- TypeScript compiler
- smoke test script

## 4. High-Level Architecture

```text
Browser UI or API client
  ->
Express API route
  ->
AnalyticsService
  ->
Mastra workflow
  ->
Supervisor Agent creates TaskPlan
  ->
MongoDB runtime builds and executes safe aggregation pipeline
  ->
Optional search enrichment
  ->
Writer Agent or Chart runtime
  ->
JSON response
```

The important design principle:

The LLM does not directly execute database queries. It creates a structured plan. Backend code converts that plan into a safe MongoDB aggregation pipeline.

## 5. Runtime Request Flow

Every request starts with:

- `prompt`
- `scope`
- optional `topic`
- optional `blueprintId`

Example:

```json
{
  "prompt": "service request count by municipality this month",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_review",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

The runtime does this:

1. The route validates the request body.
2. `AnalyticsService` chooses the workflow.
3. The Supervisor Agent receives blueprints, prompt, topic, and scope.
4. The Supervisor returns a `TaskPlan`.
5. `finalizeTaskPlan` normalizes blueprint, store, field, filter, date, and chart hints.
6. MongoDB runtime resolves the selected Data Store.
7. `buildAggregationFromPlan` creates the real MongoDB aggregation pipeline.
8. `executePipeline` runs the pipeline with tenant guard.
9. `validateRows` normalizes the result rows.
10. The result goes to writer/chart/search steps depending on workflow.
11. Express returns final JSON.

## 6. Important Concept: JSON Export vs Runtime MongoDB Query

This is the most common misunderstanding.

The files under `samples/db-export/*.json` are not the live query. They are not where the MongoDB aggregation pipeline is stored.

They are a static exported corpus used for knowledge/context:

- collection names
- rough row counts
- field names
- sample field types
- whether a collection looks analytics-ready
- internal RAG/knowledge lookup

The actual query is created at runtime.

Runtime query flow:

```text
User prompt
  ->
TaskPlan from LLM
  ->
buildAggregationFromPlan()
  ->
MongoDB aggregation pipeline
  ->
executePipeline()
```

Manager-friendly answer:

> The JSON DB export is only a static schema and knowledge snapshot. The app does not use it as the live query. The live MongoDB query is generated dynamically from the user prompt. The LLM creates a structured TaskPlan, and the backend converts that plan into a safe MongoDB aggregation pipeline with tenant filtering.

## 7. Where the Query Is

The query is generated in:

- `src/mastra/tools/mongodb-tools.ts`
- function: `buildAggregationFromPlan`

The query is executed in:

- `src/mastra/tools/mongodb-tools.ts`
- function: `executePipeline`

The MongoDB runtime path is:

- `src/mastra/runtime/mongodb-runtime.ts`
- function: `runMongoDatasetQuery`

For dashboard responses, the executed pipeline is returned in:

```json
{
  "audit": {
    "plan": {},
    "pipeline": [],
    "elapsedMs": 1234
  }
}
```

For report and inquiry responses, the current response only returns:

```json
{
  "audit": {
    "plan": {},
    "elapsedMs": 1234
  }
}
```

So the query exists for report/inquiry, but the API does not currently expose the pipeline there.

If the team needs full transparency, the next change should be:

- include `executedPipeline` in report workflow output
- include `executedPipeline` in inquiry workflow output
- add `audit.pipeline` to report and inquiry API contracts
- render it in the frontend audit panel

## 8. Data Model

### Blueprint

A Blueprint is a configurable domain model.

Defined in:

- `src/types/index.ts`
- `src/mastra/schemas/blueprint.ts`

Shape:

```json
{
  "id": "bp_municipal_operations",
  "name": "Municipal Operations",
  "description": "...",
  "dataStores": []
}
```

### Data Store

A Data Store maps one business data model to one MongoDB collection.

Shape:

```json
{
  "name": "Service Requests",
  "collection": "service_requests",
  "description": "...",
  "fields": []
}
```

### Field

Fields describe what can be queried.

Supported types:

- `string`
- `number`
- `integer`
- `boolean`
- `date`
- `datetime`
- `enum`
- `reference`
- `array`
- `object`
- `geo`

Supported roles:

- `dimension`
- `measure`
- `temporal`
- `id`

The planner uses fields and roles to choose dimensions, metrics, filters, and chart hints.

### Permission Scope

Every request includes a scope:

```json
{
  "userId": "u_review",
  "tenantId": "t_mind_qatar",
  "allowedBlueprintIds": ["bp_municipal_operations"],
  "rowFilter": {
    "municipality": "Doha"
  }
}
```

Meaning:

- `userId`: current user
- `tenantId`: tenant boundary
- `allowedBlueprintIds`: allowed blueprint list
- `rowFilter`: optional row-level access condition

Important:

The current demo accepts `scope` from the request body. In production, this must come from authentication and authorization middleware.

### TaskPlan

The TaskPlan is the bridge between LLM planning and deterministic backend execution.

Defined in:

- `src/mastra/schemas/intent.ts`

Shape:

```json
{
  "intent": "dashboard",
  "needsData": true,
  "needsEnrichment": false,
  "needsChart": true,
  "query": {
    "blueprintId": "bp_municipal_operations",
    "dataStoreName": "Service Requests",
    "metric": "amount",
    "aggregation": "count",
    "dimensions": ["municipality"],
    "timeRange": {
      "field": "createdAt",
      "from": "2026-05-01T00:00:00.000Z",
      "to": "2026-05-20T23:59:59.999Z"
    },
    "filters": [],
    "limit": 1000
  },
  "chartHint": "compare"
}
```

### Dataset

The normalized dataset shape:

```json
{
  "rows": [],
  "schema": {},
  "source": "mongodb",
  "citations": []
}
```

Rows are normalized to scalar values:

- string
- number
- boolean
- null

### ChartResult

Chart response shape:

```json
{
  "chartType": "bar",
  "option": {},
  "title": "Service requests by municipality",
  "annotations": [],
  "accessibility": {
    "description": "Bar chart comparing values by municipality."
  }
}
```

## 9. Agents

Agents are defined in `src/mastra/agents`.

### Supervisor Agent

File:

- `src/mastra/agents/supervisor.ts`

Purpose:

- classify intent
- inspect accessible blueprints
- choose data store
- choose metric/dimension/filter/date range
- return a TaskPlan

It should not execute MongoDB directly.

### MongoDB Agent

File:

- `src/mastra/agents/mongodb.ts`

Purpose:

- assist with query audit/notes
- understand MongoDB query context
- return structured output when invoked

Current implementation note:

The authoritative data path is deterministic code in `mongodb-runtime.ts` and `mongodb-tools.ts`. The MongoDB Agent can add notes, but it does not override rows or schema.

### Search Agent

File:

- `src/mastra/agents/search.ts`

Purpose:

- enrich results with external web or internal knowledge context
- return a normalized dataset

Search providers:

- Tavily
- Brave
- internal vector/semantic search over exported knowledge

### Writer Agent

File:

- `src/mastra/agents/writer.ts`

Purpose:

- write inquiry summaries
- write report sections
- return strict JSON

Used by:

- `src/mastra/runtime/writer-runtime.ts`

### Chart Agent

File:

- `src/mastra/agents/chart.ts`

Purpose:

- improve chart presentation metadata
- title
- annotations
- accessibility description

Important:

The base chart option is built by code first. The chart agent only improves presentation metadata.

## 10. Workflows

Workflows are defined in `src/mastra/workflows`.

### Dashboard Workflow

File:

- `src/mastra/workflows/dashboard.ts`

Steps:

1. `plan`
2. `query`
3. `enrich`
4. `chart`

Output:

- one chart
- dataset
- plan
- executed pipeline

Dashboard is the clearest path for audit visibility because it returns `audit.pipeline`.

### Report Workflow

File:

- `src/mastra/workflows/report.ts`

Steps:

1. `plan-report`
2. `gather`
3. `write-report`

Output:

- report sections
- optional charts
- plan

Current gap:

The workflow gathers data through MongoDB, but the API response does not expose the executed pipeline yet.

### General Question Workflow

File:

- `src/mastra/workflows/general-question.ts`

Steps:

1. `plan-q`
2. `fetch-records`
3. `retrieve-context`
4. `summarize`

Output:

- summary
- record links
- plan

Current gap:

The workflow fetches records through MongoDB, but the API response does not expose the executed pipeline yet.

## 11. Tools

Tools are deterministic functions the workflows and agents rely on.

### MongoDB Tools

File:

- `src/mastra/tools/mongodb-tools.ts`

Tools:

- `resolve-blueprint`
- `build-aggregation`
- `execute-pipeline`
- `validate-rows`

#### buildAggregationFromPlan

This creates the MongoDB aggregation pipeline.

What it does:

- starts with `$match` on `tenantId`
- merges `scope.rowFilter`
- applies planned filters
- applies planned time range
- adds `$group` for dimensions/aggregation
- adds `$project`
- adds `$sort`
- adds `$limit`

Example generated pipeline:

```json
[
  {
    "$match": {
      "tenantId": "t_mind_qatar",
      "status": {
        "$in": ["submitted", "under_review"]
      }
    }
  },
  {
    "$group": {
      "_id": {
        "municipality": "$municipality"
      },
      "value": {
        "$sum": 1
      }
    }
  },
  {
    "$project": {
      "_id": 0,
      "value": 1,
      "municipality": "$_id.municipality"
    }
  },
  {
    "$limit": 1000
  }
]
```

#### executePipeline

Executes the aggregation pipeline against MongoDB.

Safety:

- it checks for tenant guard
- if missing, it inserts tenant match defensively

#### validateRows

Normalizes MongoDB output into scalar-safe dataset rows and infers a result schema.

### Search Tools

File:

- `src/mastra/tools/search-tools.ts`

Tools:

- `web-search`
- `web-fetch`
- `vector-search`

Search provider configuration:

- `SEARCH_PROVIDER=tavily` with `TAVILY_API_KEY`
- `SEARCH_PROVIDER=brave` with `BRAVE_API_KEY`

Internal semantic search:

- uses exported knowledge chunks
- stores embeddings in MongoDB collection `knowledge_chunks`
- uses OpenRouter embeddings

### Merge Tool

File:

- `src/mastra/tools/merge-tools.ts`

Purpose:

- merge primary and enrichment datasets on a join key

Current note:

Dashboard workflow currently performs the merge inline.

### Chart Tool

File:

- `src/mastra/tools/chart-tools.ts`

Purpose:

- choose chart type
- build ECharts option
- return valid ChartResult

Supported practical chart outputs:

- line
- bar
- horizontalBar
- scatter
- donut
- map
- histogram
- table

## 12. API Reference

Base URL:

```text
http://localhost:3000
```

### GET /health

Response:

```json
{
  "ok": true
}
```

### POST /api/dashboard

Use for one chart.

Request:

```json
{
  "prompt": "service request count by municipality this month",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_review",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response includes:

- `intent`
- `chart`
- `audit.plan`
- `audit.pipeline`
- `audit.elapsedMs`

### POST /api/report

Use for report sections and optional charts.

Request:

```json
{
  "prompt": "create a report about inspection outcomes by municipality in the last 30 days",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_review",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response includes:

- `intent`
- `reportSections`
- optional `charts`
- `audit.plan`
- `audit.elapsedMs`

Current gap:

- no `audit.pipeline` yet

### POST /api/inquiry

Use for quick answers and record links.

Request:

```json
{
  "prompt": "show recent service requests where status is new",
  "scope": {
    "userId": "u_review",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response includes:

- `intent`
- `summary`
- `recordLinks`
- `audit.plan`
- `audit.elapsedMs`

Current gap:

- no `audit.pipeline` yet

## 13. Frontend Demo UI

File:

- `public/index.html`

Purpose:

- manual testing
- demo review
- API validation
- chart rendering

Features:

- endpoint tabs for dashboard/report/inquiry
- prompt textarea
- example prompts
- ECharts chart rendering
- report and inquiry text rendering
- audit panel
- loading/progress states

### UI layout

The frontend is one static page. It does not use React, Vue, Angular, or a build step.

Main screen areas:

| Area | Purpose |
| --- | --- |
| Hero header | Shows the product/demo title and short description |
| Endpoint tabs | Lets the user choose dashboard, report, or inquiry mode |
| Prompt composer | Textarea plus run button |
| Example prompts | Quick prompt buttons for common demo cases |
| Progress area | Shows current estimated stage while the request runs |
| Results panel | Shows chart, report text, inquiry summary, or error |
| Audit panel | Shows returned audit JSON such as plan, pipeline, and elapsed time |

The frontend is intentionally simple so the team can debug the backend workflows quickly.

### Endpoint tabs

There are three tabs:

- `لوحة المعلومات` calls `/api/dashboard`
- `التقرير` calls `/api/report`
- `الاستعلام` calls `/api/inquiry`

The active tab controls:

- which API endpoint is called
- which placeholder text appears in the prompt input
- which example prompts are rendered
- which result format is expected

Implementation:

- `currentEndpoint` stores the selected endpoint
- `EXAMPLES` stores placeholders and example prompts per endpoint
- `renderExamples()` updates the prompt examples whenever the tab changes

### Prompt composer

The prompt composer contains:

- `textarea#prompt`
- `button#go`

User actions:

- clicking `تشغيل` calls `run()`
- pressing Enter without Shift also calls `run()`
- clicking an example prompt fills the textarea and immediately calls `run()`

The frontend sends this request body:

```json
{
  "prompt": "user text",
  "scope": {
    "userId": "u_review",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Important:

This hardcoded `SCOPE` is for the demo UI only. In production, the frontend should not provide authorization scope. The backend should derive it from login/session/auth middleware.

### Loading and progress states

The frontend now shows progress while waiting for the API response.

What happens when a request starts:

- disable button and inputs while request runs
- show elapsed time
- show current stage
- show progress bar
- show working placeholder in result area
- clear the chart from the previous request
- prevent tab/example changes during the active request

Progress elements:

| Element | Purpose |
| --- | --- |
| `#run-status` | Main status row |
| `#status-title` | Current stage title |
| `#status-detail` | Short explanation of current stage |
| `#elapsed` | Elapsed seconds |
| `#progress-bar` | Visual progress track |
| `#progress-fill` | Animated fill |
| `#progress-steps` | Step cards |

The progress stages are defined in JavaScript:

- `PROGRESS_STAGES['/api/dashboard']`
- `PROGRESS_STAGES['/api/report']`
- `PROGRESS_STAGES['/api/inquiry']`

Dashboard stages:

1. فهم الطلب
2. جلب البيانات
3. بناء الرسم
4. تحسين العرض

Report stages:

1. فهم الطلب
2. جلب البيانات
3. إثراء السياق
4. كتابة التقرير

Inquiry stages:

1. فهم الطلب
2. جلب السجلات
3. تلخيص النتيجة

Important:

These are estimated client-side stages. The current backend does not stream real step events. The UI uses time-based progress so the user understands that the request is still running.

For real backend progress, implement one of:

- Server-Sent Events
- WebSocket
- polling by `runId`

### Result rendering

The `render(data)` function chooses the display based on `data.intent`.

Dashboard:

- shows chart panel
- hides text panel
- renders `data.chart.option` with ECharts
- stores audit JSON in the audit panel

Report:

- shows report sections in the text panel
- shows chart if `data.charts[0]` exists
- renders each report section as heading/body
- stores audit JSON in the audit panel

Inquiry:

- hides chart panel
- shows summary in the text panel
- renders record links as pills
- stores audit JSON in the audit panel

Error:

- hides chart panel
- shows error box in the text panel
- resets controls

### Chart rendering

The frontend uses ECharts from CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

The chart instance is created with:

```js
let chart = echarts.init(chartDiv, 'dark');
```

The backend returns a full ECharts `option` object. The frontend does not create chart options itself. It only calls:

```js
chart.setOption(data.chart.option);
```

This means chart structure is owned by the backend, not the UI.

### Audit panel

The audit panel renders:

```js
auditPre.textContent = JSON.stringify(data.audit, null, 2);
```

What the team can inspect there:

- `audit.plan`: LLM-created TaskPlan after normalization
- `audit.pipeline`: generated MongoDB aggregation pipeline, currently dashboard only
- `audit.elapsedMs`: backend workflow duration

For manager demos, this panel is important because it proves the app is not just showing a chart; it also exposes the reasoning plan and, for dashboard, the actual database pipeline.

### UI state lifecycle

Request lifecycle in the frontend:

```text
User clicks run
  ->
run()
  ->
startProgress()
  ->
fetch(currentEndpoint)
  ->
render(data) or show error
  ->
resetControls()
  ->
stopProgress()
```

Key functions:

| Function | Purpose |
| --- | --- |
| `run()` | Main request handler |
| `startProgress()` | Disable inputs and show progress UI |
| `updateProgress()` | Move estimated progress forward |
| `renderProgressSteps()` | Render stage cards |
| `completeProgress()` | Show completion state before clearing |
| `stopProgress()` | Hide progress UI |
| `resetControls()` | Re-enable input/button/tabs/examples |
| `render(data)` | Render dashboard/report/inquiry response |
| `escape()` | Prevent unsafe HTML injection in text output |
| `escapeAttr()` | Prevent unsafe HTML injection in attributes |

### Styling notes

All styles live in the same `public/index.html` file.

Design characteristics:

- Arabic-first layout with `dir="rtl"`
- responsive layout
- chart and text output panels
- progress bar and step cards
- disabled input states
- compact audit panel

The page is designed for demo/review use, not as a production UI shell.

### UI limitations

Current limitations:

- no login
- no production navigation
- no real backend progress streaming
- no request cancellation button
- no saved history of previous runs
- no downloadable report/chart output
- no role-based frontend behavior
- `scope` is hardcoded in the browser for demo use
- all UI code is in one HTML file

Recommended UI improvements:

1. Move to a real frontend app structure if the UI will grow.
2. Add backend progress streaming with `runId`.
3. Add cancel request support.
4. Add response history.
5. Show `audit.pipeline` for report and inquiry once backend exposes it.
6. Add copy buttons for plan and pipeline.
7. Add export buttons for report JSON, chart PNG, and ECharts option JSON.
8. Replace hardcoded scope with authenticated user context.

Important:

The current API returns final JSON only. The frontend progress is estimated client-side. It is useful for user experience, but it is not backend streaming. Real backend progress would require SSE, WebSocket, or polling with run IDs.

## 14. Local Setup

Prerequisites:

- Node.js 20.9+
- npm
- Docker Desktop or local MongoDB
- OpenRouter API key

Quick start:

```powershell
copy .env.example .env
npm install
npm run db:up
npm run seed
npm run dev
```

Open:

```text
http://localhost:3000
```

Build:

```powershell
npm run build
```

Run compiled server:

```powershell
npm start
```

Smoke test:

```powershell
npm run smoke
```

## 15. Environment Variables

Defined in:

- `.env.example`

Model:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SUPERVISOR_MODEL`
- `OPENROUTER_MONGODB_MODEL`
- `OPENROUTER_SEARCH_MODEL`
- `OPENROUTER_WRITER_MODEL`
- `OPENROUTER_CHART_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Embeddings:

- `OPENROUTER_EMBEDDING_MODEL`
- `OPENROUTER_EMBEDDING_DIMENSIONS`

MongoDB:

- `MONGODB_URI`
- `MONGODB_DB`
- `DB_URL`

Search:

- `SEARCH_PROVIDER`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`

Knowledge:

- `KNOWLEDGE_COLLECTION`
- `KNOWLEDGE_TENANT_ID`
- `KNOWLEDGE_SHARED_TENANT_ID`

Server:

- `PORT`
- `NODE_ENV`
- `SMOKE_BASE_URL`
- `MASTRA_TELEMETRY_DISABLED`

## 16. Scripts

Defined in:

- `package.json`

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Express server in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server |
| `npm run mastra:dev` | Start Mastra dev tooling |
| `npm run typecheck` | TypeScript validation without emit |
| `npm run seed` | Seed sample data into MongoDB |
| `npm run smoke` | Run endpoint smoke tests |
| `npm run knowledge:index` | Build internal knowledge embedding index |
| `npm run db:up` | Start local MongoDB through Docker |
| `npm run db:down` | Stop Docker services |
| `npm run db:reset` | Reset DB and seed again |

## 17. Database and Seed Data

Seed script:

- `scripts/seed.ts`

Sample data includes:

- blueprints
- service requests
- inspections
- permits
- projects

Sample tenant:

- `t_mind_qatar`

Sample blueprints:

- `bp_municipal_operations`
- `bp_urban_planning`

The seed script makes the app runnable locally without a production data source.

## 18. Knowledge Index and JSON Export

Knowledge export logic:

- `src/knowledge/export-knowledge.ts`

Export folder:

- `samples/db-export`

What it does:

- reads exported JSON files
- excludes sensitive collections like `otp` and `users_auth`
- extracts collection summaries
- detects fields and sample values
- builds text chunks
- optionally embeds chunks and stores them in MongoDB

Index command:

```powershell
npm run knowledge:index
```

Knowledge collection:

- default `knowledge_chunks`

Purpose:

- help the Supervisor understand platform collections and fields
- support internal semantic search
- answer schema/platform questions

Not purpose:

- it is not the live query
- it is not the production database
- it is not a replacement for MongoDB aggregation

## 19. Chart Generation

Chart path:

```text
Dataset
  ->
buildChartFromDataset()
  ->
base ChartResult
  ->
Chart Agent presentation metadata
  ->
final ChartResult
```

Base chart logic:

- lives in `src/mastra/tools/chart-tools.ts`
- deterministic
- does not rely on LLM for the main ECharts option

Chart agent logic:

- lives in `src/mastra/runtime/chart-runtime.ts`
- asks the LLM for title, annotations, accessibility
- expects strict JSON

Why chart step can fail:

- provider returns non-JSON
- model returns prose instead of JSON
- provider returns an error body
- payload is too large
- model does not support reliable structured output
- retry also fails

No-fallback policy:

The current behavior keeps the LLM-driven path. If the LLM returns invalid JSON twice, the workflow fails instead of silently substituting a fallback.

## 20. Error Handling and Known Recent Issues

### Invalid JSON response

Error:

```text
Invalid JSON response
```

Meaning:

Mastra asked the model for structured JSON, but the provider response could not be parsed as valid JSON.

Where it can happen:

- supervisor planning
- writer summary/report
- search enrichment
- chart presentation

Current mitigation:

- structured output schema
- `temperature: 0`
- one strict retry message

Still possible:

- if provider returns an error instead of JSON
- if provider/model does not comply
- if OpenRouter/provider is overloaded

### Provider returned error

Meaning:

The upstream provider returned an error, usually unrelated to TypeScript or MongoDB.

Possible causes:

- invalid API key
- rate limit
- model unavailable
- timeout
- provider-side error
- request too large

### Slow button/result

The button takes time because one request can involve several network calls:

1. LLM planning
2. MongoDB query
3. optional search enrichment
4. LLM report or chart presentation
5. retry if JSON is invalid

The frontend now shows progress so users know the app is working.

## 21. Security and Permissions

Implemented safeguards:

- blueprint allow-list through `allowedBlueprintIds`
- tenant guard inserted into every MongoDB pipeline
- tenant guard checked again before execution
- optional row-level filter via `scope.rowFilter`
- field normalization through `finalizeTaskPlan`
- row normalization through `validateRows`

Production gaps:

- scope comes from request body
- no auth middleware
- no server-side user session
- no rate limiting
- no per-user audit log table

Production recommendation:

Move scope creation to authentication middleware and never trust client-supplied scope.

## 22. Observability and Audit

Logger:

- `src/observability/log.ts`

It outputs structured JSON logs.

Examples:

- workflow success/failure
- MongoDB build/execute duration
- search activity
- retry warnings

API audit:

- dashboard: plan, pipeline, elapsedMs
- report: plan, elapsedMs
- inquiry: plan, elapsedMs

Recommended improvement:

Expose pipeline for all data-backed flows and add run-level trace IDs across every workflow step.

## 23. File and Folder Map

### Root

| Path | Purpose |
| --- | --- |
| `package.json` | scripts and dependencies |
| `.env.example` | environment template |
| `docker-compose.yml` | local MongoDB stack |
| `README.md` | quick overview |
| `requests.http` | manual API requests |
| `setup.ps1` | Windows PowerShell setup |
| `setup.cmd` | Windows CMD setup |

### Public

| Path | Purpose |
| --- | --- |
| `public/index.html` | static demo frontend |

### Scripts

| Path | Purpose |
| --- | --- |
| `scripts/seed.ts` | seed local sample data |
| `scripts/smoke.ts` | smoke tests |
| `scripts/build-knowledge-index.ts` | index JSON export into knowledge chunks |

### Source

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Express server |
| `src/index.ts` | package/library export |
| `src/services/analytics-service.ts` | workflow service wrapper |
| `src/http/api-router.ts` | API route handlers |
| `src/http/contracts.ts` | request/response schemas |
| `src/db/mongo.client.ts` | MongoDB client |
| `src/db/blueprint.repository.ts` | blueprint loading |
| `src/observability/log.ts` | logger |
| `src/types/index.ts` | shared domain types |

### Mastra

| Path | Purpose |
| --- | --- |
| `src/mastra/index.ts` | registers agents and workflows |
| `src/mastra/model.ts` | resolves OpenRouter model |
| `src/mastra/agents/supervisor.ts` | planning agent |
| `src/mastra/agents/mongodb.ts` | MongoDB agent |
| `src/mastra/agents/search.ts` | search agent |
| `src/mastra/agents/writer.ts` | writer agent |
| `src/mastra/agents/chart.ts` | chart agent |
| `src/mastra/workflows/dashboard.ts` | dashboard workflow |
| `src/mastra/workflows/report.ts` | report workflow |
| `src/mastra/workflows/general-question.ts` | inquiry workflow |
| `src/mastra/runtime/supervisor-runtime.ts` | supervisor call/retry/finalization |
| `src/mastra/runtime/mongodb-runtime.ts` | MongoDB query runtime |
| `src/mastra/runtime/search-runtime.ts` | search agent runtime |
| `src/mastra/runtime/writer-runtime.ts` | writer agent runtime |
| `src/mastra/runtime/chart-runtime.ts` | chart generation runtime |
| `src/mastra/tools/mongodb-tools.ts` | MongoDB deterministic tools |
| `src/mastra/tools/search-tools.ts` | web/internal search tools |
| `src/mastra/tools/chart-tools.ts` | deterministic chart builder |
| `src/mastra/tools/merge-tools.ts` | dataset merge helper |
| `src/mastra/schemas/*` | Zod schemas |

## 24. How to Explain the App to a Manager

### One-minute explanation

This app turns natural-language business questions into analytics outputs. The LLM does not directly query the database. It creates a structured plan. The backend validates that plan against allowed blueprints and fields, then builds a safe MongoDB aggregation pipeline with tenant filtering. The result is returned as either a chart, a report, or a summary.

### Answer: "Where is the query?"

The query is generated at runtime from the TaskPlan. It is not stored in the JSON export.

Code location:

- `src/mastra/tools/mongodb-tools.ts`
- `buildAggregationFromPlan`

Visible in API:

- dashboard response: `audit.pipeline`
- report/inquiry: not exposed yet, but can be added

### Answer: "Why do we have JSON export?"

The JSON export is a knowledge source. It helps the system understand collections, fields, and internal platform context. It is not used as the live database query.

### Answer: "Why is it slow sometimes?"

The request may call multiple LLMs and external providers. Network calls take time, and retries happen if the provider returns invalid JSON. The frontend now shows progress states so the user understands the app is working.

### Answer: "Is the app safe?"

The MongoDB query path is safer than letting the LLM write raw queries. Tenant filtering is enforced in backend code. The main production security gap is that request scope is still passed from the client in the demo.

## 25. Known Limitations

Current limitations:

- no production auth
- request scope is demo-supplied
- no backend streaming progress
- report/inquiry do not expose pipeline in audit
- limited automated tests
- LLM JSON output can still fail after retry
- no central tracing system
- no comprehensive timeout policy
- search enrichment requires provider keys
- knowledge search is Mongo-backed, not a dedicated vector DB

## 26. Recommended Next Steps

Highest priority:

1. Expose `audit.pipeline` for report and inquiry.
2. Move scope generation to auth middleware.
3. Reduce LLM payload sizes, especially chart metadata calls.
4. Add automated tests for query generation and tenant guard.
5. Add request timeouts and retry policy.
6. Add backend progress streaming with SSE or polling.
7. Add structured run tracing for all workflow steps.
8. Add production error messages that separate provider errors from app errors.

Good tests to add first:

- TaskPlan -> pipeline includes tenantId
- rowFilter is merged into `$match`
- invalid blueprintId is rejected or normalized
- report/inquiry data paths return executed pipeline after the audit change
- chart builder returns valid ChartResult for empty, categorical, temporal, numeric, and geo datasets

## 27. Troubleshooting

### App starts but requests fail

Check:

```powershell
npm run build
npm run db:up
npm run seed
npm run dev
```

Then open:

```text
http://localhost:3000/health
```

### MongoDB returns no data

Check:

- MongoDB is running
- seed script was run
- request uses tenant `t_mind_qatar`
- request scope includes correct blueprint IDs
- prompt maps to available fields

### Invalid JSON response

Check:

- OpenRouter model supports structured output reliably
- request payload is not too large
- provider is not rate-limited
- logs show whether retry happened

### Provider returned error

Check:

- `OPENROUTER_API_KEY`
- selected model name
- OpenRouter account limits
- provider availability
- network connection

### Search enrichment fails

Check:

- `SEARCH_PROVIDER`
- `TAVILY_API_KEY` or `BRAVE_API_KEY`
- web access from runtime environment

### Internal knowledge search is empty

Run:

```powershell
npm run knowledge:index
```

Check:

- `samples/db-export` exists
- `OPENROUTER_API_KEY` is configured
- `KNOWLEDGE_COLLECTION` points to the expected Mongo collection

## Final Summary

Mind Viz Agents is a multi-agent analytics prototype for Mind Platform. Its core strength is the separation between LLM reasoning and deterministic backend execution:

- LLM decides the plan.
- Backend code builds the query.
- MongoDB executes with tenant guard.
- Writer/chart logic formats the result.

The main thing the team should remember:

The JSON export is knowledge context. The MongoDB query is generated at runtime and can be exposed through audit. Dashboard already exposes it; report and inquiry should be updated next if full query traceability is required.
