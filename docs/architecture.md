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

## MongoDB Agent Scope

The MongoDB Agent implements the analytics/data-query responsibility with the
tools `resolveBlueprint`, `buildAggregation`, `executePipeline`, and
`validateRows`:

- resolves the target blueprint/data store from platform metadata
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

## Search Agent Trigger

The Search Agent is only invoked when the Supervisor plan sets
`needsEnrichment=true`.

Its goal is to fetch external or contextual data that the user's Data Store does
not contain: industry benchmarks, geo metadata, currency rates, news, or
RAG-retrieved knowledge from the platform's internal corpus.

Inputs are an enrichment task with `topic`, dataset dimensions, optional
`timeRange`, `language`, `locale`, and an explicit source allow-list.

Outputs are a secondary dataset shaped to align with the MongoDB result using
the same dimension keys, plus citation metadata for chart/report attribution.

Tools: `webSearch`, `webFetch`, `vectorSearch`, and `geocode`. Legacy tool IDs
`web-search`, `web-fetch`, `vector-search`, and `webScrape` remain available.

## Chart Agent Selection

The Chart Agent selects visualization intent before deterministic rendering:
time series use `line`, categorical comparisons use `bar` or `horizontalBar`,
and distributions use `histogram`.

## Metadata Source

The app loads data stores from MongoDB collection `data_stores`.
MongoDB is required; local sample files are not used as a runtime fallback.
