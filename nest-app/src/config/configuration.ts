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
    // Generic keys — provider/model come from user settings, not server config.
    // AI_API_KEY and GROQ_API_KEY are both accepted as a system-level fallback key.
    apiKey:   process.env['AI_API_KEY'] ?? process.env['GROQ_API_KEY'],
    model:    process.env['AI_MODEL'],
    provider: process.env['AI_PROVIDER'],
    timeouts: {
      supervisor: positiveInt(process.env['SUPERVISOR_TIMEOUT_MS'], 8_000),
      chart:      positiveInt(process.env['CHART_TIMEOUT_MS'],      8_000),
      writer:     positiveInt(process.env['WRITER_TIMEOUT_MS'],      8_000),
    },
  },
});
