import type { DataStore, PermissionScope } from '../types/index.js';
import { getMongo } from './mongo.client.js';

export class DataStoreRepository {
  private dataStoreCache: DataStore[] | null = null;

  async findDataStore(dataStoreName: string) {
    const dataStores = await this.loadDataStores();
    const normalizedName = normalizeToken(dataStoreName);

    return dataStores.find(
      (ds) =>
        normalizeToken(ds.name) === normalizedName ||
        normalizeToken(ds.collection) === normalizedName,
    ) ?? null;
  }

  async listAccessibleDataStores(scope: Pick<PermissionScope, 'allowedDataStores'> = {}): Promise<DataStore[]> {
    const dataStores = await this.loadDataStores();
    const allowed = new Set((scope.allowedDataStores ?? []).map(normalizeToken).filter(Boolean));
    if (allowed.size === 0) return dataStores;
    return dataStores.filter(
      (ds) => allowed.has(normalizeToken(ds.name)) || allowed.has(normalizeToken(ds.collection)),
    );
  }

  private async loadDataStores() {
    if (this.dataStoreCache) return this.dataStoreCache;

    const { db } = await getMongo();
    const dataStores = await db
      .collection<DataStore>('data_stores')
      .find({ fields: { $exists: true } })
      .toArray();

    if (dataStores.length === 0) {
      throw new Error('No data stores found. Seed or provision the "data_stores" collection with fields.');
    }

    this.dataStoreCache = dataStores;
    return dataStores;
  }
}

export const dataStoreRepo = new DataStoreRepository();

function normalizeToken(value: string | undefined) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
