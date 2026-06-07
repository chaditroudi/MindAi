import type { DataSource } from '../types/index.js';

export function normalizeToken(value?: string) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ?? '';
}



export function findSource(name: string, sources: DataSource[]) {
  const token = normalizeToken(name);
  return sources.find(
    (source) =>
      normalizeToken(source.name) === token ||
      normalizeToken(source.collection) === token,
  );
}
