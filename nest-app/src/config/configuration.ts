const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default () => ({
  server: {
    port:            positiveInt(process.env['PORT'], 3000),
    shutdownTimeout: positiveInt(process.env['SHUTDOWN_TIMEOUT_MS'], 10_000),
    allowedOrigins:  process.env['ALLOWED_ORIGINS']
      ? process.env['ALLOWED_ORIGINS'].split(',').map(o => o.trim()).filter(Boolean)
      : [] as string[],
    apiKey: process.env['API_KEY'],
  },
  mongodb: {
    uri:                      process.env['MONGODB_URI'] ?? process.env['DB_URL'],
    db:                       process.env['MONGODB_DB'],
    serverSelectionTimeoutMs: positiveInt(process.env['MONGODB_SERVER_SELECTION_TIMEOUT_MS'], 8_000),
    connectRetries:           positiveInt(process.env['MONGODB_CONNECT_RETRIES'], 1),
    pipelineTimeoutMs:        positiveInt(process.env['MONGODB_PIPELINE_TIMEOUT_MS'], 30_000),
  },
  llm: {
    // Provider, model, and API key come from each user's saved settings — not from server env.
    timeouts: {
      supervisor: positiveInt(process.env['SUPERVISOR_TIMEOUT_MS'], 8_000),
      chart:      positiveInt(process.env['CHART_TIMEOUT_MS'],      8_000),
      writer:     positiveInt(process.env['WRITER_TIMEOUT_MS'],     8_000),
    },
  },
});
