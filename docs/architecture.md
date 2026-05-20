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

- 4 agents
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

- inspect normalized dataset shape
- call the deterministic chart builder once
- return an ECharts option object with accessibility metadata

## Workflow design

### Dashboard workflow

Defined in `src/mastra/workflows/dashboard.ts`.

Flow:

1. `plan` asks the supervisor for a `TaskPlan`
2. `query` asks the MongoDB agent for data and the executed pipeline
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
3. `write-report` asks the supervisor to write structured report sections
4. optional chart generation happens in the same final step

Output:

- `reportSections`
- optional `charts`
- audit plan

Important note:

The current implementation does not use a dedicated writer agent. The supervisor is reused for report writing.

### General-question workflow

Defined in `src/mastra/workflows/general-question.ts`.

Flow:

1. `plan-q` builds the `TaskPlan`
2. `fetch-records` runs a raw-record style query by overriding aggregation fields
3. `summarize` asks the supervisor for a short summary

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
MongoDB Agent resolves schema and runs safe pipeline if needed
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

The MongoDB agent is instructed to use `build-aggregation` rather than writing raw pipelines. Pipeline construction happens in `src/mastra/tools/mongodb-tools.ts`.

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

It is a validation aid, not a production frontend.
