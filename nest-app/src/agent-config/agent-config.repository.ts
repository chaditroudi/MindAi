import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

export type AgentStatus = 'active' | 'disabled' | 'expired' | 'idle';

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

  @Prop({ min: 0, default: 0 }) inputTokensUsed!: number;
  @Prop({ min: 0, default: 0 }) outputTokensUsed!: number;

  @Prop({ min: 0, default: 0 }) lastInputTokens!: number;

  @Prop({ type: Date, default: null }) cooldownUntil?: Date | null;

  @Prop({ default: '' }) lastFailureReason?: string;
}
export const AgentEntrySchema = SchemaFactory.createForClass(AgentEntry);

@Schema({ collection: 'agent_config', timestamps: true, versionKey: false })
export class AgentConfig {

  @Prop({ min: 1, default: 50 }) memoryLimit!: number;

  @Prop({ type: String, default: null }) currentAgentId!: string | null;

  @Prop({ type: [AgentEntrySchema], default: [] })
  agents!: AgentEntry[];
}

export type AgentConfigDocument = HydratedDocument<AgentConfig>;
export const AgentConfigSchema = SchemaFactory.createForClass(AgentConfig);

export interface AgentConfigPayload {
  memoryLimit?: number;
  currentAgentId?: string | null;
  agents?: Partial<AgentEntry>[];
}

export interface AgentRuntimeUpdate {
  status?: AgentStatus;
  cooldownUntil?: Date | null;
  lastFailureReason?: string;
}

@Injectable()
export class AgentConfigRepository {
  constructor(
    @InjectModel(AgentConfig.name)
    private readonly model: Model<AgentConfigDocument>,
  ) {}

  async get(): Promise<AgentConfigDocument | null> {
    return this.model.findOne().lean();
  }

  async save(data: AgentConfigPayload): Promise<AgentConfigDocument> {
    return this.model
      .findOneAndUpdate(
        {},
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  async updateCurrentAgentId(currentAgentId: string | null): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { currentAgentId } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { 'agents.$[agent].status': status } },
      { arrayFilters: [{ 'agent.id': agentId }] },
    );
  }

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
