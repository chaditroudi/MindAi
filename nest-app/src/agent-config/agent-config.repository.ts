import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

// ── Agent entry sub-schema ─────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'disabled' | 'expired' | 'idle';

@Schema({ _id: false })
export class AgentEntry {
  @Prop({ enum: ['active', 'disabled', 'expired', 'idle'], default: 'idle' })
  status!: AgentStatus;

  @Prop({ required: true }) provider!: string;
  @Prop({ required: true }) model!:    string;
  @Prop({ required: true }) apiKey!:   string;

  // Per-request limits (like ChatGPT context window + response cap)
  @Prop({ min: 1, default: 4_000  }) inputTokenLimit!:  number;
  @Prop({ min: 1, default: 2_000  }) outputTokenLimit!: number;

  // Credit balance — total tokens this agent is allowed to consume (0 = unlimited)
  @Prop({ min: 0, default: 0 }) tokenBudget!: number;

  // Accumulated usage tracked after every request
  @Prop({ min: 0, default: 0 }) inputTokensUsed!:  number;
  @Prop({ min: 0, default: 0 }) outputTokensUsed!: number;
}
export const AgentEntrySchema = SchemaFactory.createForClass(AgentEntry);

// ── Root config schema ─────────────────────────────────────────────────────────

@Schema({ collection: 'agent_config', timestamps: true, versionKey: false })
export class AgentConfig {
  @Prop({ min: 1, default: 50 }) memoryLimit!: number;

  @Prop({ type: [AgentEntrySchema], default: [] })
  agents!: AgentEntry[];
}

export type AgentConfigDocument = HydratedDocument<AgentConfig>;
export const AgentConfigSchema  = SchemaFactory.createForClass(AgentConfig);

// ── Repository ─────────────────────────────────────────────────────────────────

export interface AgentConfigPayload {
  memoryLimit?: number;
  agents?:      Partial<AgentEntry>[];
}

@Injectable()
export class AgentConfigRepository {
  constructor(
    @InjectModel(AgentConfig.name)
    private readonly model: Model<AgentConfigDocument>,
  ) {}

  async get(): Promise<AgentConfigDocument | null> {
    return this.model.findOne().lean() as Promise<AgentConfigDocument | null>;
  }

  async save(data: AgentConfigPayload): Promise<AgentConfigDocument> {
    return this.model.findOneAndUpdate(
      {},
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean() as Promise<AgentConfigDocument>;
  }

  async updateAgentStatus(agentApiKey: string, status: AgentStatus): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { 'agents.$[agent].status': status } },
      { arrayFilters: [{ 'agent.apiKey': agentApiKey }] },
    );
  }

  async incrementUsage(agentApiKey: string, inputTokens: number, outputTokens: number): Promise<void> {
    // Atomically increment both counters for the matching agent
    const doc = await this.model.findOneAndUpdate(
      {},
      {
        $inc: {
          'agents.$[agent].inputTokensUsed':  inputTokens,
          'agents.$[agent].outputTokensUsed': outputTokens,
        },
      },
      {
        arrayFilters: [{ 'agent.apiKey': agentApiKey }],
        new: true,
      },
    ).lean() as AgentConfigDocument | null;

    if (!doc) return;

    // Auto-expire the agent if it has exceeded its budget
    const agent = doc.agents.find(a => a.apiKey === agentApiKey);
    if (agent && agent.tokenBudget > 0) {
      const totalUsed = agent.inputTokensUsed + agent.outputTokensUsed;
      if (totalUsed >= agent.tokenBudget) {
        await this.model.updateOne(
          {},
          { $set: { 'agents.$[agent].status': 'expired' } },
          { arrayFilters: [{ 'agent.apiKey': agentApiKey }] },
        );
      }
    }
  }
}
