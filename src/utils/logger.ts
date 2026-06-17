import { AsyncLocalStorage } from 'node:async_hooks';

const COLORS = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
};

const TAG_COLORS: Record<string, string> = {
  'router':          COLORS.cyan,
  'analytics':       COLORS.blue,
  'supervisor-plan': COLORS.magenta,
  'aggregation':     COLORS.yellow,
  'chart-agent':     COLORS.green,
  'writer-agent':    COLORS.green,
  'sources':         COLORS.gray,
};

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

function ts() {
  return new Date().toISOString().slice(11, 23);
}

export function log(tag: string, msg: string, data?: unknown): void {
  const color  = TAG_COLORS[tag] ?? COLORS.gray;
  const store  = requestContext.getStore();
  const reqId  = store ? ` ${COLORS.dim}[${store.requestId.slice(0, 8)}]${COLORS.reset}` : '';
  const prefix = `${COLORS.dim}[${ts()}]${COLORS.reset}${reqId} ${color}${COLORS.bold}[${tag}]${COLORS.reset}`;
  if (data !== undefined) {
    const json = JSON.stringify(data, null, 2);
    console.log(`${prefix} ${msg}\n${COLORS.dim}${json}${COLORS.reset}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export function logSep(label: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${COLORS.dim}${line}${COLORS.reset}`);
  console.log(`${COLORS.bold} ${label}${COLORS.reset}`);
  console.log(`${COLORS.dim}${line}${COLORS.reset}`);
}

/** Only emits when TRACE=1 — use for large payloads (pipelines, rows, LLM output). */
export function logTrace(tag: string, msg: string, data?: unknown): void {
  if (process.env['TRACE'] !== '1') return;
  log(tag, `[TRACE] ${msg}`, data);
}
