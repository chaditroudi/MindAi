import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';

export type SavedResultDocument = HydratedDocument<SavedResult>;

@Schema({ collection: 'saved_results', versionKey: false, timestamps: true })
export class SavedResult {
  @Prop({ required: true, index: true, trim: true })
  userId: string;

  @Prop({ required: true, maxlength: 200, trim: true })
  title: string;

  @Prop({ required: true, maxlength: 1000 })
  prompt: string;

  @Prop({ required: true, enum: ['dashboard', 'report', 'inquiry'] })
  intent: 'dashboard' | 'report' | 'inquiry';

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  result: unknown;

  // Populated by timestamps: true — declared here so TypeScript sees them on lean() results
  createdAt!: Date;
  updatedAt!: Date;
}

export const SavedResultSchema = SchemaFactory.createForClass(SavedResult);
// Compound index: per-user list sorted by creation time
SavedResultSchema.index({ userId: 1, createdAt: -1 });
