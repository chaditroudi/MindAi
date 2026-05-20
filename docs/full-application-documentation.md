# Mind Viz Agents: Full Application Documentation

## Table of contents

1. Overview
2. What the app does
3. Current system review
4. Tech stack
5. How to start the app
6. Environment variables
7. Available scripts
8. Application structure
9. End-to-end request flow
10. Agents
11. Workflows
12. Tools
13. Data model
14. API reference
15. Demo UI
16. Sample data and local database
17. How chart generation works
18. Security model and safeguards
19. Development guide
20. Known limitations
21. Recommended improvements
22. File-by-file explanation
23. Troubleshooting
24. Final summary

## 1. Overview

Mind Viz Agents is a TypeScript application for **Mind Platform**, a configurable enterprise platform for data management, workflow automation, reporting, and analytics.

The platform lets users define their own data models as `Blueprints`, organize captured data into `Data Stores` under `Topics`, manage workflows and permissions, and ask for charts or analysis in natural language instead of manually building aggregation pipelines.

In this repository, the runnable demo is positioned as a **data-visualization system for municipalities in Qatar**.

It supports three main use cases:

- quick inquiry answers
- report generation
- dashboard chart generation

The system uses:

- an Express server for the HTTP API
- Mastra for orchestration
- multiple specialized agents for planning and execution
- MongoDB for application data
- ECharts-compatible output for charts

The app is built as both:

- a runnable service through `src/server.ts`
- a reusable library through `src/index.ts`

## 2. What the app does

The app receives a prompt like:

- "show service request count by municipality this month"
- "analyze municipal service request trends over the last 90 days"
- "show open permits by municipality"

It then:

1. figures out the user intent
2. chooses the right blueprint and data store
3. builds a structured task plan
4. queries MongoDB safely
5. optionally enriches results with external context
6. returns either:
   - a summary and links
   - a report
   - a chart configuration

## 3. Current system review

This section is a practical review of the app in its current state.

### Overall assessment

The application has a strong architecture for a blueprint-aware, agent-assisted analytics system on top of Mind Platform:

- responsibilities are clearly separated
- workflows are deterministic
- MongoDB querying is guarded by code instead of prompt text alone
- chart building is heuristic and tool-driven rather than free-form
- the codebase is readable and easy to extend

### What is good

- The `Supervisor Agent` is used primarily as a planner instead of doing everything.
- The MongoDB query path uses tools to build and execute pipelines, which is much safer than letting an LLM generate raw database commands.
- Tenant isolation is enforced in the tool layer.
- Workflows are clear and reflect business intent well.
- The demo UI is helpful for manual validation.
- The code is small enough to understand quickly.

### What is incomplete

- Search enrichment requires a real configured provider.
- Internal knowledge retrieval uses OpenRouter embeddings plus a Mongo-backed semantic index built from the exported knowledge corpus.
- There are no automated tests in `tests/`.
- Report writing currently reuses the supervisor instead of using a dedicated writer layer.
- Some declared chart capabilities are ahead of implementation, such as `scatter`.

### Overall maturity

This repo is best understood as:

- a solid prototype
- a local demo
- a good foundation for production hardening

It is not yet a fully production-complete analytics platform.

## 4. Tech stack

### Runtime

- Node.js 20.9+
- TypeScript
- Express

### Orchestration and AI

- Mastra
- OpenAI-compatible SDK for OpenRouter
- Zod

### Data

- MongoDB

### Frontend demo

- plain HTML
- ECharts loaded from CDN

## 5. How to start the app

## Prerequisites

- Node.js 20.9 or newer
- npm
- MongoDB locally or Docker Desktop
- an OpenRouter API key

## Quick start

```powershell
copy .env.example .env
npm install
npm run db:up
npm run seed
npm run dev
```

Open:

- `http://localhost:3000`

## Windows helper setup

PowerShell:

```powershell
.\setup.ps1
```

CMD:

```cmd
setup.cmd
```

These scripts:

- check prerequisites
- create `.env`
- install dependencies
- optionally start Docker MongoDB
- optionally seed sample data

## If you already have MongoDB installed

You can skip Docker and just set:

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=mind_platform
```

Then run:

```powershell
npm run seed
npm run dev
```

## 6. Environment variables

The environment template is in `.env.example`.

### Model configuration

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Default values:

```env
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
```

OpenRouter default example:

```env
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_API_KEY=your_key_here
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=Mind Viz Agents
```

### MongoDB

- `MONGODB_URI`
- `MONGODB_DB`

Defaults:

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=mind_platform
```

### Search

