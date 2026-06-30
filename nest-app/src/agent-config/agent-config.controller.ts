import { Controller, Get, Put, Body } from '@nestjs/common';
import { IsString, IsInt, IsOptional, IsArray, IsEnum, MinLength, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentConfigService } from './agent-config.service';
import { AgentHealthService } from './agent-health.service';

class AgentEntryDto {
  @IsEnum(['active', 'disabled', 'expired', 'idle'])
  status!: 'active' | 'disabled' | 'expired' | 'idle';

  @IsString() @MinLength(1) @MaxLength(100)
  provider!: string;

  @IsString() @MinLength(1) @MaxLength(200) model!:   string;
  @IsString() @MinLength(1) @MaxLength(500) apiKey!:  string;

  @IsOptional() @IsInt() @Min(1) inputTokenLimit?:  number;
  @IsOptional() @IsInt() @Min(1) outputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(0) inputTokensUsed?:  number;
  @IsOptional() @IsInt() @Min(0) outputTokensUsed?: number;
}

class SaveAgentConfigDto {
  @IsOptional() @IsInt() @Min(1) memoryLimit?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AgentEntryDto)
  agents?: AgentEntryDto[];
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
    const saved = await this.service.save(dto);
    await Promise.allSettled(
      saved.agents
        .filter(agent => agent.status !== 'disabled' && !!agent.apiKey)
        .map(agent => this.health.probeAndUpdateAgent(agent.apiKey)),
    );
    return this.service.getConfig();
  }
}
