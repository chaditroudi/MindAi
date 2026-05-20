# Troubleshooting and Known Limitations

## Common setup issues

### `MONGODB_URI is not set`

Cause:

- `.env` is missing
- the server started without the expected environment

Fix:

1. copy `.env.example` to `.env`
2. set `MONGODB_URI`
3. restart the server

### `MONGODB_DB is not set`

Cause:

- `.env` does not include `MONGODB_DB`

Fix:

- set `MONGODB_DB=mind_platform` for local development unless you intentionally use another database name

### The API starts but queries return no data

Possible causes:

- MongoDB is not running
- the database was not seeded
- the prompt resolved to a blueprint or fields that do not match the seeded data
- the tenant ID in `scope` does not match the seeded tenant

Checks:

1. run `npm run db:up`
2. run `npm run seed`
3. use `tenantId: "t_mind_qatar"` in local requests
4. inspect the audit block from the API response

### The demo page loads but the request fails

Possible causes:

- no model API key is configured
- MongoDB is unavailable
- the workflow raised an internal error

Checks:

1. confirm `OPENROUTER_API_KEY` is set
2. confirm `OPENROUTER_MODEL` is set if you intentionally changed the default model
3. confirm `GET /health` works
4. inspect the browser network response or run `npm run smoke`

## Search and enrichment caveats

### Search enrichment does not run

Cause:

- `SEARCH_PROVIDER` is unset
- or the selected provider key is missing

Effect:

- the Search Agent cannot call the public web provider

Fix:

- set `SEARCH_PROVIDER=tavily` or `SEARCH_PROVIDER=brave`
- set the matching API key in `.env`

### Tavily is configured but enrichment still feels incomplete

Cause:
- the query may be better served by internal knowledge retrieval than public web search
- the target page may still return low-signal content after extraction

Effect:

- enrichment may be thin even though the provider is working

### Internal knowledge retrieval returns nothing

Cause:

- the local export knowledge corpus is missing or the query does not match the exported schema/context

Fix:

- verify `samples/db-export` exists or provide your own export corpus
- run `npm run knowledge:index` to build or refresh the Mongo-backed semantic index
- later, replace the Mongo-backed index with a dedicated embedding/vector store if needed

## Documentation-worthy implementation gaps

These are not bugs in the docs. They are real characteristics of the current codebase.

### No automated tests in `tests/`

There is a `tests/` directory, but it is currently empty. Validation today is mainly through:

- typechecking
- smoke tests
- manual use of the demo UI

### Report writing is handled by the supervisor

The report workflow reuses the supervisor agent to write structured report sections. That works, but it couples planning and writing concerns.

### Merge logic is duplicated

There is a dedicated `mergeResultsTool`, but the dashboard workflow currently performs enrichment merging inline instead of calling that tool.

### Chart schema is ahead of chart implementation

The chart schema declares `scatter`, but the current chart builder does not generate scatter charts.

### Request-body scope is for demo use only

The server accepts `scope` from the request body. That should not remain true in a production deployment.

## Operational limitations

### No request streaming

The current endpoints return a final JSON response only. There is no streaming progress or partial result delivery.

### Minimal observability

The service logs startup messages, but it does not yet include:

- structured request logs
- tracing
- metrics
- correlation IDs

### No explicit timeout or retry policy

The code does not define a comprehensive strategy for:

- model call timeouts
- search provider retries
- MongoDB query timeouts

### Demo-oriented frontend

`public/index.html` is a helpful manual validation tool, but it is not a production UI shell and does not include authentication or hardened error handling.

## Recommended verification workflow

When something looks wrong, this is the fastest local checklist:

1. run `npm run typecheck`
2. ensure MongoDB is up with `npm run db:up`
3. reseed with `npm run seed`
4. start the server with `npm run dev`
5. run `npm run smoke`
6. inspect the response audit block for the generated plan and pipeline
