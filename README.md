# Mind Viz Agents

Mind Viz Agents is a Node.js and TypeScript service for **Mind Platform**, a configurable enterprise platform for data management, workflow automation, reporting, and analytics.

In this demo, the app is seeded as a **municipal data-visualization system for municipalities in Qatar**. It reflects the way Mind Platform lets organizations define their own `Blueprints`, store operational records in `Data Stores`, manage workflows, and generate dashboards and reports through natural-language requests instead of hand-written aggregation pipelines.

The service turns prompts into:

- summaries and record links for inquiry-style questions
- structured report sections for analysis requests
- render-ready ECharts configurations for dashboard widgets

The system is built on Mastra workflows and four specialized agents:

- `Supervisor Agent` plans the job
- `MongoDB Agent` turns the plan into a safe aggregation pipeline
- `Search Agent` enriches with external or internal context when needed
- `Chart Agent` converts normalized data into ECharts output

This repository also includes:

- an Express API server
- a static demo UI in `public/`
- sample blueprints and seeded MongoDB data
- Windows setup helpers
- smoke-test scripts for the three main endpoints

## Mind Platform context

Mind Platform is designed for organizations that need to:

- organize operational data in a structured way
- manage users, memberships, groups, org units, and permissions
- configure workflows and approval processes
- create dashboards and reports for decision-making
- automate reminders, triggers, and notifications
- expose selected data securely to external consumers or integrations

In simple terms, this project is not just a website. It is closer to a low-code internal operations and analytics platform.

## Documentation map

- [Full application documentation](docs/full-application-documentation.md)
- [System architecture](docs/architecture.md)
- [API reference](docs/api-reference.md)
- [Data model and schemas](docs/data-model.md)
- [Setup and operations](docs/setup-and-operations.md)
- [Development and extension guide](docs/development-and-extension.md)
- [Troubleshooting and known limitations](docs/troubleshooting.md)

## Quick start

Prerequisites:

- Node.js 20.9+
- MongoDB, or Docker Desktop for the bundled local MongoDB stack
- An OpenRouter API key

Install and run:

```powershell
copy .env.example .env
npm install
npm run db:up
npm run seed
npm run dev
```

Then open `http://localhost:3000`.

The repo uses OpenRouter with a single LLM path. The default template points to:

- model: `openai/gpt-4.1-mini`
- embedding model: `openai/text-embedding-3-small`

The seeded demo uses Qatar municipality data examples such as:

- service requests by municipality
- inspection scores by zone
- open permits by municipality
- project budget by municipality

## System at a glance

```text
Client prompt
   ->
Express endpoint
   ->
Mastra workflow
   ->
Supervisor plan
   ->
MongoDB data fetch
   -> optional Search enrichment
   ->
Chart generation or summary/report writing
   ->
JSON response for the caller
```

The three public endpoints are:

- `POST /api/inquiry`
- `POST /api/report`
- `POST /api/dashboard`

There is also a health endpoint:

- `GET /health`

## Current implementation status

The repository is functional as a local demo and integration base, but some parts are intentionally incomplete:

- web enrichment requires a real configured provider such as Tavily or Brave
- internal knowledge retrieval now uses OpenRouter embeddings plus a Mongo-backed semantic index over the exported knowledge corpus
- the report workflow now uses the dedicated writer agent for report sections
- the dashboard workflow merges enrichment inline instead of using the dedicated merge tool
- report and inquiry audits expose the generated plan, while dashboard audit also exposes the executed MongoDB pipeline
- there are no automated tests checked into `tests/` yet

Those details are documented in [Troubleshooting and known limitations](docs/troubleshooting.md).
"# TaskAi" 
# TaskAi