- `SEARCH_PROVIDER`
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`

Important note:

`BRAVE_API_KEY` is present in the env template, but the current code does not implement a Brave provider.

### Server and local tooling

- `PORT`
- `NODE_ENV`
- `SMOKE_BASE_URL`
- `MASTRA_TELEMETRY_DISABLED`

## 7. Available scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the server in watch mode |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm start` | Run the compiled server |
| `npm run mastra:dev` | Start Mastra's dev tooling |
| `npm run typecheck` | Run TypeScript validation |
| `npm run seed` | Seed sample data into MongoDB |
| `npm run smoke` | Run smoke tests against a running server |
| `npm run db:up` | Start MongoDB and Mongo Express with Docker |
| `npm run db:down` | Stop Docker services |
| `npm run db:wait` | Small wait helper |
| `npm run db:reset` | Reset local DB and reseed |

## 8. Application structure

```text
mind-viz-agents/
├── public/
├── samples/
├── scripts/
├── src/
│   ├── db/
│   ├── mastra/
│   │   ├── agents/
│   │   ├── schemas/
│   │   ├── tools/
│   │   └── workflows/
│   ├── types/
│   ├── index.ts
│   └── server.ts
├── tests/
├── .env.example
├── docker-compose.yml
├── package.json
├── requests.http
├── setup.cmd
├── setup.ps1
└── README.md
```

## 9. End-to-end request flow

```text
Client prompt
  ->
Express endpoint
  ->
Selected Mastra workflow
  ->
Supervisor builds TaskPlan
  ->
MongoDB Agent fetches data if needed
  ->
Search Agent enriches if needed
  ->
Chart Agent creates chart if needed
  ->
Workflow returns structured output
  ->
Express returns JSON response
```

The three main user flows are:

- inquiry
- report
- dashboard

The important product framing is that these flows are generic. They operate on whichever Blueprint and Data Store definitions the tenant has configured, not on one hardcoded business domain.

## 10. Agents

## Supervisor Agent

File:

- `src/mastra/agents/supervisor.ts`

Purpose:

- classify user intent
- inspect available blueprints
- create the `TaskPlan`

What it should not do:

- execute MongoDB queries directly
- generate charts directly
- bypass workflow sequencing

Why this is good:

- better determinism
- clearer auditing
- easier maintenance

## MongoDB Agent

File:

- `src/mastra/agents/mongodb.ts`

Purpose:

- validate fields against schema
- build a safe pipeline
- execute the pipeline
- normalize results

Key safety behavior:

- uses `build-aggregation`
- uses `execute-pipeline`
- uses `validate-rows`
- is expected not to invent fields

## Search Agent

File:

- `src/mastra/agents/search.ts`

Purpose:

- fetch external or internal enrichment context

Available tool paths:

- `vector-search`
- `web-search`
- `web-fetch`

Current reality:

- public web enrichment requires an explicitly configured provider
- Tavily and Brave are wired for external enrichment
- internal knowledge retrieval uses OpenRouter embeddings and a Mongo-backed semantic index over the exported knowledge corpus

## Chart Agent

File:

- `src/mastra/agents/chart.ts`

Purpose:

- turn normalized data into ECharts output

Behavior:

- receives dataset plus hint
- calls `build-echarts`
- returns a `ChartResult`

## 11. Workflows

## Dashboard workflow

File:

- `src/mastra/workflows/dashboard.ts`

Steps:

1. `plan`
2. `query`
3. `enrich`
4. `chart`

Output:

- a single chart
- audit plan
- executed pipeline

Best for:

- dashboard cards
- chart widgets
- fast visual answers

## Report workflow

File:

- `src/mastra/workflows/report.ts`

Steps:

1. `plan-report`
2. `gather`
3. `write-report`

Output:

- `reportSections`
- optional `charts`
- `plan`

Current design note:

The supervisor is reused to write the report content. That works, but separating planning from writing would likely improve maintainability later.

## General-question workflow

File:

- `src/mastra/workflows/general-question.ts`

Steps:

1. `plan-q`
2. `fetch-records`
3. `summarize`

Output:

- `summary`
- `recordLinks`
- `plan`

This path is intentionally simpler and does not involve chart generation.

## 12. Tools

## MongoDB tools

File:

- `src/mastra/tools/mongodb-tools.ts`

### `resolve-blueprint`

Used to:

- look up blueprints
- enforce `allowedBlueprintIds`

### `build-aggregation`

Used to:

- translate `TaskPlan` into a MongoDB aggregation pipeline

Important behavior:

- adds tenant match first
- applies row filter
- applies user filters
- applies time range
- applies group/project/sort/limit

