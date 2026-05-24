import type { DataStore, PermissionScope } from '../../types/index.js';

export function validateScope(dataStore: DataStore, scope: PermissionScope): void {
  if (!scope.allowedDataStores?.length) return;

  const allowed = new Set(scope.allowedDataStores);
  if (!allowed.has(dataStore.name) && !allowed.has(dataStore.collection)) {
    throw new Error(`Data store '${dataStore.name}' is not allowed for this scope.`);
  }
}
