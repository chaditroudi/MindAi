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
- `src/mastra/agents/mongodb.ts`: owns aggregation construction and execution
- `src/mastra/agents/chart.ts`: owns the chart-agent role and delegates to ECharts tooling
- `src/mastra/runtime`: workflow runtime adapters
- `src/mastra/tools`: deterministic MongoDB, chart, merge, and search helpers

## MongoDB Agent Scope

The MongoDB Agent implements the analytics/data-query responsibility:

- resolves the target data store from platform metadata
- builds a tenant-safe MongoDB aggregation pipeline
- executes the aggregation
- validates and returns structured rows plus a compact schema

It is read-only by design. Create, update, and link operations are not exposed
through this analytics service.

## Prompt Modes

- `general_question`: inquiry/search, returns summary and record links
- `report`: report page, returns report sections and optional charts
- `dashboard`: dashboard page, returns a single chart

## Metadata Source

The app loads data stores from MongoDB collection `data_stores`.
MongoDB is required; local sample files are not used as a runtime fallback.
