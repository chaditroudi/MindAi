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

  // How many input tokens this agent accepts per request (based on model context window)
  @Prop({ min: 1, default: 4_000 }) inputTokenLimit!: number;

  // Total lifetime token budget for this agent (0 = unlimited)
  @Prop({ min: 0, default: 0 }) tokenBudget!: number;

  // Accumulated tokens used across all requests
  @Prop({ min: 0, default: 0 }) tokensUsed!: number;
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

  async incrementTokensUsed(agentApiKey: string, tokens: number): Promise<void> {
    const doc = await this.model.findOneAndUpdate(
      { 'agents.apiKey': agentApiKey },
      { $inc: { 'agents.$.tokensUsed': tokens } },
      { new: true },
    ).lean() as AgentConfigDocument | null;

    if (!doc) return;

    const agent = doc.agents.find(a => a.apiKey === agentApiKey);
    if (agent && agent.tokenBudget > 0 && agent.tokensUsed >= agent.tokenBudget) {
      await this.model.updateOne(
        { 'agents.apiKey': agentApiKey },
        { $set: { 'agents.$.status': 'expired' } },
      );
    }
  }
}
