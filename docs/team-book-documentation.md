# Mind Viz Agents - Team Book Documentation

Version: 0.1.0  
Project path: `MindAi-main`  
Main runtime: Node.js, TypeScript, Express, Mastra, MongoDB, ECharts

## How To Use This Document

This is the long-form team documentation for the app. It is written for people who need to understand the product, the technical flow, and the current limits without reading every source file first.

Use it in this order:

1. Read Chapters 1 to 4 for the big picture.
2. Use Chapter 5 when presenting the live UI.
3. Use Chapters 6 to 11 for technical questions from developers.
4. Use Chapter 12 for demo prompts and API examples.
5. Use Chapters 13 to 16 for setup, operations, troubleshooting, and future work.

## Table Of Contents

1. Executive Summary
2. Product Purpose
3. Glossary
4. High-Level Architecture
5. User Interface Walkthrough
6. API Reference In Plain English
7. Request Lifecycle
8. Agents And Workflows
9. Data Model
10. MongoDB Query Engine
11. Chart Engine
12. Demo Guide
13. Setup And Operations
14. Folder And File Guide
15. Security, Safety, And Limits
16. How To Extend The App
17. Troubleshooting
18. Team Presentation Script

---

# 1. Executive Summary

Mind Viz Agents is an analytics service for the Mind Platform. It lets a user ask a natural-language question, then turns that question into:

- A single dashboard chart.
- A written analytical report.
- A search/inquiry answer with links to matching records.

The app uses:

- `Express` for the HTTP server.
- `MongoDB` for platform metadata, business records, and conversation memory.
- `Mastra` for workflow orchestration and agent registration.
- `OpenRouter` or `Groq` for LLM calls.
- `ECharts` in the browser for chart rendering.

The important idea is this:

```text
User question
  -> API endpoint
  -> Supervisor creates a TaskPlan
  -> MongoDB pipeline is built safely from that TaskPlan
  -> Data rows are validated
  -> Writer or chart runtime formats the result
  -> UI displays chart, report, or inquiry answer
```

The app is currently a focused analytics/review console. It is not a full Mind Platform frontend, not a CRUD app, and not a production authentication gateway.

---

# 2. Product Purpose

## What The App Does

The app answers questions about municipal-style operational data imported from DB export collections:

- Service requests.
- Inspections.
- Permits.
- Projects.

Example questions:

```text
service request count by municipality this month
daily service request count over the last 30 days
open permits by municipality
find recent service requests where status is new
analyze average processingDays by permitType
```

The app understands the available data through metadata stored in MongoDB. That metadata tells the app:

- Data store name.
- MongoDB collection name.
- Field names.
- Field types.
- Field roles, such as dimension, measure, temporal, or id.
- Enum values.

This metadata-driven approach is the main design. The app should not need hardcoded business logic for every new data collection. If a data store is described correctly, the planner and query engine can use it.

## What The App Produces

The app has three output modes:

| Mode | Endpoint | Output |
| --- | --- | --- |
| Dashboard | `POST /api/dashboard` | One ECharts chart and audit details |
| Report | `POST /api/report` | Arabic report sections, optional chart |
| Inquiry | `POST /api/inquiry` | Arabic summary and up to 10 record links |

## What Makes It Useful

The app gives a team a way to test an analytics-agent workflow end to end:

- Natural-language planning.
- Permission-scoped MongoDB querying.
- Deterministic aggregation building.
- Deterministic chart rendering.
- Conversation memory for follow-up prompts.
- Audit output showing the TaskPlan and MongoDB pipeline.

---

# 3. Glossary

## Data Store

A logical dataset in the platform. It maps to a MongoDB collection.

Example:

```json
{
  "name": "ServiceRequests",
  "collection": "service_requests",
  "fields": []
}
```

## Field

A property inside a data store.

Example fields:

- `municipality`
- `status`
- `createdAt`
- `responseHours`

Each field has a type and usually a role.

## Field Type

The kind of value stored in a field.

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
- `text`

## Field Role

The purpose of the field in analytics.

| Role | Meaning | Example |
| --- | --- | --- |
| `id` | Identifier field | `_id`, `tenantId` |
| `dimension` | Group/filter field | `municipality`, `status` |
| `measure` | Numeric metric | `responseHours`, `feeAmount` |
| `temporal` | Date/time field | `createdAt` |
| `text` | Searchable text field | Future text fields |

## TaskPlan

The structured JSON plan created by the Supervisor Agent. It says what data store to query, what aggregation to use, what fields to group by, and whether a chart or external enrichment is needed.

Example:

```json
{
  "intent": "dashboard",
  "needsData": true,
  "needsEnrichment": false,
  "needsChart": true,
  "query": {
    "dataStoreName": "ServiceRequests",
    "aggregation": "count",
    "dimensions": ["municipality"],
    "topN": 5
  },
  "chartHint": "ranking"
}
```

## Dataset

The normalized rows returned from MongoDB, search, or a merge.

Example:

```json
{
  "rows": [
    { "municipality": "Doha", "value": 120 }
  ],
  "schema": {
    "municipality": "string",
    "value": "number"
  },
  "source": "mongodb"
}
```

## Permission Scope

The security context sent with every API request.

Example:

```json
{
  "userId": "u_review",
  "tenantId": "t_mind_qatar",
  "allowedDataStores": ["ServiceRequests", "Inspections", "Permits", "Projects"]
}
```

The `tenantId` is used as a MongoDB guard. The query engine ensures every aggregation is scoped to the tenant.

## Audit

Extra execution details returned by the API. Audit output is used to explain what happened.

It may include:

- TaskPlan.
- MongoDB pipeline.
- Schema.
- JSON Schema.
- Internal search enrichment data.
- Elapsed time.

## Enrichment

Optional internal context requested by the Supervisor Agent. It is only triggered when the user explicitly asks for internal knowledge, indexed platform context, collection/schema explanations, exported DB context, or documentation inside the platform knowledge corpus.

---

# 4. High-Level Architecture

## System Diagram

