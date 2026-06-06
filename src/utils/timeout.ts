export function envTimeout(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : defaultMs;
}

export function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error as Error); },
    );
  });
}
