import type { Blueprint } from '../types/index.js';
import { getMongo } from './mongo.client.js';

export class BlueprintRepository {
  private cache: Map<string, Blueprint> = new Map();
  private loaded = false;

  async loadAll(): Promise<Blueprint[]> {
    if (this.loaded) return Array.from(this.cache.values());

    const { db } = await getMongo();
    const docs = await db.collection<Blueprint>('_blueprints').find({}).toArray();
    const blueprints = docs.map((doc) => ({
      ...doc,
      id: doc.id ?? String((doc as { _id?: { toString(): string } })._id?.toString?.() ?? ''),
    }));

    if (blueprints.length === 0) {
      throw new Error('No blueprints found in MongoDB collection "_blueprints". Seed or provision blueprint metadata before starting the service.');
    }

    for (const bp of blueprints) this.cache.set(bp.id, bp);
    this.loaded = true;
    return blueprints;
  }

  async getById(id: string): Promise<Blueprint | null> {
    if (!this.loaded) await this.loadAll();
    return this.cache.get(id) ?? null;
  }

  async findDataStore(blueprintId: string, dataStoreName: string) {
    const bp = await this.getById(blueprintId);
    if (!bp) return null;
    return bp.dataStores.find((ds) => ds.name === dataStoreName) ?? null;
  }

  async listAccessible(allowedBlueprintIds: string[]): Promise<Blueprint[]> {
    if (!this.loaded) await this.loadAll();
    return Array.from(this.cache.values()).filter((bp) => allowedBlueprintIds.includes(bp.id));
  }
}

export const blueprintRepo = new BlueprintRepository();
