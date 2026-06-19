// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file defines the MONGOOSE SCHEMA for the "chart_results" MongoDB collection.
// A schema describes the shape of each document stored in that collection.
//
// Think of it like a table definition in SQL:
//   chart_results collection = { prompt, sourceName, dashboard, createdAt, updatedAt }
//
// USED BY:  ChartResultsRepository  (ai/chart-results.repository.ts)
// REGISTERED IN:  AnalyticsModule   (analytics/analytics.module.ts)
// ─────────────────────────────────────────────────────────────────────────────

// @nestjs/mongoose decorators that replace manual Mongoose schema definition:
// @Prop    → marks a class property as a MongoDB field
// @Schema  → marks a class as a Mongoose schema
// SchemaFactory → converts the decorated class into an actual Mongoose Schema object
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

// MongooseSchema.Types.Mixed → tells Mongoose "store this field as any JSON object"
// HydratedDocument<T>        → TypeScript type for a fully-loaded Mongoose document
//                              (adds _id, .save(), .toObject(), etc. on top of T)
import { Schema as MongooseSchema, type HydratedDocument } from 'mongoose';

// DashboardSpec → the full chart output shape: { layout, title, summary, widgets[] }
import type { DashboardSpec } from '../../types';

// ── DOCUMENT TYPE ─────────────────────────────────────────────────────────────
// ChartResultDocument = ChartResult fields + Mongoose document methods (_id, .save(), etc.)
// Used as the generic type parameter in: Model<ChartResultDocument>
export type ChartResultDocument = HydratedDocument<ChartResult>;

// ── SCHEMA DEFINITION ─────────────────────────────────────────────────────────
// @Schema options:
//   collection:  "chart_results" → exact MongoDB collection name (no auto-pluralization)
//   versionKey:  false           → disables the __v field Mongoose adds by default
//   timestamps:  true            → auto-adds createdAt and updatedAt fields to every document
@Schema({ collection: 'chart_results', versionKey: false, timestamps: true })
export class ChartResult {

  // The user's original question that triggered this dashboard.
  // required: true → MongoDB will reject documents missing this field.
  @Prop({ required: true })
  prompt: string;

  // The name of the data source that was queried (e.g. "projects", "municipalities").
  // index: true → MongoDB builds an index on this field for fast queries like
  //               "find all dashboards for source X".
  @Prop({ required: true, index: true })
  sourceName: string;

  // The complete dashboard output: { layout, title, summary, widgets[] }.
  // MongooseSchema.Types.Mixed → stored as a raw JSON object in MongoDB.
  // Mongoose won't validate its internal structure — DashboardSpec is only
  // enforced at the TypeScript level.
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  dashboard: DashboardSpec;
}

// ── SCHEMA EXPORT ─────────────────────────────────────────────────────────────
// SchemaFactory.createForClass() reads the @Prop decorators above and produces
// a real Mongoose Schema object. This is what gets registered in analytics.module.ts:
//   MongooseModule.forFeature([{ name: ChartResult.name, schema: ChartResultSchema }])
export const ChartResultSchema = SchemaFactory.createForClass(ChartResult);
