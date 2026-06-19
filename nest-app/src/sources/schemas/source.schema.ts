import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type { DataSourceField } from '../../types';

export type SourceDocument = HydratedDocument<Source>;

@Schema({ collection: 'sources', versionKey: false, timestamps: true, suppressReservedKeysWarning: true })
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

export const SourceSchema = SchemaFactory.createForClass(Source);
