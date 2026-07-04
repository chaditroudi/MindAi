import { Injectable, LoggerService } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
};

const TAG_COLORS: Record<string, string> = {
  router: COLORS.cyan,
  analytics: COLORS.blue,
  'supervisor-plan': COLORS.magenta,
  aggregation: COLORS.yellow,
  'chart-agent': COLORS.green,
  'writer-agent': COLORS.green,
  sources: COLORS.gray,
};

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function emit(tag: string, msg: string, data?: unknown): void {
  const color = TAG_COLORS[tag] ?? COLORS.gray;
  const store = requestContext.getStore();
  const reqId = store
    ? ` ${COLORS.dim}[${store.requestId.slice(0, 8)}]${COLORS.reset}`
    : '';
  const prefix = `${COLORS.dim}[${ts()}]${COLORS.reset}${reqId} ${color}${COLORS.bold}[${tag}]${COLORS.reset}`;
  if (data !== undefined) {
    console.log(
      `${prefix} ${msg}\n${COLORS.dim}${JSON.stringify(data, null, 2)}${COLORS.reset}`,
    );
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export function log(tag: string, msg: string, data?: unknown): void {
  emit(tag, msg, data);
}

export function logTrace(tag: string, msg: string, data?: unknown): void {
  if (process.env['TRACE'] !== '1') return;
  emit(tag, `[TRACE] ${msg}`, data);
}

@Injectable()
export class AppLogger implements LoggerService {
  log(message: string, context?: string) {
    emit(context ?? 'nest', message);
  }
  error(message: string, stackOrContext?: string, context?: string) {
    const tag =
      context ??
      (stackOrContext && !stackOrContext.includes('\n')
        ? stackOrContext
        : 'nest');
    emit(tag, `${COLORS.red}ERROR${COLORS.reset} ${message}`);
  }
  warn(message: string, context?: string) {
    emit(context ?? 'nest', `${COLORS.yellow}WARN${COLORS.reset}  ${message}`);
  }
  debug(message: string, context?: string) {
    if (process.env['DEBUG']) emit(context ?? 'nest', message);
  }
  verbose() {
    /* omit verbose */
  }
}