```text
Browser UI
  public/index.html
      |
      v
Express server
  src/server.ts
      |
      v
API router
  src/http/api-router.ts
      |
      v
Analytics service
  src/services/analytics-service.ts
      |
      v
Mastra workflows
  src/mastra/workflows/*
      |
      +--> Supervisor planning
      |      src/mastra/runtime/supervisor-runtime.ts
      |
      +--> MongoDB query runtime
      |      src/mastra/runtime/mongodb-runtime.ts
      |      src/analytics/builders/*
      |
      +--> Optional search enrichment
      |      src/mastra/runtime/search-runtime.ts
      |
      +--> Writer runtime
      |      src/mastra/runtime/writer-runtime.ts
      |
      +--> Chart runtime
             src/mastra/runtime/chart-runtime.ts
             src/mastra/tools/chart-tools.ts
```

## Main Components

| Component | Path | Responsibility |
| --- | --- | --- |
| Static UI | `public/index.html` | Review console, prompt input, chart/report rendering, audit panel |
| Server | `src/server.ts` | Express setup, CORS, JSON parsing, static files, API mount |
| API router | `src/http/api-router.ts` | Endpoint handlers, request validation, response validation |
| Contracts | `src/http/contracts.ts` | Zod schemas for request and response shapes |
| Analytics service | `src/services/analytics-service.ts` | Orchestrates API mode, workflows, memory, metadata |
| Conversation memory | `src/services/conversation-memory.ts` | Stores and reloads recent turns |
| Mastra registry | `src/mastra/index.ts` | Registers agents and workflows |
| Supervisor runtime | `src/mastra/runtime/supervisor-runtime.ts` | Calls planner agent and finalizes TaskPlan |
| MongoDB runtime | `src/mastra/runtime/mongodb-runtime.ts` | Runs deterministic MongoDB query path |
| Query builders | `src/analytics/builders/*` | Build safe aggregation stages |
| Chart runtime | `src/mastra/runtime/chart-runtime.ts` | Calls chart planner, validates plan, builds ECharts option |
| Writer runtime | `src/mastra/runtime/writer-runtime.ts` | Writes Arabic summaries and reports |
| Search runtime | `src/mastra/runtime/search-runtime.ts` | Optional enrichment through search agent |
| Data store repository | `src/db/datastore.repository.ts` | Loads data store metadata from MongoDB |
| Mongo client | `src/db/mongo.client.ts` | Connects and caches MongoDB client |
| Logger | `src/observability/log.ts` | Structured JSON logging |

## Important Architecture Note

The code registers a `MongoDB Agent`, but the active runtime path for MongoDB querying is deterministic. In other words, the app does not let the LLM hand-write arbitrary MongoDB pipelines during normal dashboard/report/inquiry execution.

The safer path is:

```text
TaskPlan JSON
  -> validate fields against metadata
  -> build aggregation stages in TypeScript
  -> enforce tenant guard and blocked stages
  -> execute pipeline
```

This is safer and easier to audit than asking an LLM to directly write database queries.

---

# 5. User Interface Walkthrough

The UI is a single static HTML file:

```text
public/index.html
```

It is served by Express from the root URL:

```text
http://localhost:3000/
```

## UI Layout

The UI has two main areas:

1. Left side request panel.
2. Right side result workspace.

The request panel includes:

- Three mode tabs:
  - Dashboard.
  - Report.
  - Inquiry.
- A prompt textarea.
- A run button.
- Dynamic prompt suggestions loaded from `/api/meta`.
- A simulated progress/status area.

The result workspace includes:

- Chart area.
- Text output area.
- Run status chip.
- Duration chip.
- Collapsible audit panel.

## Hardcoded Demo Scope

The UI sends this scope with requests:

```js
const SCOPE = {
  userId: 'u_review',
  tenantId: 't_mind_qatar',
  allowedDataStores: ['ServiceRequests', 'Inspections', 'Permits', 'Projects'],
};
```

This is fine for a review/demo console. In production, this should come from authentication/session state.

## Dynamic Prompt Suggestions

The UI calls:

```text
GET /api/meta
```

That endpoint returns modes, placeholders, and prompt suggestions. Suggestions are generated from the actual data stores and fields. They are not static examples hardcoded in the UI.

The backend first creates deterministic suggestions. It then tries to use the Writer Agent to polish them. If the LLM call fails or times out, the deterministic suggestions are used.

## Chart Rendering

Dashboard charts and optional report charts are rendered with ECharts.

Important:

- The browser loads ECharts from `https://cdn.jsdelivr.net`.
- If the machine has no internet access, the UI may load but charts may not render unless ECharts is vendored locally.

## Audit Panel

The audit panel is important for team demos. It can show:

- Run ID.
- Conversation thread ID.
- Intent.
- Duration.
- TaskPlan.
- Dataset rows.
- MongoDB pipeline.
- Schema.
- JSON Schema.
- Enrichment data and citations.

This makes the app explainable. You can show the team exactly how a natural-language prompt became a data query.

---

# 6. API Reference In Plain English

Base URL:

```text
http://localhost:3000
```

## Health Check

```http
GET /health
```

Returns:

```json
{ "ok": true }
```

Use this to confirm the Express server is running.

## Metadata

```http
GET /api/meta
```

Returns:

- App title and subtitle.
- Stack list.
- UI mode definitions.
- Prompt suggestions.
- Capability matrix.

This endpoint powers the UI examples.

## Shared Request Shape

The three POST endpoints use the same request schema.

