# Development and Extension Guide

## Repository layout

```text
src/
  db/
    mongo.client.ts
    blueprint.repository.ts
  mastra/
    agents/
    schemas/
    tools/
    workflows/
    index.ts
    model.ts
  types/
    index.ts
  index.ts
  server.ts
public/
scripts/
samples/
docs/
```

## Extension points

### Add a new blueprint

If you want local-only development data:

1. update `samples/blueprints.json`
2. update `scripts/seed.ts`
3. reseed with `npm run seed`

If your environment stores blueprints in MongoDB:

1. insert the blueprint into `_blueprints`
2. make sure its `id` is included in the caller's `allowedBlueprintIds`

### Add a new workflow

Create a workflow in `src/mastra/workflows/` and register it in `src/mastra/index.ts`.

Typical steps:

1. define `inputSchema` and `outputSchema`
2. add one or more `createStep` stages
3. call the relevant agents inside each step
4. commit the workflow
5. expose it from the server if you want HTTP access

### Add a new agent

Create a file in `src/mastra/agents/`, then register it in `src/mastra/index.ts`.

Guidelines:

- keep the agent focused on one concern
- use tools for deterministic or side-effecting behavior
- keep orchestration in workflows rather than agent-to-agent tool calls

### Add a new tool

Create it under `src/mastra/tools/` using `createTool`.

Use tools when you need:

- deterministic translation logic
- database access
- external HTTP access
- validation or normalization
- merge logic

Prefer tools over agent free-form generation for anything safety-critical.

### Add a new chart type

Update:

- `src/mastra/schemas/chart.ts`
- `src/mastra/tools/chart-tools.ts`

You will usually need:

- a new `chartTypeSchema` entry
- a builder function that produces the ECharts option
- a decision branch in `buildEChartsTool`

### Add a new search provider

Implement `SearchProvider` in `src/mastra/tools/search-tools.ts`.

A provider needs:

- `search(query, opts)`
- `fetch(url)`

Then update `getProvider()` to select it from environment configuration.

Important:

The current repo already includes both Tavily and Brave provider implementations.

### Add vector search

The current repo already performs semantic retrieval by embedding exported knowledge chunks with OpenRouter and storing them in MongoDB.

If you outgrow this Mongo-backed semantic store, wire `vectorSearchTool` in `src/mastra/tools/search-tools.ts` to a dedicated vector database.

Suggested targets:

- Pinecone
- Qdrant
- pgvector
- Chroma
- a Mastra-supported store

You should keep tenant scoping in the vector layer too, because the tool already expects `tenantId`.

## Implementation conventions already in the repo

### Planning stays separate from execution

The supervisor produces `TaskPlan`. Workflows decide what to execute next.

### Schema-driven validation

The system uses Zod schemas for:

- workflow inputs and outputs
- tool inputs and outputs
- structured agent outputs

### MongoDB safety

The LLM is not supposed to invent raw pipelines. Use `buildAggregationTool`.

### Chart determinism

The chart tool chooses chart structure; the chart agent should not manually assemble ECharts options.

## Integration guidance

### Using the library entrypoint

`src/index.ts` exports:

- `mastra`
- all shared types

That allows you to embed the workflows in another Node service or framework.

### NestJS-style integration

You can register the exported `mastra` instance as a provider and call workflows the same way the Express server does.

### Frontend integration

For dashboard use cases, the most useful field is:

- `chart.option`

It is intended to be passed directly to ECharts.

For inquiry and report flows, the frontend should render:

- prose output
- record links or section blocks
- optional chart output if present

## Suggested next engineering steps

If you want to mature the system beyond the demo stage, the highest-value improvements are:

1. add automated tests for workflow outputs and tool guarantees
2. move `scope` derivation into auth middleware
3. strengthen retrieval with a dedicated vector backend if the Mongo-backed semantic corpus becomes too limiting
4. add structured logging and request correlation IDs
5. define timeout and retry policies for model and search calls
6. extract report writing into a dedicated writer agent or deterministic formatter

## What is currently not wired exactly as the design suggests

- `mergeResultsTool` exists, but the dashboard workflow currently merges enrichment inline in the workflow step
- `scatter` is declared in chart schema, but not emitted by the current chart builder
- the search stack is usable, but the internal knowledge index still computes similarity in application code rather than using a native vector database

Those are good places to focus if you are continuing system development.