### `execute-pipeline`

Used to:

- run the pipeline against MongoDB

Important safety:

- defensively ensures tenant match exists

### `validate-rows`

Used to:

- normalize values
- produce field type schema

## Search tools

File:

- `src/mastra/tools/search-tools.ts`

### `web-search`

Searches public sources.

### `web-fetch`

Fetches full content for a URL.

### `vector-search`

Internal semantic retrieval over the exported knowledge corpus.

Current limitation:

- it currently uses a Mongo-backed embedding index with similarity computed in application code rather than a dedicated vector database

## Merge tool

File:

- `src/mastra/tools/merge-tools.ts`

Purpose:

- merge primary and secondary datasets on a shared key

Current design note:

The dashboard workflow currently performs merge logic inline instead of using this tool.

## Chart tool

File:

- `src/mastra/tools/chart-tools.ts`

Purpose:

- choose chart type heuristically
- return complete ECharts options

Current supported outputs in practice:

- `line`
- `bar`
- `horizontalBar`
- `donut`
- `map`
- `histogram`
- `table`

Schema note:

`scatter` exists in the chart schema but is not currently emitted by the chart tool logic.

## 13. Data model

## Blueprint

A Blueprint represents a user-defined domain model the platform can query.

Fields:

- `id`
- `name`
- `description`
- `dataStores`

## Data store

A Data Store maps to a MongoDB collection and belongs to a Blueprint-defined structure.

Fields:

- `name`
- `collection`
- `description`
- `fields`

## Field types

Supported field types:

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

## Permission scope

Each request includes:

- `userId`
- `tenantId`
- `allowedBlueprintIds`
- optional `rowFilter`

This is critical because tenant isolation depends on it.

## TaskPlan

The `TaskPlan` is the intermediate representation between planning and execution.

Main fields:

- `intent`
- `needsData`
- `needsEnrichment`
- `needsChart`
- `query`
- `enrichment`
- `chartHint`

## Dataset

The normalized dataset includes:

- `rows`
- `schema`
- `source`
- optional `citations`

## ChartResult

The chart result includes:

- `chartType`
- `option`
- `title`
- optional `annotations`
- `accessibility.description`

## 14. API reference

## `GET /health`

Response:

```json
{
  "ok": true
}
```

## `POST /api/inquiry`

Use for quick questions.

Example request:

