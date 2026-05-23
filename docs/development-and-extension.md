# Development Guide

## Add a Data Store

1. Add metadata to MongoDB collection `data_stores`.
2. Add or seed records in the MongoDB collection named by the data store's `collection`.
3. Include the data store name in `scope.allowedDataStores` if you use an allow-list.

## Important Files

- `src/db/datastore.repository.ts`: data store metadata loading
- `src/mastra/schemas/datastore.ts`: data store and permission schemas
- `src/mastra/task-plan.ts`: plan normalization against fields
- `src/mastra/tools/mongodb-tools.ts`: aggregation building and execution
- `src/mastra/tools/chart-tools.ts`: deterministic chart generation

## Prompt Suggestions

`GET /api/meta` generates suggestions from the available data stores and fields. The UI does not keep static prompt examples.
