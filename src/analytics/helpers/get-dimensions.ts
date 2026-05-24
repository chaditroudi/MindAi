import type { DataStore, DataStoreField } from '../../types/index.js';

export function getDimensions(dataStore: Pick<DataStore, 'fields'>): DataStoreField[] {
  return dataStore.fields.filter((field) => field.role === 'dimension');
}
