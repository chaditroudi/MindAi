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
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id?: string;

  @IsEnum(['active', 'disabled', 'expired', 'idle'])
  status!: 'active' | 'disabled' | 'expired' | 'idle';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  provider!: string;

  @IsString() @MinLength(1) @MaxLength(200) model!: string;
  @IsString() @MinLength(1) @MaxLength(500) apiKey!: string;

  @IsOptional() @IsInt() @Min(1) inputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) outputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(128_000) memoryTokenLimit?: number;
  @IsOptional() @IsInt() @Min(0) inputTokensUsed?: number;
  @IsOptional() @IsInt() @Min(0) outputTokensUsed?: number;
}

class SaveAgentConfigDto {
  @IsOptional() @IsInt() @Min(1) memoryLimit?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) currentAgentId?:
    | string
    | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentEntryDto)
  agents?: AgentEntryDto[];
}

class UpdateTokenLimitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  agentId!: string;

  @IsIn(['input', 'output', 'memory'])
  field!: 'input' | 'output' | 'memory';

  @IsInt()
  @Min(1)
  @Max(128_000)
  value!: number;
}

@Controller('api/agent-config')
export class AgentConfigController {
  constructor(
    private readonly service: AgentConfigService,
    private readonly health: AgentHealthService,
  ) {}

  @Get()
  async get() {
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
    const field =
      dto.field === 'input'
        ? 'inputTokenLimit'
        : dto.field === 'output'
          ? 'outputTokenLimit'
          : 'memoryTokenLimit';
    await this.service.updateTokenLimit(dto.agentId, field, dto.value);
    return { ok: true };
  }
}
