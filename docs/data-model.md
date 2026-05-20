# Data Model and Schemas

## Core domain concepts

The service models data around blueprints and data stores.

### Blueprint

A Blueprint represents a user-defined domain model that the platform is allowed to query for a given tenant and permission scope.

Defined in:

- `src/types/index.ts`
- `src/mastra/schemas/blueprint.ts`

Shape:

- `id`
- `name`
- `description`
- `dataStores[]`

### Data store

A Data Store maps to one MongoDB collection.

Shape:

- `name`
- `collection`
- `description`
- `fields[]`

### Blueprint field

Each field declares its type and optional semantic role.

Available field types:

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

Optional field roles:

- `dimension`
- `measure`
- `temporal`
- `id`

These roles help the system infer sensible plans and charts.

## Permission scope

Every request carries a permission scope.

Shape:

```json
{
  "userId": "u_demo",
  "tenantId": "t_mind_qatar",
  "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"],
  "rowFilter": {
    "municipality": "Doha"
  }
}
```

Meaning:

- `userId`: caller identity
- `tenantId`: tenant boundary enforced in MongoDB matching
- `allowedBlueprintIds`: blueprint access allow-list
- `rowFilter`: optional row-level constraint merged into every query

Important:

Tenant enforcement is re-applied in the MongoDB execution tool even if an upstream stage omits it.

## Request context

The TypeScript model defines a broader `RequestContext` concept with:

- `prompt`
- `intent`
- `topic`
- `blueprintId`
- `dataStoreName`
- `scope`
- `locale`
- `theme`

The Express API only exposes a subset directly, but the richer structure is useful for future integrations.

## TaskPlan

`TaskPlan` is the key intermediate representation between planning and execution.

Defined in:

- `src/types/index.ts`
- `src/mastra/schemas/intent.ts`

High-level fields:

- `intent`
- `needsData`
- `needsEnrichment`
- `needsChart`
- `query`
- `enrichment`
- `chartHint`

### Query block

The `query` object may contain:

- `blueprintId`
- `dataStoreName`
- `metric`
- `aggregation`
- `dimensions`
- `timeRange`
- `filters`
- `sort`
- `limit`

Supported aggregations:

- `sum`
- `avg`
- `count`
- `min`
- `max`

Supported filter operators:

- `eq`
- `ne`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`

Supported chart hints:

- `compare`
- `trend`
- `distribution`
- `part_of_whole`
- `geo`

## Dataset

The normalized dataset shared between workflow steps has this shape:

- `rows`
- `schema`
- `source`
- optional `citations`

### `rows`

Rows are normalized to scalar-friendly values only:

- string
- number
- boolean
- null

Dates are converted to ISO strings by the row validation tool.

### `schema`

`schema` is a field-to-type map generated after query execution.

Example:

```json
{
  "region": "enum",
  "value": "number"
}
```

### `source`

Possible values:

- `mongodb`
- `search`
- `merged`

### `citations`

Citations are used mainly for search enrichment data and can contain:

- `title`
- `url`
- `snippet`

## Chart result

The chart output format is defined in `src/mastra/schemas/chart.ts`.

Fields:

- `chartType`
- `option`
- `title`
- optional `annotations`
- `accessibility.description`

Declared chart types:

- `line`
- `bar`
- `horizontalBar`
- `scatter`
- `donut`
- `map`
- `histogram`
- `table`

Implementation note:

The deterministic chart builder can emit scatter charts when a dataset has two independent numeric fields and no stronger temporal or categorical hint is selected.

## Local demo model

The local sample data is defined by `samples/blueprints.json` and populated by `scripts/seed.ts`.

Important note:

The seeded data exists to make the repository runnable out of the box. It is demo data only. The product itself is generic and intended to work with tenant-defined Blueprints, Topics, and Data Stores.

What the local sample model demonstrates:

- how Blueprints are loaded
- how Data Stores map to MongoDB collections
- how fields and roles drive planning
- how the workflows behave with real documents in MongoDB

What it does not mean:

- the product is limited to a specific vertical
- the charting logic is specific to any one built-in business domain
- production tenants must use the same schema

## Seed script behavior

The seed script inserts:

- demo blueprints
- demo collections
- demo records
- tenant-scoped indexes

It also creates tenant-first indexes on the seeded collections to match the expected query pattern.
