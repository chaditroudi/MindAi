import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

export type AgentStatus = 'active' | 'disabled' | 'expired' | 'idle';
// active   - healthy, currently usable, eligible to become currentAgentId
// disabled - manually turned off by an admin; the health cron skips it entirely
// expired  - failed a real request or health probe (bad key / model gone);
//            eligible to be re-checked and flipped back to 'active' automatically
// idle     - temporarily benched, usually mid-cooldown after a rate limit

/**
 * AgentEntry
 * ----------
 * One pooled LLM connection, embedded inside the single AgentConfig document
 * (see below — this is NOT its own collection, `@Schema({ _id: false })`
 * means Mongoose treats it as a plain sub-document array element rather than
 * giving each entry its own top-level `_id`/collection).
 *
 * The token-limit fields are *configured* ceilings (set by an admin); the
 * *Used fields are running counters incremented by AgentConfigService as
 * requests complete. `lastInputTokens` records the actual size of the most
 * recent successful request against this agent — AnalyticsService uses it as
 * a better estimate than the generic chars/4 heuristic when deciding whether
 * a new request will fit under `inputTokenLimit`.
 */
@Schema({ _id: false })
export class AgentEntry {
  @Prop({ required: true }) id!: string;

  @Prop({ enum: ['active', 'disabled', 'expired', 'idle'], default: 'idle' })
  status!: AgentStatus;

  @Prop({ required: true }) provider!: string;
  @Prop({ required: true }) model!: string;
  @Prop({ required: true }) apiKey!: string;

  @Prop({ min: 1, default: 8_000 }) inputTokenLimit!: number;
  @Prop({ min: 1, default: 8_000 }) outputTokenLimit!: number;
  @Prop({ min: 1, default: 4_000 }) memoryTokenLimit!: number;

  // Lifetime usage counters — zeroed once a month by
  // AgentHealthService.resetMonthlyUsage(), never per-request.
  @Prop({ min: 0, default: 0 }) inputTokensUsed!: number;
  @Prop({ min: 0, default: 0 }) outputTokensUsed!: number;

  // Size of the most recently completed request — used as a "recent
  // successful request size" estimate for pre-flight limit checks.
  @Prop({ min: 0, default: 0 }) lastInputTokens!: number;

  // Set when a rate-limit response is classified as recoverable (vs.
  // long-term quota exhaustion, which sets status='expired' directly
  // instead). Read via isCooldownActive() before treating this agent as
  // eligible again.
  @Prop({ type: Date, default: null }) cooldownUntil?: Date | null;

  // Human-readable reason surfaced in the admin UI for why this agent isn't
  // currently active — cleared back to '' whenever status flips to 'active'.
  @Prop({ default: '' }) lastFailureReason?: string;
}
export const AgentEntrySchema = SchemaFactory.createForClass(AgentEntry);

/**
 * AgentConfig
 * -----------
 * The whole pooled-agent configuration lives in exactly ONE document of this
 * collection — every repository method below queries with an empty filter
 * `{}` rather than by any id, because there's nothing to distinguish between;
 * it's a singleton settings record, not a per-something table.
 */
@Schema({ collection: 'agent_config', timestamps: true, versionKey: false })
export class AgentConfig {
  // Max number of long-term-memory items injected as context per request —
  // shared across all users of the pooled agents (see AnalyticsService).
  @Prop({ min: 1, default: 50 }) memoryLimit!: number;

  // Which agent in `agents` should be tried first. Kept in sync automatically
  // by AgentConfigService.syncCurrentAgent() whenever the previously-current
  // agent stops being eligible (disabled, cooling down, or removed).
  @Prop({ type: String, default: null }) currentAgentId!: string | null;

  @Prop({ type: [AgentEntrySchema], default: [] })
  agents!: AgentEntry[];
}

export type AgentConfigDocument = HydratedDocument<AgentConfig>;
export const AgentConfigSchema = SchemaFactory.createForClass(AgentConfig);

// Shape accepted by AgentConfigService.save() — everything optional because a
// partial admin edit (e.g. just changing memoryLimit) shouldn't require
// resending the entire agents array.
export interface AgentConfigPayload {
  memoryLimit?: number;
  currentAgentId?: string | null;
  agents?: Partial<AgentEntry>[];
}

// Shape accepted by updateRuntime() below — the subset of AgentEntry fields
// that get changed as a *side effect* of a request succeeding or failing,
// as opposed to fields an admin edits directly through the config UI.
export interface AgentRuntimeUpdate {
  status?: AgentStatus;
  cooldownUntil?: Date | null;
  lastFailureReason?: string;
}

