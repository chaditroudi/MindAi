import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { requireUserId } from '../common/helpers/user-id';

class AnalyticsDto {
  @IsString() @MinLength(1) @MaxLength(1000) prompt!: string;
  @IsOptional() @IsString() intent?: string;
  @IsOptional() @IsString() sessionId?: string | null;
}

@ApiTags('analytics')
@Controller('api')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analytics: AnalyticsService) {}

  @ApiOperation({
    summary: 'Static provider placeholder (kept for frontend compatibility)',
  })
  @Get('provider')
  getProvider() {
    return { provider: '', hasGlobalKey: false };
  }

  @ApiOperation({
    summary: 'Run a natural-language analytics prompt',
    description:
      'Plans a MongoDB aggregation, executes it against a registered data source, ' +
      'and formats the result as a dashboard, report, or inquiry answer depending on intent.',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: true,
    description:
      'Caller identity used to scope settings, memory, and saved results. Not authenticated — see README §15.',
  })
  @Post('analytics')
  async runAnalytics(
    @Body() dto: AnalyticsDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);

    try {
      return await this.analytics.run({
        prompt: dto.prompt,
        intent: dto.intent,
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
