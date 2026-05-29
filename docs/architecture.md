# Architecture

The application has one platform metadata level: data stores and fields.

```text
public/index.html
  -> Express API
  -> Mastra workflow
  -> Supervisor plan
  -> MongoDB aggregation
  -> Writer or chart runtime
```

## Components

- `src/http`: request validation and API routing
- `src/services`: endpoint orchestration
- `src/db/datastore.repository.ts`: loads data store metadata
- `src/mastra/agents/supervisor.ts`: classifies prompts and creates task plans
- `src/mastra/agents/mongodb.ts`: exposes the MongoDB agent contract and tools
- `src/analytics/builders`: owns deterministic aggregation construction
- `src/mastra/agents/chart.ts`: owns the chart-agent role and delegates to ECharts tooling
- `src/mastra/runtime`: workflow runtime adapters
- `src/mastra/tools`: deterministic MongoDB, chart, merge, and search helpers

## MongoDB Runtime Scope

The MongoDB Agent contract is registered in Mastra, but the active
dashboard/report/inquiry query path uses deterministic runtime tools for
database safety. The runtime uses `buildAggregation`, `executePipeline`, and
`validateRows` to:

- resolves the target Data Store from platform metadata
- builds a tenant-safe MongoDB aggregation pipeline
- executes the aggregation
- validates and returns structured rows plus a compact field-type schema and JSON Schema
- returns the executed pipeline for audit

It is read-only by design. Create, update, and link operations are not exposed
through this analytics service.

## Prompt Modes

- `general_question`: inquiry/search, returns summary and record links
- `report`: report page, returns report sections and optional charts
- `dashboard`: dashboard page, returns a single chart

## Internal Search Agent Trigger

The Internal Search Agent is only invoked when the Supervisor plan sets
`needsEnrichment=true`.

Its goal is to search contextual data that already exists inside the platform's
internal knowledge corpus, such as exported DB collection summaries, field
metadata, schema context, and internal documentation.

Inputs are an enrichment task with `topic`, dataset dimensions, optional
`timeRange`, `language`, `locale`, and `tenantId`.

Outputs are a search dataset with internal hits and citation snippets. For
dashboard/report enrichment, rows can be merged with the MongoDB result when
they share the same dimension key.

Active tool: `vectorSearch`. If semantic embeddings are indexed, it uses
semantic search. Otherwise it uses local lexical search over `samples/db-export`.

## Chart Agent Selection

The Chart Agent is the primary visualization planner for non-empty dashboard
and report chart datasets. It receives the dataset schema, a tiny sample, row
count, the user prompt, valid chart candidates, and Supervisor hints such as
`chartHint` and suggested dimensions. It returns a structured chart plan
(`chartType`, axes, and optional grouping). The deterministic renderer then
validates that plan against real fields and builds the final ECharts option.

## Metadata Source

The app loads data stores from MongoDB collection `data_stores`.
MongoDB is required; local sample files are not used as a runtime fallback.
