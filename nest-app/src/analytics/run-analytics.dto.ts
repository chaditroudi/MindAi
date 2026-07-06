import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Guard against empty prompts and runaway LLM input costs. */
const PROMPT_MIN_LENGTH = 1;
const PROMPT_MAX_LENGTH = 1000;

export class RunAnalyticsDto {
  @ApiProperty({
    description: 'Natural-language analytics question.',
    minLength: PROMPT_MIN_LENGTH,
    maxLength: PROMPT_MAX_LENGTH,
    example: 'Show monthly revenue by region for 2025',
  })
  @IsString()
  @MinLength(PROMPT_MIN_LENGTH)
  @MaxLength(PROMPT_MAX_LENGTH)
  prompt!: string;

  @ApiPropertyOptional({
    description:
      'Forces a rendering intent (e.g. dashboard, report). ' +
      'When omitted, the planner infers it from the prompt.',
  })
  @IsOptional()
  @IsString()
  intent?: string;

  @ApiPropertyOptional({
    description:
      'Conversation session to continue. Null / omitted starts a fresh, ' +
      'context-free (and therefore cacheable) request.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sessionId?: string | null;
}
