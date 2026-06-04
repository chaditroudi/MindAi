let queue = Promise.resolve();

export function runQueuedLlmCall<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.LLM_SERIAL_QUEUE !== '1') {
    return fn();
  }

  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
