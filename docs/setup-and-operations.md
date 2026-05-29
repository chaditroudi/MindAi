# Setup and Operations

## Environment

Copy `.env.example` to `.env`.

Core settings:

- `LLM_PROVIDER=openrouter`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`
- Optional Groq path: `LLM_PROVIDER=groq`, `GROQ_API_KEY=...`, `GROQ_MODEL=llama-3.3-70b-versatile`
- `MONGODB_URI=mongodb://127.0.0.1:27017/mind_platform`
- `MONGODB_DB=mind_platform`

## Commands

```powershell
npm install
npm run db:up
npm run db:wait
npm run import:db-export
npm run dev
```

MongoDB must be running and imported with data store metadata plus records. The app does not fall back to local sample files.

## Docker MongoDB

```powershell
npm run db:up
npm run import:db-export
```
