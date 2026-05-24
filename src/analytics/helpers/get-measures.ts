import type { DataStore, DataStoreField } from '../../types/index.js';

export function getMeasures(dataStore: Pick<DataStore, 'fields'>): DataStoreField[] {
  return dataStore.fields.filter((field) => field.role === 'measure');
}
