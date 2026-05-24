import type { DataStore, DataStoreField } from '../../types/index.js';

export function getTemporalFields(dataStore: Pick<DataStore, 'fields'>): DataStoreField[] {
  return dataStore.fields.filter(
    (field) => field.role === 'temporal' || field.type === 'date' || field.type === 'datetime',
  );
}
