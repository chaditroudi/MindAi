# API Reference

## Base behavior

All three business endpoints accept JSON and return JSON.

Common request body:

```json
{
  "prompt": "service request count by municipality this month",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  },
  "topic": "municipal operations",
  "blueprintId": "bp_municipal_operations"
}
```

Notes:

- `prompt` is required
- `scope` is required in this demo implementation
- `topic` is optional
- `blueprintId` is optional on `/api/report` and `/api/dashboard`

Production note:

The current server accepts `scope` from the request body for demo purposes. In production, it should be derived from authenticated user context and never trusted from client input.

## `GET /health`

Returns a simple liveness response.

Example response:

```json
{
  "ok": true
}
```

## `POST /api/inquiry`

Used for short, search-style questions.

Typical behavior:

- plans a general-question task
- fetches matching records
- summarizes the first matching results

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

Example response shape:

```json
{
  "intent": "general_question",
  "summary": "Matching records were found for the requested criteria and summarized for quick review.",
  "recordLinks": [
    {
      "collection": "records",
      "id": "rec_1",
      "label": "Record 1"
    }
  ],
  "audit": {
    "plan": {},
    "elapsedMs": 612
  }
}
```

## `POST /api/report`

Used for analytical prompts that should return narrative sections and optionally charts.

Typical behavior:

- creates a report-focused `TaskPlan`
- gathers primary data and optional enrichment
- writes structured report sections
- adds a chart only if the plan requires one and data exists

Example request:

```json
{
  "prompt": "analyze service request volume by municipality over the last 90 days and surface key changes",
  "blueprintId": "bp_municipal_operations",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedBlueprintIds": ["bp_municipal_operations", "bp_urban_planning"]
  }
}
```

Example response shape:

```json
{
  "intent": "report",
  "reportSections": [
    {
      "heading": "Overview",
      "body": "The selected blueprint data shows ..."
    }
  ],
  "charts": [
    {
      "chartType": "bar",
      "option": {},
      "title": "Service requests by municipality",
      "accessibility": {
        "description": "Bar chart comparing values across categories."
      }
    }
  ],
  "audit": {
    "plan": {},
    "elapsedMs": 1331
  }
}
```

Important note:

The report endpoint does not currently return the executed MongoDB pipeline in its audit block, even though the dashboard endpoint does.

## `POST /api/dashboard`

Used for widget-style prompts that should return exactly one chart.

Typical behavior:

- creates a dashboard `TaskPlan`
- queries MongoDB
- optionally enriches with external context
- generates a single chart result

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

Example response shape:

```json
{
  "intent": "dashboard",
  "chart": {
    "chartType": "bar",
    "option": {},
    "title": "service request count by municipality this month",
    "accessibility": {
      "description": "Bar chart comparing values across categories."
    }
  },
  "audit": {
    "plan": {},
    "pipeline": [
      {
        "$match": {
          "tenantId": "t_mind_qatar"
        }
      }
    ],
    "elapsedMs": 948
  }
}
```

## Error behavior

### Validation errors

If `prompt` or `scope` is missing, the server returns HTTP `400`.

Examples:

```json
{
  "error": "prompt is required"
}
```

```json
{
  "error": "scope is required"
}
```

### Workflow failures

If a workflow finishes without success, the server returns HTTP `500`.

Shape:

```json
{
  "error": "workflow failed",
  "detail": {}
}
```

### Unexpected runtime failures

Unhandled failures are returned as HTTP `500` with a simple message.

Shape:

```json
{
  "error": "unknown error"
}
```

Depending on the thrown error, a more specific message may be returned.

## Response semantics by endpoint

| Endpoint | Intent | Primary output | Audit fields |
| --- | --- | --- | --- |
| `/api/inquiry` | `general_question` | `summary`, `recordLinks` | `plan`, `elapsedMs` |
| `/api/report` | `report` | `reportSections`, optional `charts` | `plan`, `elapsedMs` |
| `/api/dashboard` | `dashboard` | `chart` | `plan`, `pipeline`, `elapsedMs` |

## Sample request file

The repository includes [requests.http](../requests.http) for use with the VS Code REST Client extension.

It contains ready-to-run examples for:

- health checks
- inquiry
- report generation
- dashboard charts
