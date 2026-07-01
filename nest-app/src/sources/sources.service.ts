import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { getSources, setSourcesCache, type DataSource } from './sources-cache';
import type { DataSourceField } from '../types';

@Schema({
  collection: 'sources',
  versionKey: false,
  timestamps: true,
  suppressReservedKeysWarning: true,
})
export class Source {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, index: true, trim: true })
  collection: string;

  @Prop()
  description?: string;

  @Prop({ type: [Object], required: true })
  fields: DataSourceField[];

  @Prop({ type: Object })
  meta?: Record<string, unknown>;
}

export type SourceDocument = HydratedDocument<Source>;
export const SourceSchema = SchemaFactory.createForClass(Source);

const MODE_META = {
  dashboard: {
    placeholder: 'Example: show projects by status',
    promptFn: (name: string) => `show a dashboard overview of ${name}`,
  },
  report: {
    placeholder: 'Example: generate a report on infrastructure projects',
    promptFn: (name: string) => `generate an analytical report for ${name}`,
  },
  inquiry: {
    placeholder: 'Example: how many projects are in progress?',
    promptFn: (name: string) => `how many records are in ${name}?`,
  },
} as const;

type ModeKey = keyof typeof MODE_META;

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    @InjectModel(Source.name)
    private readonly model: Model<SourceDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadCache();
    const sources = getSources();
    if (sources.length) {
      this.logger.log(
        `${sources.length} dataset(s) loaded: ${sources.map((s) => s.name).join(', ')}`,
      );
    } else {
      this.logger.warn(
        'No sources found — register a dataset via POST /api/sources',
      );
    }
  }

  private async reloadCache(): Promise<void> {
    const docs = await this.model
      .find({})
      .select('-_id -__v -createdAt -updatedAt')
      .lean();
    setSourcesCache(docs);
  }

  getMeta() {
    const sources = getSources();
    const modes = (
      Object.entries(MODE_META) as [ModeKey, (typeof MODE_META)[ModeKey]][]
    ).map(([intent, meta]) => ({
      intent,
      placeholder: meta.placeholder,
      prompts: sources.map((s) => ({
        label: s.name,
        prompt: meta.promptFn(s.name),
      })),
    }));
    return { modes };
  }

  list(): DataSource[] {
    return getSources();
  }

  async register(source: DataSource): Promise<{ ok: boolean; loaded: number }> {
    await this.model.replaceOne(
      { collection: source.collection } as Record<string, unknown>,
      source,
      { upsert: true },
    );
    await this.reloadCache();
    this.logger.log(
      `registered: "${source.name}" (${source.collection}) — total: ${getSources().length}`,
    );
    return { ok: true, loaded: getSources().length };
  }

  async remove(collection: string): Promise<boolean> {
    const r = await this.model.deleteOne({ collection } as Record<
      string,
      unknown
    >);
    if (!r.deletedCount) return false;
    await this.reloadCache();
    this.logger.log(`deleted: "${collection}" — total: ${getSources().length}`);
    return true;
  }
}
