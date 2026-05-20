/**
 * Minimal structured logger.
 *
 * Goals:
 *   - Zero dependencies (uses console.log/error so it works in any host).
 *   - Single-line JSON output so logs are parseable by Datadog, Loki, ELK, etc.
 *   - Per-request correlation via `runId`.
 *   - A `time()` helper so workflow steps can record duration without manual
 *     bookkeeping.
 *
 * Why not pino/winston? They're great, but this project intentionally keeps
 * its dependency surface tiny. When you outgrow this, swap the implementation
 * here; nothing else has to change.
 *
 * Set LOG_LEVEL=debug to see debug rows. Default is info.
 * Set LOG_PRETTY=1 in local dev for indented output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

function shouldLog(level: LogLevel) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel()];
}

function isPretty() {
  return process.env.LOG_PRETTY === '1' || process.env.NODE_ENV === 'development';
}

export interface LogContext {
  runId?: string;
  workflow?: string;
  step?: string;
  agent?: string;
  tenantId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  if (!shouldLog(level)) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  };
  const line = isPretty() ? JSON.stringify(record, null, 2) : JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const log = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};

/**
 * Wrap an async function with timing + structured logging.
 * Emits one row on success ("ok") and one row on failure ("err"), both with
 * `durationMs`. Re-throws on failure so calling code still sees the error.
 */
export async function logged<T>(
  message: string,
  context: LogContext,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.info(`${message} ok`, { ...context, durationMs: Date.now() - start });
    return result;
  } catch (error) {
    log.error(`${message} err`, {
      ...context,
      durationMs: Date.now() - start,
      err: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate a short, sortable run id. Useful when you want to correlate every
 * log row produced by a single request.
 */
export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
