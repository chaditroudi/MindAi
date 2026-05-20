# System Architecture

## Purpose

Mind Viz Agents is an orchestration service for turning plain-language business questions into structured outputs that can be rendered directly in a product UI. It is designed around three user experiences:

- inquiry: short answers plus links to matching records
- report: narrative analysis with optional charts
- dashboard: exactly one chart for a widget or panel

## Runtime components

### HTTP layer

The Express server in `src/server.ts` exposes the public API and serves the demo page from `public/index.html`.

Endpoints:

- `POST /api/inquiry`
- `POST /api/report`
- `POST /api/dashboard`
- `GET /health`

### Orchestration layer

The Mastra instance in `src/mastra/index.ts` registers:

- 5 agents
- 3 workflows

The workflows provide deterministic sequencing. Agents do not call each other directly.

### Agent layer

#### Supervisor Agent

Defined in `src/mastra/agents/supervisor.ts`.

Responsibilities:

- classify the request intent
- inspect the accessible blueprints
- produce a `TaskPlan` intermediate representation

It is intentionally a planner, not an executor.

#### MongoDB Agent

Defined in `src/mastra/agents/mongodb.ts`.

Responsibilities:

- validate plan fields against the selected data store
- build aggregation pipelines through tools
- execute the pipeline
- normalize rows and emit a compact schema

#### Search Agent

Defined in `src/mastra/agents/search.ts`.

Responsibilities:

- fetch enrichment data not present in MongoDB
- prefer internal semantic search for organization-specific knowledge
- return citation metadata for external context

Current reality:

- public web enrichment requires an explicitly configured provider
- Tavily and Brave are wired for external enrichment
- internal knowledge retrieval uses OpenRouter embeddings plus a Mongo-backed semantic index built from the exported knowledge corpus

#### Chart Agent

Defined in `src/mastra/agents/chart.ts`.

Responsibilities:

- improve chart presentation metadata
- return JSON for title, annotations, and accessibility description
- leave the main chart option structure to the deterministic chart runtime/tool path

#### Writer Agent

Defined in `src/mastra/agents/writer.ts`.

Responsibilities:

- write inquiry summaries
- write report sections
- return strict JSON matching the requested schema

## Workflow design

### Dashboard workflow

Defined in `src/mastra/workflows/dashboard.ts`.

Flow:

1. `plan` asks the supervisor for a `TaskPlan`
2. `query` uses the MongoDB runtime to build data and the executed pipeline
3. `enrich` optionally calls the Search agent
4. `chart` asks the Chart agent for a single `ChartResult`

Output:

- one chart
- audit plan
- executed pipeline

### Report workflow

Defined in `src/mastra/workflows/report.ts`.

Flow:

1. `plan-report` creates the `TaskPlan`
2. `gather` collects MongoDB data and optional enrichment
3. `write-report` asks the writer agent to write structured report sections
4. optional chart generation happens in the same final step

Output:

- `reportSections`
- optional `charts`
- audit plan

Important note:

The report path uses the dedicated writer runtime, but the API audit currently exposes only the plan and elapsed time, not the executed pipeline.

### General-question workflow

Defined in `src/mastra/workflows/general-question.ts`.

Flow:

1. `plan-q` builds the `TaskPlan`
2. `fetch-records` runs a raw-record style query by overriding aggregation fields
3. `retrieve-context` optionally retrieves internal context
4. `summarize` asks the writer agent for a short summary

Output:

- `summary`
- `recordLinks`
- audit plan

Important note:

This workflow intentionally bypasses grouped aggregations and instead returns matching records, capped by the MongoDB tool path.

## Request lifecycle

```text
Client sends prompt + scope
   ->
Server chooses workflow based on endpoint
   ->
Workflow asks Supervisor for TaskPlan
   ->
Workflow decides whether data, enrichment, or charting are required
   ->
MongoDB runtime resolves schema and runs safe pipeline if needed
   ->
Search Agent enriches if needed
   ->
Chart Agent builds chart if needed
   ->
Workflow returns normalized JSON
   ->
Express returns intent-specific response
```

## Safety boundaries

### Blueprint-aware planning

The supervisor receives accessible blueprints and is instructed not to invent fields. The planning layer is schema-aware before any query is attempted.

### Deterministic pipeline construction

Pipeline construction happens in `src/mastra/tools/mongodb-tools.ts`. The LLM returns a structured TaskPlan; backend code translates that plan into a tenant-safe MongoDB aggregation pipeline.

### Tenant isolation

