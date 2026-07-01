import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';


export type AgentStatus = 'active' | 'disabled' | 'expired' | 'idle';

@Schema({ _id: false })
export class AgentEntry {
  @Prop({ enum: ['active', 'disabled', 'expired', 'idle'], default: 'idle' })
  status!: AgentStatus;

  @Prop({ required: true }) provider!: string;
  @Prop({ required: true }) model!:    string;
  @Prop({ required: true }) apiKey!:   string;

  @Prop({ min: 1, default: 8_000  }) inputTokenLimit!:  number;
  @Prop({ min: 1, default: 8_000  }) outputTokenLimit!: number;
  @Prop({ min: 1, default: 4_000  }) memoryTokenLimit!: number;

  @Prop({ min: 0, default: 0 }) inputTokensUsed!:  number;
  @Prop({ min: 0, default: 0 }) outputTokensUsed!: number;

  @Prop({ min: 0, default: 0 }) lastInputTokens!: number;

  @Prop({ type: Date, default: null }) cooldownUntil?: Date | null;
  @Prop({ default: '' }) lastFailureReason?: string;
}
export const AgentEntrySchema = SchemaFactory.createForClass(AgentEntry);


@Schema({ collection: 'agent_config', timestamps: true, versionKey: false })
export class AgentConfig {
  @Prop({ min: 1, default: 50 }) memoryLimit!: number;

  @Prop({ type: [AgentEntrySchema], default: [] })
  agents!: AgentEntry[];
}

export type AgentConfigDocument = HydratedDocument<AgentConfig>;
export const AgentConfigSchema  = SchemaFactory.createForClass(AgentConfig);


export interface AgentConfigPayload {
  memoryLimit?: number;
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

  async updateTokenLimit(
    agentApiKey: string,
    field: 'inputTokenLimit' | 'outputTokenLimit' | 'memoryTokenLimit',
    value: number,
  ): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { [`agents.$[agent].${field}`]: value } },
      { arrayFilters: [{ 'agent.apiKey': agentApiKey }] },
    );
  }

  async incrementUsage(agentApiKey: string, inputTokens: number, outputTokens: number): Promise<void> {
    await this.model.findOneAndUpdate(
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
    ).lean();
  }

  async setLastInputTokens(agentApiKey: string, inputTokens: number): Promise<void> {
    await this.model.updateOne(
      {},
      { $set: { 'agents.$[agent].lastInputTokens': inputTokens } },
      { arrayFilters: [{ 'agent.apiKey': agentApiKey }] },
    );
  }

  async updateRuntime(agentApiKey: string, update: AgentRuntimeUpdate): Promise<void> {
    const normalized = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    );
    if (!Object.keys(normalized).length) return;

    const setPayload = Object.fromEntries(
      Object.entries(normalized).map(([key, value]) => [`agents.$[agent].${key}`, value]),
    );

    await this.model.updateOne(
      {},
      { $set: setPayload },
      { arrayFilters: [{ 'agent.apiKey': agentApiKey }] },
    );
  }
}
