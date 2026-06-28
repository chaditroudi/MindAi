import * as path from 'node:path';
import { log } from '../common/logger/app.logger';

type XenovaModule = typeof import('@xenova/transformers');
type EmbeddingPipeline = Awaited<ReturnType<XenovaModule['pipeline']>>;

let _module:  XenovaModule | null = null;
let _pipe:    EmbeddingPipeline | null = null;
let _loading: Promise<EmbeddingPipeline> | null = null;

async function getModule(): Promise<XenovaModule> {
  if (!_module) {
    _module = (await import('@xenova/transformers')) as XenovaModule;
    _module.env.cacheDir = path.resolve(__dirname, '..', '..', '.model-cache');
  }
  return _module;
}

async function getPipeline(): Promise<EmbeddingPipeline> {
  if (_pipe) return _pipe;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const { pipeline } = await getModule();
      log('embeddings', 'loading all-MiniLM-L6-v2 (~25MB download on first run)...');
      const p = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      log('embeddings', 'embedding model ready');
      _pipe    = p as EmbeddingPipeline;
      _loading = null;
      return _pipe;
    } catch (err) {
      _loading = null;
      throw err;
    }
  })();

  return _loading;
}

export function warmupEmbeddings(): void {
  getPipeline().catch(err =>
    log('embeddings', `warmup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`),
  );
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (pipe as any)(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalised → |a|=|b|=1
}
