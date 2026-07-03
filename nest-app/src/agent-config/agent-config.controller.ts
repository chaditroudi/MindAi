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
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentConfigService } from './agent-config.service';
import { AgentHealthService } from './agent-health.service';

/**
 * One pooled agent as submitted by the admin config UI. Validated by the
 * global ValidationPipe (main.ts) before the controller method body ever
 * runs — anything that fails these decorators never reaches `save()` below.
 */
class AgentEntryDto {
  // `id` is optional (a brand-new agent has none yet), but if it IS present
  // it must be a non-empty string within these length bounds. @ValidateIf
  // is what makes the length checks conditional on the field actually being
  // sent — without it, @MinLength(1) would reject an omitted id outright.
  @ValidateIf((o: AgentEntryDto) => o.id !== undefined && o.id !== '')
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

  // Token-limit and usage-counter fields are all optional here — the service
  // layer (agent-config.service.ts's sanitizeAgentEntry) treats an omitted
  // field as "don't change this," not "reset to zero/default."
  @IsOptional() @IsInt() @Min(1) inputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) outputTokenLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(128_000) memoryTokenLimit?: number;
  @IsOptional() @IsInt() @Min(0) inputTokensUsed?: number;
  @IsOptional() @IsInt() @Min(0) outputTokensUsed?: number;
}

/** Body shape for PUT /api/agent-config — a full or partial config edit. */
class SaveAgentConfigDto {
  @IsOptional() @IsInt() @Min(1) memoryLimit?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) currentAgentId?:
    | string
    | null;

  // @ValidateNested + @Type(() => AgentEntryDto) is what makes class-validator
  // actually recurse into each array element and apply AgentEntryDto's own
  // decorators, instead of just checking that `agents` is an array of
  // unvalidated objects.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentEntryDto)
  agents?: AgentEntryDto[];
}

/** Body shape for PATCH /api/agent-config/token-limit. */
class UpdateTokenLimitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  agentId!: string;

  // Deliberately a short, UI-friendly enum ('input'/'output'/'memory')
  // rather than the actual schema field names — mapped to the real
  // AgentEntry field name below before being passed to the service.
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

  /** Returns the current resolved pooled-agent config (self-healed on read — see AgentConfigService.getConfig). */
  @Get()
  async get() {
    return this.service.getConfig();
  }

  /**
   * Saves an admin edit, then immediately triggers a full live health check
   * of every configured agent before responding. This means the response
   * time for this endpoint includes a real network round-trip to every
   * provider (sequentially, up to PROBE_TIMEOUT_MS each — see
   * AgentHealthService.checkAllAgents) — with several agents configured,
   * this request can take several seconds to complete, not just however
   * long the database write takes.
   */
  @Put()
  async save(@Body() dto: SaveAgentConfigDto) {
    await this.service.save(dto);
    await this.health.checkAllAgents();
    return this.service.getConfig();
  }

  /** Adjusts one agent's configured token ceiling without touching anything else. */
  @Patch('token-limit')
  async updateTokenLimit(@Body() dto: UpdateTokenLimitDto) {
    // Translate the UI-friendly 'input'/'output'/'memory' enum into the real
    // AgentEntry field name the service/repository expect.
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