/**
 * AgentConfigRepository
 * ---------------------
 * Thin, single-purpose wrappers around raw Mongoose calls. Each method here
 * does exactly one kind of write; the *decisions* about what to write and
 * when (id de-duplication, cooldown logic, current-agent selection) all live
 * one layer up in AgentConfigService — this file has no business logic.
 */
@Injectable()
export class AgentConfigRepository {
  constructor(
    @InjectModel(AgentConfig.name)
    private readonly model: Model<AgentConfigDocument>,
  ) {}

  /** Reads the singleton config document, or null if it's never been created. */
  async get(): Promise<AgentConfigDocument | null> {
    return this.model.findOne().lean();
  }

  /**
   * Merges the given fields into the singleton document, creating it on the
   * very first call (`upsert: true`). `setDefaultsOnInsert: true` ensures a
   * brand-new document still gets the schema's default values (e.g.
   * memoryLimit: 50) for any field not included in `data`.
   */
  async save(data: AgentConfigPayload): Promise<AgentConfigDocument> {
    return this.model
      .findOneAndUpdate(
        {},
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  /** Just the "which agent is current" pointer, without touching the agents array. */
  async updateCurrentAgentId(currentAgentId: string | null): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { currentAgentId } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  /**
   * Updates one embedded agent's status without rewriting the whole `agents`
   * array. `arrayFilters: [{ 'agent.id': agentId }]` + the `$[agent]`
   * placeholder is MongoDB's syntax for "find the array element matching
   * this predicate and update only that element" — the same pattern repeats
   * in updateTokenLimit, incrementUsage, setLastInputTokens, and
   * updateRuntime below.
   */
  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { 'agents.$[agent].status': status } },
      { arrayFilters: [{ 'agent.id': agentId }] },
    );
  }

  /** Admin-facing: adjusts one agent's configured token ceiling. */
  async updateTokenLimit(
    agentId: string,
    field: 'inputTokenLimit' | 'outputTokenLimit' | 'memoryTokenLimit',
    value: number,
  ): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { [`agents.$[agent].${field}`]: value } },
      { arrayFilters: [{ 'agent.id': agentId }] },
    );
  }

  /**
   * Adds to (never replaces) the running usage counters after a request
   * completes. `$inc` is atomic at the database level, so concurrent
   * requests against the same agent can't clobber each other's counts the
   * way a read-modify-write in application code could.
   */
  async incrementUsage(
    agentId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await this.model
      .findOneAndUpdate(
        {},
        {
          $inc: {
            'agents.$[agent].inputTokensUsed': inputTokens,
            'agents.$[agent].outputTokensUsed': outputTokens,
          },
        },
        {
          arrayFilters: [{ 'agent.id': agentId }],
          new: true,
        },
      )
      .lean();
  }

  /** Records the size of the most recently completed request against this agent. */
  async setLastInputTokens(
    agentId: string,
    inputTokens: number,
  ): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { 'agents.$[agent].lastInputTokens': inputTokens } },
      { arrayFilters: [{ 'agent.id': agentId }] },
    );
  }

  /**
   * Monthly cron entry point (AgentHealthService.resetMonthlyUsage). Note the
   * unfiltered `agents.$[]` positional operator here — unlike every other
   * write in this file, this one intentionally touches EVERY agent in the
   * array at once, not a single filtered one.
   */
  async resetAllUsage(): Promise<void> {
    await this.model.updateOne(
      {},
      {
        $set: {
          'agents.$[].inputTokensUsed': 0,
          'agents.$[].outputTokensUsed': 0,
        },
      },
    );
  }

  /**
   * Applies a runtime-state change (status/cooldown/failure-reason) to one
   * agent, as a side effect of a request or health-probe outcome — distinct
   * from an admin's deliberate config edit.
   */
  async updateRuntime(
    agentId: string,
    update: AgentRuntimeUpdate,
  ): Promise<void> {
    // Callers (AgentConfigService.updateRuntime, AgentHealthService) often
    // build this object with some fields deliberately omitted rather than
    // set to a specific value — strip anything `undefined` so we don't
    // accidentally $set a field to `undefined` in the update payload.
    const normalized = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    );
    // Nothing left to write (e.g. caller passed an empty update) — skip the
    // round-trip to Mongo entirely.
    if (!Object.keys(normalized).length) return;

    // Rewrite each key as `agents.$[agent].<key>` so the positional filter
    // below applies to all of them in one update.
    const setPayload = Object.fromEntries(
      Object.entries(normalized).map(([key, value]) => [
        `agents.$[agent].${key}`,
        value,
      ]),
    );

    await this.model.updateOne(
      {},
      { $set: setPayload },
      { arrayFilters: [{ 'agent.id': agentId }] },
    );
  }
}
