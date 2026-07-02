import { Controller, Get, Put, Patch, Body } from '@nestjs/common';
import {
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  IsEnum,
  IsIn,
  MinLength,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentConfigService } from './agent-config.service';
import { AgentHealthService } from './agent-health.service';

class AgentEntryDto {
  import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentConfigService } from './agent-config.service';
import { AgentHealthService } from './agent-health.service';

const AGENT_STATUSES = ['active', 'disabled', 'expired', 'idle'] as const;
type AgentStatus = (typeof AGENT_STATUSES)[number];

const TOKEN_LIMIT_FIELDS = ['input', 'output', 'memory'] as const;
type TokenLimitField = (typeof TOKEN_LIMIT_FIELDS)[number];

const TOKEN_LIMIT_FIELD_MAP = {
  input: 'inputTokenLimit',
  output: 'outputTokenLimit',
  memory: 'memoryTokenLimit',
} as const;

const MAX_TOKEN_LIMIT = 128_000;

class AgentEntryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) id?: string;

  @IsEnum(AGENT_STATUSES) status!: AgentStatus;

  @IsString() @MinLength(1) @MaxLength(100) provider!: string;
  @IsString() @MinLength(1) @MaxLength(200) model!: string;
  @IsString() @MinLength(1) @MaxLength(500) apiKey!: string;

  @IsOptional() @IsInt() @Min(1) inputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) outputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_TOKEN_LIMIT) memoryTokenLimit?: number;
  @IsOptional() @IsInt() @Min(0) inputTokensUsed?: number;
  @IsOptional() @IsInt() @Min(0) outputTokensUsed?: number;
}

class SaveAgentConfigDto {
  @IsOptional() @IsInt() @Min(1) memoryLimit?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentAgentId?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentEntryDto)
  agents?: AgentEntryDto[];
}

class UpdateTokenLimitDto {
  @IsString() @MinLength(1) @MaxLength(100) agentId!: string;

  @IsIn(TOKEN_LIMIT_FIELDS) field!: TokenLimitField;

  @IsInt() @Min(1) @Max(MAX_TOKEN_LIMIT) value!: number;
}

@Controller('api/agent-config')
export class AgentConfigController {
  constructor(
    private readonly service: AgentConfigService,
    private readonly health: AgentHealthService,
  ) {}

  @Get()
  get() {
    return this.service.getConfig();
  }

  @Put()
  async save(@Body() dto: SaveAgentConfigDto) {
    await this.service.save(dto);
    await this.health.checkAllAgents();
    return this.service.getConfig();
  }

  @Patch('token-limit')
  async updateTokenLimit(@Body() dto: UpdateTokenLimitDto) {
    await this.service.updateTokenLimit(
      dto.agentId,
      TOKEN_LIMIT_FIELD_MAP[dto.field],
      dto.value,
    );
    return { ok: true };
  }
}