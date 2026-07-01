import type { DataSource, DataSourceField } from '../types';

export type { DataSource, DataSourceField };

let cache: DataSource[] = [];

export function getSources(): DataSource[] {
  return cache;
}
export function setSourcesCache(sources: DataSource[]): void {
  cache = sources;
}

export function normalizeToken(name: string | undefined | null): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .trim();
}
