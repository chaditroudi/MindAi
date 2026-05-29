# Troubleshooting

## MongoDB Connection Refused

If you see `connect ECONNREFUSED 127.0.0.1:27017`, start MongoDB or Docker Desktop.

```powershell
docker compose up -d
npm run import:db-export
```

## No Data Store Found

Check that `data_stores` contains metadata with `name`, `collection`, and `fields`.

## LLM Provider Errors

Check:

- `LLM_PROVIDER=openrouter` with `OPENROUTER_API_KEY`
- or `LLM_PROVIDER=groq` with `GROQ_API_KEY`
- the selected model exists for that provider

If you see "model not found", the model name belongs to a different provider or is not available on the selected provider.