```json
{
  "prompt": "find recent service requests where status is new",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response shape:

- `intent`
- `summary`
- `recordLinks`
- `audit`

## `POST /api/report`

Use for analysis and report generation.

Example request:

```json
{
  "prompt": "analyze service request volume by municipality over the last 90 days",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response shape:

- `intent`
- `reportSections`
- optional `charts`
- `audit`

## `POST /api/dashboard`

Use for a single chart.

Example request:

```json
{
  "prompt": "service request count by municipality this month",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Response shape:

- `intent`
- `chart`
- `audit`

## Important production note

In the current demo implementation, `scope` is accepted from the request body.

In a real production application:

- `scope` should come from authentication and authorization middleware
- the client should not be trusted to provide it

## 15. Demo UI

File:

- `public/index.html`

Purpose:

- manual validation
- quick demo interface
- chart rendering

Features:

- switch between inquiry, report, and dashboard
- type prompts or use examples
- render charts with ECharts
- keep dashboard mode chart-only while report and inquiry show narrative content
- inspect audit data

This page is useful for testing, but it is not a production UI.

## 16. Sample data and local database

Files:

- `samples/blueprints.json`
- `scripts/seed.ts`

Important note:

The local repository includes seeded demo data so the app can be run immediately. In this version, that demo data is oriented around municipalities in Qatar, but the underlying product is still configurable and tenant-defined through Blueprints, Topics, and Data Stores.

What the seed data is for:

- local development
- smoke testing
- demo validation

What the seed data is not:

- the actual product domain model
- a limit on what the platform can visualize
- a requirement for production deployments

Implementation detail:

The seed script inserts demo blueprints, demo collections, and a demo tenant so the local environment has something queryable without extra setup.

Seeded sample tenant:

- `t_mind_qatar`

Indexes are also created to match common tenant-first query patterns.

## 17. How chart generation works

The chart system is deterministic and heuristic-based.

General rules:

- temporal data becomes `line`
- many categories become `horizontalBar`
- basic categorical comparison becomes `bar`
- part-of-whole with few slices becomes `donut`
- geographic data becomes `map`
- distribution hint becomes `histogram`
- no data becomes `table`

This is a strong design choice because it reduces hallucinated chart configuration.

## 18. Security model and safeguards

## Tenant guard

The most important safety boundary is tenant isolation.

Implemented in:

- `buildAggregationTool`
- `executePipelineTool`

This means:

- the pipeline starts with tenant filtering
- the execution path re-checks tenant filtering

## Blueprint scope

The blueprint resolver uses `allowedBlueprintIds` to avoid cross-scope access.

## Deterministic query construction

The MongoDB agent is expected to use tools, not raw free-form pipelines.

## Remaining security concern

The current server accepts `scope` from the request body. That should be replaced before production use.

## 19. Development guide

## Build

```powershell
npm run build
```

## Typecheck

```powershell
npm run typecheck
```

## Run smoke tests

Start the server first, then run:

```powershell
npm run smoke
```

## Helpful manual validation

- open the demo UI
- use `requests.http`
- inspect returned audit blocks

## Extending the app

You can extend the app by:

- adding new blueprints
- adding new workflows
- adding new tools
- adding a real search provider
- wiring vector retrieval
- improving chart heuristics

## 20. Known limitations

- Search requires an explicit provider configuration for public web enrichment.
- Tavily support is partial.
- Vector search is not implemented.
- No automated tests are currently present in `tests/`.
- The report workflow mixes planning and writing concerns.
- Merge behavior is duplicated because the dashboard workflow does not call the dedicated merge tool.
- `scatter` is declared but not produced.
- There is no streaming response support.
- Observability is minimal.
- Timeout and retry policies are not fully defined.

## 21. Recommended improvements

If this app is being prepared for production, the highest-value next steps are:

1. move `scope` derivation into auth middleware
2. add automated tests for workflows and tool guarantees
3. implement a real search provider fully
4. move the Mongo-backed semantic index to a dedicated vector database if scale or native ANN search becomes necessary
5. add structured logging and tracing
6. add timeouts and retry strategy
7. separate report writing from supervisor planning
8. align chart schema and chart builder behavior

## 22. File-by-file explanation

## Root files

### `package.json`

Defines:

- metadata
- scripts
- dependencies

### `docker-compose.yml`

Starts local MongoDB and Mongo Express.

### `.env.example`

Documents local environment configuration.

### `requests.http`

Contains ready-made sample API calls.

### `setup.ps1` and `setup.cmd`

Provide Windows-friendly setup automation.

## Source files

### `src/server.ts`

Main HTTP entrypoint.

Responsibilities:

- configure Express
- register routes
- call workflows
- return structured JSON

### `src/index.ts`

Library entrypoint.

Exports:

- `mastra`
- shared types

### `src/db/mongo.client.ts`

MongoDB connection manager.

### `src/db/blueprint.repository.ts`

Loads blueprints from:

1. MongoDB `_blueprints`
2. local sample fallback

### `src/mastra/model.ts`

Chooses the OpenRouter Llama model from environment variables.

### `src/mastra/index.ts`

Registers agents and workflows into the Mastra instance.

### `src/mastra/agents/*`

Contains the agent definitions.

### `src/mastra/workflows/*`

Contains intent-specific orchestration logic.

### `src/mastra/tools/*`

Contains deterministic tools for data, search, merge, and charts.

### `src/mastra/schemas/*`

Contains Zod schemas for runtime contracts.

### `src/types/index.ts`

Contains shared domain types.

## 23. Troubleshooting

## Problem: app starts but queries fail

Check:

- API key is set
- MongoDB is running
- sample data is seeded
- `tenantId` is `t_mind_qatar` for local testing

## Problem: no data returns

Check:

- `npm run seed`
- the prompt matches fields available in the local demo blueprints or your own loaded blueprints
- the chosen blueprint is accessible

## Problem: enrichment looks fake

Cause:

- `SEARCH_PROVIDER` is unset or the provider API key is missing

## Problem: internal knowledge retrieval is empty

Cause:

- the exported knowledge corpus is missing or too sparse for the query

## Problem: TypeScript validation fails after future changes

Run:

```powershell
npm run typecheck
```

Then inspect the affected workflow, agent, or schema contracts first, because most of the app depends on those structured types.

## 24. Final summary

Mind Viz Agents is a well-structured multi-agent data-visualization service for Mind Platform, demonstrated here as a municipal analytics system for municipalities in Qatar.

Its biggest strengths are:

- clean architecture
- deterministic workflow design
- tenant-aware MongoDB safeguards
- easy local setup

Its biggest current gaps are:

- application-level vector similarity over Mongo-backed embeddings rather than a dedicated vector database
- lack of automated tests
- demo-style auth handling

Even with those gaps, it is a strong base for building a production analytics assistant once the missing operational and security pieces are finished.
