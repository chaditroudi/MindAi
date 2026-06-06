import type { DataSource, PermissionScope } from '../types/index.js';
import { PRINCIPAL_SUPERVISOR_SOURCES } from '../config/principal-supervisor-structure.js';

export function normalizeToken(value?: string) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ?? '';
}

export async function resolveSources(
  scope: PermissionScope,
  sources?: DataSource[],
): Promise<DataSource[]> {
  const available = sources?.length ? sources : PRINCIPAL_SUPERVISOR_SOURCES;
  const allowed = new Set((scope.allowedSources ?? []).map(normalizeToken).filter(Boolean));
  if (allowed.size === 0) return available;

  const filtered = available.filter(
    (source) =>
      allowed.has(normalizeToken(source.name)) ||
      allowed.has(normalizeToken(source.collection)),
  );
  return filtered.length > 0 ? filtered : available;
}

export function findSource(name: string, sources: DataSource[]) {
  const token = normalizeToken(name);
  return sources.find(
    (source) =>
      normalizeToken(source.name) === token ||
      normalizeToken(source.collection) === token,
  );
}
