# Setup and Operations

## Environment

Copy `.env.example` to `.env`.

Core settings:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`
- `OLLAMA_MODEL=gpt-oss:20b`
- `MONGODB_URI=mongodb://127.0.0.1:27017/mind_platform`
- `MONGODB_DB=mind_platform`

## Commands

```powershell
npm install
npm run db:up
npm run db:wait
npm run seed
npm run dev
```

MongoDB must be running and seeded. The app does not fall back to local sample files.

## Docker MongoDB

```powershell
npm run db:up
npm run seed
```
