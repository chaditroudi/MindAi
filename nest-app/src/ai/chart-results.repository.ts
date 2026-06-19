// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file is a REPOSITORY — its only job is to save generated dashboard
// results into MongoDB. It has zero business logic. It just writes one document
// to the "chart_results" collection every time a dashboard is successfully built.
//
// WHO CALLS IT:  PipelineService.executeDashboard()  (analytics/pipeline.service.ts)
// WHEN:          After runChart() returns a DashboardSpec (fire-and-forget, never awaited)
// COLLECTION:    chart_results  (defined in schemas/chart-result.schema.ts)
// ─────────────────────────────────────────────────────────────────────────────

// @Injectable() → tells NestJS this class can be injected into other classes via DI
// Logger        → NestJS built-in; prints tagged log lines to the console
import { Injectable, Logger } from '@nestjs/common';

// @InjectModel() → decorator that pulls a Mongoose model out of the DI container
import { InjectModel } from '@nestjs/mongoose';

// Model<T> → Mongoose generic class; gives us .create() .find() .findById() etc.
import { Model } from 'mongoose';

// ChartResult        → the Mongoose schema class (describes the MongoDB document shape)
// ChartResultDocument → TypeScript type = ChartResult + mongoose Document (_id, .save(), etc.)
import { ChartResult, type ChartResultDocument } from './schemas/chart-result.schema';

// DashboardSpec → the full chart output shape: { layout, title, summary, widgets[] }
import type { DashboardSpec } from '../types';

// ── INPUT CONTRACT ─────────────────────────────────────────────────────────────
// This interface defines what the caller must pass to save().
// It is NOT the MongoDB schema — just the TypeScript shape for callers.
export interface ChartResultEntry {
  prompt:     string;       // the user's original natural-language question
  sourceName: string;       // which data collection was queried (e.g. "projects")
  dashboard:  DashboardSpec; // the complete chart output (widgets, layout, summary)
}

// @Injectable() → required so NestJS can inject this class into PipelineService
@Injectable()
export class ChartResultsRepository {

  // Logger tagged with the class name so every log line shows "[ChartResultsRepository]"
  private readonly logger = new Logger(ChartResultsRepository.name);

  constructor(
    // @InjectModel(ChartResult.name) → asks NestJS DI for the Mongoose model
    // registered under the name "ChartResult" (set up in analytics.module.ts).
    // This gives us access to the "chart_results" MongoDB collection.
    @InjectModel(ChartResult.name)
    private readonly model: Model<ChartResultDocument>,
  ) {}

  // ── save() ──────────────────────────────────────────────────────────────────
  // Inserts one document into the "chart_results" MongoDB collection.
  // Returns void — the caller does not need the inserted document back.
  //
  // IMPORTANT: the whole method is wrapped in try/catch because saving history
  // must NEVER crash the app. If this fails, the user still gets their dashboard.
  async save(entry: ChartResultEntry): Promise<void> {
    try {
      // this.model.create(entry) → inserts the entry as a new MongoDB document.
      // Mongoose automatically adds _id, createdAt, updatedAt (if schema has timestamps).
      await this.model.create(entry);

      // Log success: shows which data source was used and how many widgets were saved.
      this.logger.log(`saved | source: ${entry.sourceName} | widgets: ${entry.dashboard.widgets.length}`);

    } catch (err) {
      // Log the error but DO NOT re-throw — caller used .catch(() => undefined)
      // so this is fire-and-forget. A failed save is non-fatal.
      // "err instanceof Error ? err.message : String(err)" safely handles both
      // Error objects and plain thrown strings/objects.
      this.logger.error(`save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
