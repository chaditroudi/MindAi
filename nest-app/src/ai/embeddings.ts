// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline, env } = require('@xenova/transformers') as typeof import('@xenova/transformers');

import { log } from '../common/logger/app.logger';
import * as path from 'node:path';

// Cache models inside the nest-app directory so they survive rebuilds
env.cacheDir = path.resolve(__dirname, '..', '..', '.model-cache');

// Singleton pipeline — initialised once, reused for every embedding request
let _pipe: ReturnType<typeof pipeline> extends Promise<infer T> ? T : never;
let _loading: Promise<typeof _pipe> | null = null;

async function getPipeline(): Promise<typeof _pipe> {
  if (_pipe) return _pipe;
  if (_loading) return _loading;

  _loading = (async () => {
    log('embeddings', 'loading all-MiniLM-L6-v2 (downloads ~25MB on first run)...');
    const p = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    log('embeddings', 'model ready');
    _pipe = p as typeof _pipe;
    _loading = null;
    return _pipe;
  })();

  return _loading;
}

/** Warm up the model in the background at server start (optional but avoids first-request delay). */
export function warmupEmbeddings(): void {
  getPipeline().catch(err =>
    log('embeddings', `warmup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`),
  );
}

/**
 * Returns a normalised 384-dimensional embedding vector for the given text.
 * Uses all-MiniLM-L6-v2 running fully locally via WASM — no API key required.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const output = await (pipe as (text: string, opts: object) => Promise<{ data: Float32Array }>)(
    text,
    { pooling: 'mean', normalize: true },
  );
  return Array.from(output.data);
}

/** Cosine similarity between two L2-normalised vectors (range -1 to 1). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalised so |a|=|b|=1
}
