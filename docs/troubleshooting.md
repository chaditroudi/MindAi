# Troubleshooting

## MongoDB Connection Refused

If you see `connect ECONNREFUSED 127.0.0.1:27017`, start MongoDB or Docker Desktop.

```powershell
docker compose up -d
npm run seed
```

## No Data Store Found

Check that `data_stores` contains metadata with `name`, `collection`, and `fields`.

## Ollama Errors

Check:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

The configured endpoint must be OpenAI-compatible.