```json
{
  "prompt": "service request count by municipality this month",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedDataStores": ["ServiceRequests", "Inspections", "Permits", "Projects"]
  },
  "dataStoreName": "ServiceRequests",
  "theme": "light",
  "threadId": "optional-thread-id",
  "resourceId": "optional-resource-id"
}
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `prompt` | Yes | User question, max 4000 chars |
| `scope.userId` | Yes | User ID for audit/memory |
| `scope.tenantId` | Yes | Tenant guard for MongoDB |
| `scope.allowedDataStores` | No | Data stores the user can query |
| `scope.rowFilter` | No | Extra MongoDB filter merged into `$match` |
| `dataStoreName` | No | Hint when UI knows selected data store |
| `theme` | No | `light`, `dark`, or `brand`; dashboard uses it |
| `threadId` | No | Conversation memory thread |
| `resourceId` | No | Conversation memory resource |

## Dashboard Endpoint

```http
POST /api/dashboard
```

Purpose:

- Return exactly one chart.
- Best for comparisons, rankings, trends, and metrics.

Response shape:

```json
{
  "intent": "dashboard",
  "chart": {
    "chartType": "bar",
    "option": {},
    "title": "service request count by municipality",
    "accessibility": {
      "description": "..."
    }
  },
  "conversation": {
    "threadId": "...",
    "resourceId": "..."
  },
  "audit": {
    "plan": {},
    "pipeline": [],
    "schema": {},
    "jsonSchema": {},
    "enrichment": {},
    "elapsedMs": 1234
  }
}
```

## Report Endpoint

```http
POST /api/report
```

Purpose:

- Return a short Arabic analyst-style report.
- Include a chart only when the plan says one is needed.

Response shape:

```json
{
  "intent": "report",
  "reportSections": [
    {
      "heading": "ملخص",
      "body": "..."
    }
  ],
  "charts": [],
  "conversation": {
    "threadId": "...",
    "resourceId": "..."
  },
  "audit": {
    "plan": {},
    "dataset": {},
    "elapsedMs": 1234
  }
}
```

## Inquiry Endpoint

```http
POST /api/inquiry
```

Purpose:

- Search/fetch matching records.
- Summarize them in Arabic.
- Return up to 10 record links.

Response shape:

```json
{
  "intent": "general_question",
  "summary": "...",
  "recordLinks": [
    {
      "collection": "service_requests",
      "id": "sr_1",
      "label": "Record 1"
    }
  ],
  "conversation": {
    "threadId": "...",
    "resourceId": "..."
  },
  "audit": {
    "plan": {},
    "elapsedMs": 1234
  }
}
```

## Error Responses

Validation errors return HTTP 400.

Server/runtime errors return HTTP 500.

Errors are currently returned with Arabic messages in some cases, because the UI and writer output are Arabic-oriented.

---

# 7. Request Lifecycle

## Lifecycle For All POST Requests

Every POST request follows this outer pattern:

```text
1. Express receives request.
2. Zod validates request body.
3. API creates a run ID.
4. AnalyticsService resolves conversation memory.
5. AnalyticsService starts the matching Mastra workflow.
6. Workflow returns result.
7. AnalyticsService saves conversation memory.
8. Zod validates response shape.
9. API sends JSON response with x-run-id header.
```

The API router lives in:

```text
src/http/api-router.ts
```

The response/request schemas live in:

```text
src/http/contracts.ts
```

## Conversation Memory

Conversation memory is handled in:

```text
src/services/conversation-memory.ts
```

How it works:

1. The request may include `threadId` and `resourceId`.
2. If missing, fallback IDs are generated from tenant and user.
3. The app loads the last 8 turns from MongoDB collection `conversation_memory`.
4. Those turns are added to the planning prompt.
5. After the workflow finishes, the app saves:
   - One user turn.
   - One assistant turn.

Important:

- Conversation memory is used only to resolve follow-up references and user preferences.
- Current MongoDB data and the current request still take priority.
- Stored content is normalized and truncated to 4000 characters.

## Dashboard Lifecycle

Code path:

```text
POST /api/dashboard
  -> analyticsService.runDashboard()
  -> dashboardWorkflow
```

Workflow:

```text
plan
  -> parallel:
       query MongoDB
       optional enrichment
  -> merge primary and enrichment if needed
  -> chart runtime
```

The dashboard returns:

- `chart`
- `conversation`
- `audit.plan`
- `audit.pipeline`
- `audit.schema`
- `audit.jsonSchema`
- `audit.enrichment`
- `audit.elapsedMs`

## Report Lifecycle

Code path:

```text
POST /api/report
  -> analyticsService.runReport()
  -> reportWorkflow
```

Workflow:

```text
plan
  -> parallel:
       query MongoDB
       optional enrichment
  -> gather
  -> parallel:
       write report sections
       optionally build chart
  -> finalize
```

The report returns:

- `reportSections`
- optional `charts`
- `conversation`
- `audit.plan`
- optional `audit.dataset`
- `audit.elapsedMs`

## Inquiry Lifecycle

Code path:

```text
POST /api/inquiry
  -> analyticsService.runInquiry()
  -> generalQuestionWorkflow
```

Workflow:

```text
plan
  -> parallel:
       fetch matching records from MongoDB
       optional context retrieval
  -> choose MongoDB records or retrieved context
  -> writer summary
  -> record links
