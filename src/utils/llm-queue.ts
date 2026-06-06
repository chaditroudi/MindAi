let _queue: Promise<void> = Promise.resolve();

export function runQueuedLlmCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queue.then(fn);
  _queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
