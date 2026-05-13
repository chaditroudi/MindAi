# Setup and Operations

## Prerequisites

- Node.js 20.9 or newer
- npm
- MongoDB 7+ locally, or Docker Desktop for the included container setup
- An OpenRouter API key

## Environment variables

Copy `.env.example` to `.env`.

```powershell
copy .env.example .env
```

### Model provider

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

Defaults:

- provider: `openrouter`
- model: `meta-llama/llama-3.3-70b-instruct:free`

OpenRouter default:

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

Current supported provider modes in code:

- `stub`
- `tavily`

Important:

`BRAVE_API_KEY` exists in the example env file, but there is no Brave provider implementation in the current source.

### Server and local tooling

- `PORT`
- `NODE_ENV`
- `SMOKE_BASE_URL`
- `MASTRA_TELEMETRY_DISABLED`

## Local setup paths

### Option 1: Windows helper script

PowerShell:

```powershell
.\setup.ps1
```

CMD:

```cmd
setup.cmd
```

What the helper does:

- checks for Node.js
- creates `.env` if needed
- installs npm dependencies
- optionally starts Docker services
- optionally seeds sample data

### Option 2: Manual setup

```powershell
npm install
copy .env.example .env
npm run db:up
npm run seed
npm run dev
```

Then open:

- `http://localhost:3000`

## Docker stack

`docker-compose.yml` starts:

- `mongo` on port `27017`
- `mongo-express` on port `8081`

Useful scripts:

- `npm run db:up`
- `npm run db:down`
- `npm run db:reset`

`db:reset` will:

1. stop and remove the Docker volume
2. restart MongoDB
3. wait briefly
4. reseed sample data

## Application scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the Express server with `tsx watch` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run mastra:dev` | Start Mastra's dev environment |
| `npm run typecheck` | Run TypeScript checks without emit |
| `npm run seed` | Insert sample blueprints and sample data |
| `npm run smoke` | Exercise the three API endpoints against a running server |
| `npm run db:up` | Start Docker services |
| `npm run db:down` | Stop Docker services |
| `npm run db:wait` | Simple wait helper used by reset flow |
| `npm run db:reset` | Recreate local DB and reseed |

## Runbook for local development

### Start from scratch

```powershell
npm install
copy .env.example .env
npm run db:up
npm run seed
npm run dev
```

### Rebuild the DB state

```powershell
npm run db:reset
```

### Verify the service manually

Use any of the following:

- open `http://localhost:3000`
- call `GET /health`
- run `npm run smoke`
- use [requests.http](../requests.http)

## Deployment considerations

This repo is currently structured as an application service and library entrypoint.

### What is production-ready in shape

- clear API surface
- isolated workflow orchestration
- deterministic query and chart tool layers
- environment-based provider selection

### What still needs production hardening

- authenticated scope derivation instead of request-body scope
- real search provider wiring
- real vector search backend
- structured logging and tracing
- test coverage
- rate limiting and request timeout strategy
- deployment-specific secrets management

## Operational behavior

### MongoDB connection lifecycle

The service uses a singleton client from `src/db/mongo.client.ts`. The client is created lazily when a query path first needs it.

### Blueprint loading

Blueprints are read from MongoDB first and cached in memory. If that load fails or returns no documents, the repository falls back to `samples/blueprints.json`.

### Public demo page

The server exposes the contents of `public/` as static assets. The root URL serves the demo interface automatically.
