import {
  Controller, Post, Get, Body, Headers,
  UnauthorizedException, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { AnalyticsService } from './analytics.service';

class AnalyticsDto {
  @IsString() @MinLength(1) @MaxLength(1000) prompt!: string;
  @IsOptional() @IsString() intent?: string;
  @IsOptional() @IsString() sessionId?: string | null;
}

function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing. Please reload the app.');
  return id;
}

@Controller('api')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly cfg: ConfigService,
  ) {}

  @Get('provider')
  getProvider() {
    const groqKey   = this.cfg.get<string>('llm.groqApiKey')?.trim();
    const openaiKey = this.cfg.get<string>('llm.openaiApiKey')?.trim();
    const hasGlobalKey = !!(groqKey || openaiKey);
    const provider = openaiKey && !groqKey ? 'openai' : 'groq';
    return { provider, hasGlobalKey };
  }

  @Post('analytics')
  async runAnalytics(
    @Body() dto: AnalyticsDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);

    try {
      return await this.analytics.run({
        prompt:    dto.prompt,
        intent:    dto.intent,
        sessionId: dto.sessionId,
        userId,
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(msg, err instanceof Error ? err.stack : undefined);
      throw new HttpException({ error: msg }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