Tenant scoping is enforced in tools, not just prompts:

- `buildAggregationTool` starts with a `tenantId` match
- `executePipelineTool` defensively re-inserts a tenant guard if missing

This is one of the most important guarantees in the system.

### Output normalization

`validateRowsTool` converts rows into scalar-only values and emits a simple field-type map for downstream agents.

### Chart determinism

The chart agent uses `build-echarts` instead of composing ECharts options freehand. That keeps chart selection and option shape predictable.

## Data and control boundaries

### What the LLM decides

- intent classification
- blueprint and data store selection
- metric, dimension, filter, and date-range intent
- whether enrichment is needed
- chart hint
- prose summaries and report sections

### What code decides

- actual HTTP routing
- workflow step order
- pipeline construction
- tenant enforcement
- row normalization
- chart option structure
- runtime MongoDB pipeline construction

## Providers and infrastructure

### Model provider

Model selection lives in `src/mastra/model.ts`.

Supported providers:

- OpenRouter

Selected through environment variables:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`

### MongoDB access

`src/db/mongo.client.ts` creates a singleton Mongo client and requires:

- `MONGODB_URI`
- `MONGODB_DB`

### Blueprint source

`src/db/blueprint.repository.ts` loads blueprints in this order:

1. MongoDB `_blueprints` collection
2. `samples/blueprints.json` fallback

This means the service can run locally even without production blueprint management wired in.

## Demo surface

The demo UI in `public/index.html` is a static page that:

- lets you switch between inquiry, report, and dashboard modes
- posts to the API directly
- renders ECharts output for chart responses
- exposes audit data in a collapsible panel
- shows client-side loading/progress states while a request is running

It is a validation aid, not a production frontend.

### UI architecture

The UI is intentionally lightweight:

- one file: `public/index.html`
- no frontend framework
- no frontend build pipeline
- ECharts loaded from CDN
- plain JavaScript for state and rendering

Main JavaScript state:

| Variable | Purpose |
| --- | --- |
| `currentEndpoint` | Selected API endpoint |
| `EXAMPLES` | Endpoint-specific placeholder text and example prompts |
| `SCOPE` | Demo-only request scope |
| `progressTimer` | Timer for estimated progress updates |
| `progressStageIndex` | Current estimated progress step |
| `PROGRESS_STAGES` | Stage labels/details per endpoint |

Main UI functions:

| Function | Purpose |
| --- | --- |
| `renderExamples()` | Rebuild example prompt buttons for the active endpoint |
| `run()` | Send the API request and handle success/error |
| `startProgress()` | Disable inputs and display loading/progress UI |
| `updateProgress()` | Update elapsed seconds, progress bar, and active step |
| `completeProgress()` | Mark progress complete when response arrives |
| `stopProgress()` | Hide progress UI |
| `resetControls()` | Re-enable inputs after completion/error |
| `render(data)` | Render dashboard/report/inquiry response |

### UI request flow

```text
User selects endpoint tab
  ->
UI updates examples and placeholder
  ->
User enters prompt or clicks example
  ->
run()
  ->
startProgress()
  ->
fetch(currentEndpoint, { prompt, scope })
  ->
render response based on intent
  ->
show audit JSON
  ->
reset controls
```

### UI rendering rules

Dashboard:

- render `data.chart.option` with ECharts
- hide narrative text
- show audit JSON

Report:

- render `data.reportSections`
- render optional `data.charts[0]`
- show audit JSON

Inquiry:

- render `data.summary`
- render `data.recordLinks`
- hide chart
- show audit JSON

Error:

- hide chart
- show error box
- reset controls

### Progress behavior

The frontend progress UI is estimated. It does not receive real backend step events.

Why:

- current API endpoints return one final JSON response
- there is no SSE, WebSocket, or polling endpoint for live workflow status

What the progress UI does:

- makes long LLM requests feel active instead of frozen
- shows endpoint-specific stages
- shows elapsed time
- disables controls to prevent duplicate runs

Production recommendation:

Replace estimated progress with backend-driven progress using a `runId` plus Server-Sent Events, WebSocket, or polling.

### UI audit behavior

The audit panel prints `data.audit` exactly as returned by the API.

Current audit visibility:

- dashboard includes `plan`, `pipeline`, and `elapsedMs`
- report includes `plan` and `elapsedMs`
- inquiry includes `plan` and `elapsedMs`

If the team adds `audit.pipeline` to report/inquiry, the UI will already display it because it renders the full audit object generically.
