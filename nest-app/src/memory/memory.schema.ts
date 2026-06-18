import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Document } from 'mongoose';

export type MemoryType = 'goal' | 'insight' | 'preference' | 'context' | 'decision';

@Schema({ timestamps: true, collection: 'memory_items' })
export class MemoryItem {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) sessionId!: string;
  @Prop({ required: true, enum: ['goal', 'insight', 'preference', 'context', 'decision'] }) type!: MemoryType;
  @Prop({ required: true }) content!: string;
  @Prop({ type: [String], default: [] }) tags!: string[];
  @Prop({ min: 1, max: 5, default: 3 }) importance!: number;
  /** 384-dim normalised vector from all-MiniLM-L6-v2 — used for cosine similarity retrieval */
  @Prop({ type: [Number], default: [] }) embedding!: number[];
}

export type MemoryItemDocument = MemoryItem & Document;
export const MemoryItemSchema = SchemaFactory.createForClass(MemoryItem);

MemoryItemSchema.index({ userId: 1, importance: -1, createdAt: -1 });
MemoryItemSchema.index({ userId: 1, tags: 1 });
