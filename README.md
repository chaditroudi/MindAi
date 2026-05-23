# Mind Viz Agents

Mind Viz Agents is a Node.js and TypeScript analytics service for Mind Platform.

The platform model is intentionally simple:

```text
Platform
  -> dataStores[]
    -> name
    -> collection
    -> description
    -> fields[]
      -> name
      -> description
      -> type
```

The app turns client prompts into one of three outputs:

- `POST /api/inquiry`: summary plus record links
- `POST /api/report`: report sections with optional charts
- `POST /api/dashboard`: one chart

## Runtime Flow

```text
Client prompt
  -> Express API
  -> Supervisor Agent plans intent/data store/fields
  -> MongoDB Agent builds and executes aggregation
  -> Writer or Chart Agent/runtime formats the response
  -> JSON response
```

Prompt suggestions in the UI are generated from the current data stores and fields through `/api/meta`; they are not static examples.

## Quick Start

Prerequisites:

- Node.js 20.9+
- Docker Desktop for local MongoDB, or MongoDB on `127.0.0.1:27017`
- Ollama or an Ollama-compatible OpenAI-style endpoint

```powershell
copy .env.example .env
npm install
npm run db:up
npm run seed
npm run dev
```

Open `http://localhost:3000`.

Default model settings:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`
- `OLLAMA_MODEL=gpt-oss:20b`

## Data

Datastore metadata lives in:

- MongoDB collection: `data_stores`

Seeded record collections:

- `service_requests`
- `inspections`
- `permits`
- `projects`

## Documentation

- [Architecture](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [Data Model](docs/data-model.md)
- [Setup and Operations](docs/setup-and-operations.md)
- [Development Guide](docs/development-and-extension.md)
- [Troubleshooting](docs/troubleshooting.md)
