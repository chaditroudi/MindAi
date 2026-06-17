import type { DataSource, DataSourceField } from '../types';

export type { DataSource, DataSourceField };

// In-memory source cache — populated by SourcesService.onModuleInit()
// and refreshed after every register/remove via SourcesService.
let cache: DataSource[] = [];

export function getSources(): DataSource[] { return cache; }
export function setSourcesCache(sources: DataSource[]): void { cache = sources; }
