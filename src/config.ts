const {
  PORT,
  SHUTDOWN_TIMEOUT_MS,
  ALLOWED_ORIGINS,
  API_KEY,
  MONGODB_URI,
  DB_URL,
  MONGODB_DB,
  MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  MONGODB_CONNECT_RETRIES,
  MONGODB_PIPELINE_TIMEOUT_MS,
} = process.env;

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  server: {
    port:            positiveNumber(PORT, 3000),
    shutdownTimeout: positiveNumber(SHUTDOWN_TIMEOUT_MS, 10_000),
    allowedOrigins:  ALLOWED_ORIGINS ? ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(s => s.length > 0) : [] as string[],
    apiKey:          API_KEY,
  },

  mongodb: {
    uri:                      MONGODB_URI ?? DB_URL,
    db:                       MONGODB_DB,
    serverSelectionTimeoutMs: positiveNumber(MONGODB_SERVER_SELECTION_TIMEOUT_MS, 8_000),
    connectRetries:           positiveNumber(MONGODB_CONNECT_RETRIES, 1),
    pipelineTimeoutMs:        positiveNumber(MONGODB_PIPELINE_TIMEOUT_MS, 30_000),
  },
} as const;