```

The inquiry returns:

- `summary`
- `recordLinks`
- `conversation`
- `audit.plan`
- `audit.elapsedMs`

---

# 8. Agents And Workflows

Agents are registered in:

```text
src/mastra/index.ts
```

Registered agents:

- `supervisorAgent`
- `mongodbAgent`
- `searchAgent`
- `writerAgent`
- `chartPlannerAgent`

Registered workflows:

- `dashboardWorkflow`
- `reportWorkflow`
- `generalQuestionWorkflow`

## Supervisor Agent

File:

```text
src/mastra/agents/supervisor.ts
```

Role:

- Convert natural language into a compact TaskPlan JSON object.
- Choose intent.
- Choose data store.
- Choose aggregation, dimensions, filters, time range, and chart hint.
- Decide whether enrichment is needed.

Rules enforced by prompt and code:

- Dashboard always needs data and a chart.
- Report needs data, and only needs a chart if the user asks.
- Inquiry needs data, no chart.
- `top N` becomes `topN`.
- Counts use `aggregation: "count"` and no metric.
- Sum/average queries use measure fields.
- Unknown fields are not allowed.
- `_id` and `tenantId` must not be dimensions.
- Internal search enrichment is only for explicit internal knowledge, schema, data model, documentation, or exported DB context requests.

## Supervisor Runtime

File:

```text
src/mastra/runtime/supervisor-runtime.ts
```

Role:

- Loads accessible data stores from MongoDB.
- Sends compact metadata to the Supervisor Agent.
- Parses output as `taskPlanSchema`.
- Calls `finalizeTaskPlan`.

`finalizeTaskPlan` is important. It repairs and normalizes the plan:

- Forces correct endpoint intent.
- Normalizes data store names.
- Normalizes field names.
- Removes fields that do not exist.
- Infers common dimensions from words like `by municipality`.
- Infers filters like open permits, violations, urgent priority.
- Infers relative time ranges like today, yesterday, last N days, this month, this year.
- Infers chart hints like ranking, trend, part of whole.
- Adds temporal dimension for trend charts.

## MongoDB Agent

File:

```text
src/mastra/agents/mongodb.ts
```

Role as registered:

- Exposes tools for Data Store resolution, aggregation building, pipeline execution, and row validation.
- Defines the data-layer contract.

Important current behavior:

- Normal workflow execution uses `src/mastra/runtime/mongodb-runtime.ts`.
- That runtime calls deterministic TypeScript builders directly.
- This keeps database access safer and easier to inspect.

## Internal Search Agent

File:

```text
src/mastra/agents/search.ts
```

Role:

- Retrieve internal contextual enrichment only when requested by the plan.
- It uses `vectorSearch` over exported internal knowledge.
- If semantic embeddings are available, vector search uses them. Otherwise it uses local lexical search over `samples/db-export`.
- It does not use web search, web fetch, scraping, public benchmarks, or geocoding.

## Writer Agent

File:

```text
src/mastra/agents/writer.ts
```

Role:

- Write inquiry summaries in Arabic.
- Write report sections in Arabic.
- Ground text in the provided dataset only.

Rules:

- Inquiry summaries should be 2 to 4 sentences.
- Reports should be concise analyst briefs.
- If dataset is empty, say no matching data was found.
- Return JSON only.

## Chart Planner Agent

File:

```text
src/mastra/agents/chart.ts
```

Role:

- Decide how to map dataset fields to a chart.
- Pick chart type.
- Pick x-axis field.
- Pick y-axis field.
- Optionally pick a grouping field.
- Return a chart plan JSON object.

Important:

- It sees the dataset schema, up to 3 sample rows, row count, the user prompt, and Supervisor hints.
- It does not render the chart.
- Rendering is deterministic in `chart-tools.ts`.

## Model Provider

File:

```text
src/mastra/model.ts
```

Supported providers:

- `openrouter`
- `groq`

If `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY` is required.

If `LLM_PROVIDER=groq`, `GROQ_API_KEY` is required.

Important model detail:

- `.env.example` sets `OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`.
- The code fallback, if no OpenRouter env model is set, is `meta-llama/llama-3.3-70b-instruct:free`.

Optional LLM serialization is available with:

```text
src/mastra/runtime/llm-queue.ts
```

Set `LLM_SERIAL_QUEUE=1` if you want Supervisor planning calls to run one at a time.

---

# 9. Data Model

## Metadata Collection

The app requires this MongoDB collection:

```text
data_stores
```

The app does not fall back to local sample files at runtime. The sample files are used for seeding/importing.

If `data_stores` is empty, the app throws:

```text
No data stores found. Seed or provision the "data_stores" collection with fields.
```

## Seeded Data Stores

The default seed creates four data stores.

### ServiceRequests

MongoDB collection:

```text
service_requests
```

Description:

Citizen and operational service requests managed through Mind Platform workflows.

Fields:

| Field | Type | Role |
| --- | --- | --- |
| `_id` | `string` | `id` |
| `tenantId` | `string` | `id` |
| `requestNumber` | `string` | `dimension` |
| `municipality` | `string` | `dimension` |
| `zone` | `string` | `dimension` |
| `district` | `string` | `dimension` |
| `topic` | `string` | `dimension` |
| `serviceType` | `string` | `dimension` |
| `status` | `enum` | `dimension` |
| `priority` | `enum` | `dimension` |
| `channel` | `enum` | `dimension` |
| `responseHours` | `number` | `measure` |
| `resolutionDays` | `number` | `measure` |
| `createdAt` | `datetime` | `temporal` |

Enum values:

- `status`: `new`, `in_review`, `in_progress`, `resolved`, `closed`
- `priority`: `low`, `medium`, `high`, `urgent`
- `channel`: `mobile_app`, `call_center`, `portal`, `field_team`

Seed count:

- 700 records.

### Inspections

MongoDB collection:

```text
inspections
```

Description:

Field inspections and compliance assessments for municipal operations.

Fields:

| Field | Type | Role |
| --- | --- | --- |
| `_id` | `string` | `id` |
| `tenantId` | `string` | `id` |
| `municipality` | `string` | `dimension` |
| `zone` | `string` | `dimension` |
| `inspectionType` | `string` | `dimension` |
| `outcome` | `enum` | `dimension` |
| `inspectorTeam` | `string` | `dimension` |
| `score` | `number` | `measure` |
| `createdAt` | `datetime` | `temporal` |

Enum values:

- `outcome`: `compliant`, `warning`, `violation`, `follow_up`

Seed count:

- 260 records.

### Permits

MongoDB collection:

```text
permits
```

Description:

Permit applications and approval workflow records.

Fields:

| Field | Type | Role |
| --- | --- | --- |
| `_id` | `string` | `id` |
| `tenantId` | `string` | `id` |
| `permitNumber` | `string` | `dimension` |
| `municipality` | `string` | `dimension` |
| `zone` | `string` | `dimension` |
| `permitType` | `string` | `dimension` |
| `status` | `enum` | `dimension` |
| `applicantType` | `enum` | `dimension` |
| `processingDays` | `number` | `measure` |
| `feeAmount` | `number` | `measure` |
| `createdAt` | `datetime` | `temporal` |

Enum values:

- `status`: `submitted`, `under_review`, `approved`, `rejected`, `expired`
- `applicantType`: `individual`, `business`, `government`

Seed count:

- 240 records.

### Projects

MongoDB collection:

```text
projects
```

Description:

Municipal projects and initiatives tracked for delivery performance.

Fields:

| Field | Type | Role |
| --- | --- | --- |
| `_id` | `string` | `id` |
| `tenantId` | `string` | `id` |
| `name` | `string` | `dimension` |
| `municipality` | `string` | `dimension` |
| `projectType` | `string` | `dimension` |
| `stage` | `enum` | `dimension` |
| `contractor` | `string` | `dimension` |
| `budgetAmount` | `number` | `measure` |
| `completionPercent` | `number` | `measure` |
| `createdAt` | `datetime` | `temporal` |

Enum values:

- `stage`: `planning`, `procurement`, `execution`, `handover`, `completed`

Seed count:

- 140 records.

## Import DB Export Script

File:

```text
scripts/import-db-export.ts
```

This imports exported JSON collections from:

```text
samples/db-export
```

Default imported collections:

- `service_requests`
- `inspections`
- `permits`
- `projects`

Environment variables:

| Variable | Meaning |
| --- | --- |
| `IMPORT_COLLECTIONS` | Comma-separated selected collections |
| `IMPORT_TENANT_ID` | Tenant ID to inject when missing |
| `IMPORT_MODE` | `replace` or `append` |

The script only allows a safe collection list. It refuses unknown collection names unless the code is updated.

---

# 10. MongoDB Query Engine

## Why The Query Engine Matters

The query engine is the safety layer between the LLM-generated TaskPlan and MongoDB.

The LLM does not directly execute database code. Instead:

```text
TaskPlan
  -> validate scope
  -> validate fields
  -> build stages
  -> enforce safety
  -> execute
  -> validate rows
