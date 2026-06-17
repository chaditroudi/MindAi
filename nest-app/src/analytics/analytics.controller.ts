import {
  Controller, Post, Get, Body, Headers,
  UnauthorizedException, BadRequestException, HttpException, HttpStatus,
} from '@nestjs/common';
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
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('provider')
  getProvider() {
    return { provider: 'groq' };
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
      throw new HttpException({ error: msg }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