```

## Main Files

| File | Purpose |
| --- | --- |
| `src/mastra/runtime/mongodb-runtime.ts` | Starts dataset query or record fetch |
| `src/mastra/tools/mongodb-tools.ts` | Tool contracts and shared functions |
| `src/analytics/builders/build-pipeline.ts` | Assembles full aggregation pipeline |
| `src/analytics/executor/run-aggregation.ts` | Executes pipeline with safety checks |
| `src/analytics/validators/*` | Removes invalid fields/lookups/time ranges |

## Build Pipeline Order

The pipeline is built in this order:

```text
1. $match
2. $lookup / $unwind stages
3. $group
4. having $match
5. $project
6. percent-of-total stages
7. $sort
8. $limit
```

## Match Stage

File:

```text
src/analytics/builders/build-match-stage.ts
```

Always starts with:

```json
{ "tenantId": "..." }
```

It also includes:

- `scope.rowFilter`
- TaskPlan filters
- Time range filters

Supported filter operators:

- `eq`
- `ne`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`
- `nin`
- `regex`

Regex filters are case-insensitive.

## Group Stage

File:

```text
src/analytics/builders/build-group-stage.ts
```

Used when the plan has dimensions or aggregation.

Behavior:

- Temporal dimensions are formatted as `%Y-%m-%d`.
- `count` becomes `{ "$sum": 1 }`.
- `sum`, `avg`, `min`, `max` use the selected metric.
- Output primary metric is named `value`.
- Extra metrics keep their metric field names.

## Project Stage

File:

```text
src/analytics/builders/build-project-stage.ts
```

Turns grouped `_id` fields back into normal output columns.

Example output:

```json
{
  "municipality": "Doha",
  "value": 120
}
```

## Percent Stage

File:

```text
src/analytics/builders/build-percent-stage.ts
```

If `query.percentOf` is present, the app adds:

- Total window calculation.
- `percent` field rounded to 1 decimal.
- Cleanup projection.

## Sort Stage

File:

```text
src/analytics/builders/build-sort-stage.ts
```

Behavior:

- If `topN` exists, sort by `value` descending.
- Otherwise use explicit `query.sort`.

## Limit Stage

File:

```text
src/analytics/builders/build-limit-stage.ts
```

Defaults:

- Default limit: 1000.
- Maximum limit: 5000.
- `topN` overrides `limit`.

## Lookup Stages

File:

```text
src/analytics/builders/build-lookup-stage.ts
```

Supports `$lookup` and `$unwind`, but only if the lookup is defined in the data store metadata joins.

## Safety Enforcement

File:

```text
src/analytics/executor/run-aggregation.ts
```

Safety rules:

- Maximum pipeline stages: 25.
- Blocked stages:
  - `$function`
  - `$merge`
  - `$out`
  - `$where`
- Tenant guard is enforced. If the first `$match` does not include the tenant, the executor prepends one.
- Aggregation timeout: 30 seconds.

## Row Validation

After query execution, rows are normalized:

- `string`, `number`, `boolean`, and `null` are kept.
- Dates become ISO strings.
- Other values become strings.
- A schema and JSON Schema are created for downstream chart/report agents.

---

# 11. Chart Engine

## Main Files

| File | Purpose |
| --- | --- |
| `src/mastra/runtime/chart-runtime.ts` | Calls planner, sanitizes plan, builds chart |
| `src/mastra/agents/chart.ts` | Chart Planner Agent instructions |
| `src/mastra/tools/chart-tools.ts` | Deterministic ECharts option builder |
| `src/mastra/schemas/chart.ts` | Chart schemas |

## Chart Flow

```text
Dataset
  -> get candidate chart types
  -> Chart Planner sees schema, tiny sample, row count, prompt, and Supervisor hints
  -> planner returns ChartPlan
  -> runtime sanitizes fields and chart type
  -> deterministic builder returns ECharts option
```

## Supported Chart Types

- `line`
- `bar`
- `horizontalBar`
- `scatter`
- `donut`
- `map`
- `histogram`
- `table`

## Intent Hints

TaskPlan can include `chartHint`:

| Hint | Typical chart |
| --- | --- |
| `trend` | `line` |
| `ranking` | `horizontalBar` |
| `compare` | `bar` or `horizontalBar` |
| `part_of_whole` | `donut` or bar if too many categories |
| `distribution` | `histogram` |
| `geo` | `map` or horizontal bar |

## Dataset Field Rules

The chart builder looks for:

- Numeric measure fields such as `value`, `count`, `total`, `sum`, `average`, `avg`, `amount`, `score`, `rate`.
- Temporal fields for line charts.
- String or boolean fields for categories.
- Geo fields for maps.

Technical fields are excluded:

- `_id`
- `tenantId`
- fields ending in `Id`
- fields starting with `__`

## Chart Output

Each chart result includes:

```json
{
  "chartType": "bar",
  "option": {},
  "title": "...",
  "accessibility": {
    "description": "..."
  }
}
```

The frontend passes `option` directly to ECharts:

```js
chart.setOption(chartData.option, true);
```

---

# 12. Demo Guide

## Start The App

```powershell
copy .env.example .env
npm install
npm run db:up
npm run db:wait
npm run import:db-export
npm run dev
```

Open:

```text
http://localhost:3000
```

## Good Dashboard Prompts

```text
service request count by municipality this month
daily service request count over the last 30 days
top 5 municipalities by service request count
average responseHours by serviceType
open permits by municipality
average processingDays by permitType
inspection score by municipality
project budgetAmount by contractor
completed projects by municipality
```

## Good Report Prompts

```text
analyze service request volume by municipality over the last 90 days and surface key trends
analyze average responseHours by serviceType
compare permits by status
analyze project budgetAmount by municipality
analyze inspections by outcome
```

## Good Inquiry Prompts

```text
find recent service requests where status is new
show service requests from the last 7 days
find urgent service requests
find open permits
find violations
find completed projects
```

## API Demo With REST Client

The file:

```text
requests.http
```

contains ready-to-send requests for the VS Code REST Client extension.

## Demo Talking Points

When showing the UI:

1. Pick Dashboard mode.
2. Run `service request count by municipality this month`.
3. Open audit details.
4. Show the TaskPlan.
5. Show the MongoDB pipeline.
6. Explain the tenant guard.
7. Switch to Report mode.
8. Run a report prompt.
9. Show Arabic report sections.
10. Switch to Inquiry mode.
11. Run a record search and show record links.

---

# 13. Setup And Operations

## Prerequisites

- Node.js 20.9 or newer.
- Docker Desktop for local MongoDB.
- OpenRouter API key.
- Optional: Groq API key.

## Environment

Copy:

```powershell
copy .env.example .env
```

Core variables:

| Variable | Meaning |
| --- | --- |
| `PORT` | Express port, default 3000 |
| `MONGODB_URI` | MongoDB connection URI |
| `MONGODB_DB` | Database name |
| `LLM_PROVIDER` | `openrouter` or `groq` |
| `OPENROUTER_API_KEY` | Required if `LLM_PROVIDER=openrouter` |
| `OPENROUTER_MODEL` | Default OpenRouter chat model |
| `GROQ_API_KEY` | Required if `LLM_PROVIDER=groq` |

Timeout variables:

| Variable | Default purpose |
| --- | --- |
| `SUPERVISOR_TIMEOUT_MS` | Planner timeout |
| `WRITER_TIMEOUT_MS` | Writer timeout |
| `CHART_TIMEOUT_MS` | Chart planner timeout |
| `META_GENERATION_TIMEOUT_MS` | `/api/meta` LLM polishing timeout |
| `WORKFLOW_TIMEOUT_MS` | Workflow timeout |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | MongoDB connection timeout |
| `MONGODB_CONNECT_RETRIES` | MongoDB connect retry count |

## NPM Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run TypeScript server in watch mode |
| `npm run build` | Type-check TypeScript without emitting files |
| `npm start` | Run the TypeScript app with `tsx src/server.ts` |
| `npm run typecheck` | Type-check TypeScript without emitting files |
| `npm run import:db-export` | Import data store metadata and exported collections |
| `npm run smoke` | Run smoke checks against HTTP server |
| `npm run knowledge:index` | Build internal knowledge index |
| `npm run db:check` | Check MongoDB connection |
| `npm run db:up` | Start MongoDB and mongo-express via Docker |
| `npm run db:down` | Stop Docker services |
| `npm run db:reset` | Start DB, wait, and seed |

## Docker Services

File:

```text
docker-compose.yml
```

Services:

| Service | Port | Purpose |
| --- | --- | --- |
| `mongo` | `27017` | MongoDB 7 |
| `mongo-express` | `8081` | Browser UI for MongoDB |

Mongo Express:

```text
http://localhost:8081
```

## Logs

Logger file:

```text
src/observability/log.ts
```

The app logs structured JSON rows with:

- timestamp
- level
- message
- runId
- workflow
- step
- agent
- tenantId
- durationMs

Set:

```text
LOG_LEVEL=debug
LOG_PRETTY=1
```

to make local logs more verbose and readable.

---

# 14. Folder And File Guide

## Root Files

| File | Purpose |
| --- | --- |
| `package.json` | Scripts, dependencies, app metadata |
| `tsconfig.json` | TypeScript config |
| `.env.example` | Example environment variables |
| `docker-compose.yml` | Local MongoDB and Mongo Express |
| `README.md` | Short project intro |
| `requests.http` | Manual API request examples |

## `public`

| File | Purpose |
| --- | --- |
| `public/index.html` | Full review UI, CSS, and browser JS |

## `src/http`

| File | Purpose |
| --- | --- |
| `api-router.ts` | Express routes and error handling |
| `contracts.ts` | Zod request/response contracts |

## `src/services`

| File | Purpose |
| --- | --- |
| `analytics-service.ts` | Main application orchestration |
| `conversation-memory.ts` | Conversation storage and retrieval |

## `src/db`

| File | Purpose |
| --- | --- |
| `mongo.client.ts` | MongoDB connection lifecycle |
| `datastore.repository.ts` | Loads data store metadata |

## `src/mastra`

| File/Folder | Purpose |
| --- | --- |
| `index.ts` | Registers agents and workflows |
| `model.ts` | Chooses OpenRouter or Groq model |
| `task-plan.ts` | Normalizes and repairs TaskPlan |
| `agents/*` | Agent definitions and instructions |
| `workflows/*` | Dashboard, report, inquiry workflows |
| `runtime/*` | Runtime helpers for each agent role |
| `schemas/*` | Zod schemas for datastore, intent, chart |
| `tools/*` | Tool contracts and deterministic helpers |

## `src/analytics`

| Folder | Purpose |
| --- | --- |
| `builders` | MongoDB aggregation stage builders |
| `executor` | Safe aggregation execution |
| `helpers` | Field-role helpers |
| `schemas` | Analytics-specific schemas |
| `validators` | TaskPlan validation against metadata |

## `scripts`

| File | Purpose |
| --- | --- |
| `import-db-export.ts` | Import data store metadata and exported JSON collections |
| `check-mongo.ts` | Check MongoDB connection |
| `smoke.ts` | Run HTTP smoke tests |
| `build-knowledge-index.ts` | Build internal knowledge index |

## `samples`

| Path | Purpose |
| --- | --- |
| `samples/datastore.json` | Default data store metadata |
| `samples/db-export/*.json` | Exported platform collections |

## `docs`

Existing short docs:

- `architecture.md`
- `api-reference.md`
- `data-model.md`
- `setup-and-operations.md`
- `development-and-extension.md`
- `troubleshooting.md`

This file is the expanded book-style version.

---

# 15. Security, Safety, And Limits

## Current Safety Features

The app has several important guards:

- Request validation with Zod.
- Response validation with Zod.
- Tenant guard in every MongoDB aggregation.
- Data store allow-list through `scope.allowedDataStores`.
- Field validation against data store metadata.
- Lookup validation against declared joins.
- Pipeline stage limit.
- Blocked unsafe MongoDB aggregation stages.
- Aggregation timeout.
- LLM output parsing into strict schemas.
- Chart planner only sees schema, up to 3 sample rows, row count, prompt, and Supervisor hints.

## Current Writes

Normal analytics queries are read-only against business data.

The app does write in these cases:

- `scripts/import-db-export.ts` writes imported data.
- API requests write conversation turns to `conversation_memory`.

## Current Limitations

These are known current limits:

- No production authentication.
- UI scope is hardcoded for demo.
- No NestJS gateway.
- No Angular shell.
- No Nx workspace.
- No live server-sent progress stream. The UI shows simulated progress.
- Internal search enrichment does not require Tavily or Brave.
- ECharts is loaded from CDN.
- MongoDB metadata is cached in memory and does not auto-refresh during a long-running process.
- Chart planner failure can fail chart generation.
- Report output is Arabic by design.
- General inquiry returns record links as labels, not full clickable platform URLs.
- The app does not provide create/update/delete operations for platform records.

## Capability Matrix From App

Current completed capabilities:

- Mastra workflow orchestration.
- MongoDB analytics query path.
- Supervisor, search, writer, and chart roles.
- Dashboard, report, and inquiry modes.
- Deterministic chart rendering path.

Partial capabilities:

- External enrichment providers.
- Extra chart-agent improvements beyond deterministic rendering.
- Shared merge/normalization stage.
- Parallel coordination for independent work.

Missing capabilities:

- NestJS gateway and Nx workspace.
- Angular app shell.
- Live progress streaming.
- Auth-injected permission scope.
- Internal vector search and geo maps fully configured.
- MongoDB create/update/link operations.

---

# 16. How To Extend The App

## Add A New Data Store

1. Add metadata to MongoDB collection `data_stores`.
2. Make sure fields have names, types, and useful roles.
3. Add records to the MongoDB collection named by `collection`.
4. Include the data store in `scope.allowedDataStores`.
5. Restart the server if metadata was cached before the new store was added.
6. Test with `/api/meta` and dashboard prompts.

Good metadata is critical. The Supervisor and query engine can only use fields that metadata exposes.

## Add A New Field

1. Add field to real MongoDB documents.
2. Add field metadata in `data_stores`.
3. Pick a correct role:
   - Use `dimension` for grouping/filtering.
   - Use `measure` for numeric aggregation.
   - Use `temporal` for date/time filtering and trends.
4. Restart the server if needed.
5. Test a prompt that uses the field.

## Add A New Filter Synonym

File:

```text
src/mastra/task-plan.ts
```

Look at:

```text
inferPromptFilters()
localizeEnumValue()
```

Add new English/Arabic phrases there.

## Add A New Dimension Alias

File:

```text
src/mastra/task-plan.ts
```

Look at:

```text
inferPromptDimensions()
```

Add a pattern mapping:

```ts
{ pattern: /\bby\s+newfield\b/, field: 'newField' }
```

## Add A New Chart Type

Files:

```text
src/mastra/schemas/chart.ts
src/mastra/tools/chart-tools.ts
src/mastra/agents/chart.ts
```

Steps:

1. Add chart type to `chartTypeSchema`.
2. Add candidate selection in `getChartTypeCandidates`.
3. Add rendering logic in `buildChartFromDataset`.
4. Update chart planner instructions.
5. Update frontend label mapping in `public/index.html`.

## Add A New Endpoint

Files likely involved:

```text
src/http/contracts.ts
src/http/api-router.ts
src/services/analytics-service.ts
src/mastra/workflows/*
```

Steps:

1. Define request and response schemas.
2. Add router handler.
3. Add service method.
4. Add Mastra workflow if needed.
5. Add UI mode if frontend should expose it.
6. Add smoke test case.

## Add Production Authentication

Current demo sends scope from the frontend. Production should not trust that.

Recommended direction:

1. Authenticate user before API handlers.
2. Derive `userId`, `tenantId`, `allowedDataStores`, and `rowFilter` server-side.
3. Remove hardcoded frontend scope.
4. Keep tenant guard in query executor as defense in depth.

## Vendor ECharts Locally

Current UI loads:

```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

For offline environments:

1. Install or download ECharts.
2. Serve it from `public`.
3. Update the script tag.

---

# 17. Troubleshooting

## Server Does Not Start

Check:

```powershell
npm install
npm run typecheck
```

Make sure Node.js is 20.9 or newer.

## MongoDB Connection Refused

Error may look like:

```text
connect ECONNREFUSED 127.0.0.1:27017
```

Fix:

```powershell
npm run db:up
npm run db:wait
npm run import:db-export
```

## No Data Stores Found

Problem:

```text
No data stores found
```

Fix:

```powershell
npm run import:db-export
```

Then check MongoDB collection:

```text
data_stores
```

## LLM Provider Errors

Check:

- `LLM_PROVIDER=openrouter` has `OPENROUTER_API_KEY`.
- or `LLM_PROVIDER=groq` has `GROQ_API_KEY`.
- The selected model exists for the selected provider.

## Groq Configuration

If using Groq:

```text
LLM_PROVIDER=groq
GROQ_API_KEY=...
```

Without `GROQ_API_KEY`, the app throws a clear error.

## Internal Search Enrichment Fails

Normal MongoDB analytics do not require internal search.

If semantic knowledge search is empty, build the index:

```powershell
npm run knowledge:index
```

If the index is unavailable, runtime vector search uses local lexical search over exported DB JSON.

## Charts Do Not Render

Possible causes:

- Browser cannot load ECharts CDN.
- API returned an error.
- Dataset is empty.
- Chart Planner timed out or returned incomplete plan.

Check:

- Browser console.
- Server logs.
- Audit panel.

## Dashboard Says Dataset Is Empty

Possible causes:

- Prompt filter is too strict.
- Seed date makes "today" empty.
- Wrong tenant ID.
- Wrong data store.
- `allowedDataStores` does not include the target store.

Try:

```text
service request count by municipality
```

without a time range first.

## Smoke Tests Fail

Smoke test command:

```powershell
npm run smoke
```

Before running it:

1. Start MongoDB.
2. Import DB export data.
3. Start app.
4. Confirm `SMOKE_BASE_URL`.

---

# 18. Team Presentation Script

Use this if you need to explain the app in a meeting.

## 30-Second Version

This app is a natural-language analytics service for the Mind Platform. A user asks a question, the Supervisor Agent converts it into a structured TaskPlan, the backend builds a safe MongoDB aggregation from that plan, then the result becomes either a dashboard chart, a report, or an inquiry summary. The important part is that the LLM plans, but TypeScript code validates and executes the database query safely.

## 2-Minute Version

The app has three modes: dashboard, report, and inquiry. Dashboard returns one chart, report returns written Arabic analysis and optional charts, and inquiry returns a summary with record links.

The UI is a single review console. It loads prompt suggestions from `/api/meta`, which are based on the actual MongoDB data store metadata. When a user submits a prompt, the backend validates the request, adds conversation memory, and starts a Mastra workflow.

The Supervisor Agent creates a TaskPlan. That plan is normalized so unknown fields are removed and common phrases like "by municipality" or "last 30 days" become real fields and filters. Then the MongoDB runtime builds a deterministic aggregation pipeline. The executor enforces tenant scope, blocks unsafe stages, limits pipeline size, and validates rows.

For dashboard output, the chart planner chooses how to map fields, and deterministic code builds the ECharts option. For report and inquiry output, the Writer Agent writes Arabic text based only on the returned data.

The audit panel is the best part for review because it shows the TaskPlan, MongoDB pipeline, schema, and timing.

## What To Emphasize

- The app is metadata-driven.
- The UI examples come from real data store metadata.
- The LLM does not directly run arbitrary MongoDB code.
- Tenant filtering is enforced in the backend.
- The app is currently a review/analytics console, not the full production platform.
- Production needs real auth, injected permission scope, and likely a proper frontend shell.

## Suggested Live Demo

1. Open `http://localhost:3000`.
2. Run:

```text
service request count by municipality this month
```

3. Open audit details and show:

- Plan.
- Pipeline.
- Schema.
- Elapsed time.

4. Run report:

```text
analyze service request volume by municipality over the last 90 days and surface key trends
```

5. Run inquiry:

```text
find recent service requests where status is new
```

6. Explain that all three outputs share the same planning/query foundation.

## Likely Team Questions

### Is this production-ready?

Not fully. It is a solid analytics/review service prototype, but production still needs authentication, server-derived permission scope, frontend integration, and operational hardening.

### Does the LLM write MongoDB queries?

Not in the normal runtime path. The LLM creates a structured TaskPlan. TypeScript builders create the MongoDB aggregation safely.

### Can it support more collections?

Yes, if each collection has proper data store metadata and the user's scope allows it.

### Can it answer external benchmark questions?

No. The Search Agent is now internal-only. It can search indexed/exported platform knowledge, but it does not browse the public web or retrieve external benchmarks.

### Why is report text Arabic?

The Writer Agent and UI are currently Arabic-oriented for municipal review. This can be changed by updating writer instructions and UI copy.

### Where do prompt suggestions come from?

From `/api/meta`, generated from data store fields. The app does not rely on static examples in the UI.

---

# Appendix A. One-Page Technical Summary

```text
Express server:
  src/server.ts

Frontend:
  public/index.html

API:
  GET  /health
  GET  /api/meta
  POST /api/dashboard
  POST /api/report
  POST /api/inquiry

Main service:
  src/services/analytics-service.ts

Mastra workflows:
  src/mastra/workflows/dashboard.ts
  src/mastra/workflows/report.ts
  src/mastra/workflows/general-question.ts

Data:
  MongoDB data_stores metadata
  MongoDB service_requests, inspections, permits, projects
  MongoDB conversation_memory

Query safety:
  validates scope
  validates fields
  enforces tenantId
  blocks unsafe stages
  limits pipeline length
  validates rows

Output:
  dashboard -> ECharts chart
  report -> Arabic sections, optional chart
  inquiry -> Arabic summary, record links
```

# Appendix B. Best First Commands

```powershell
npm run db:up
npm run db:wait
npm run import:db-export
npm run dev
```

Then open:

```text
http://localhost:3000
```

# Appendix C. Best First Prompt

```text
service request count by municipality this month
```

If that returns no data because of date timing, use:

```text
service request count by municipality
```
