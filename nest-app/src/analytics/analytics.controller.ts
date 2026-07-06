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
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { requireUserId } from '../common/helpers/user-id';
import { RunAnalyticsDto } from './run-analytics.dto';

@ApiTags('analytics')
@Controller('api')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Legacy endpoint retained so older frontend builds don't 404.
   * Provider selection now happens per-user server-side; this always
   * reports "no global provider configured".
   */
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
    @Body() dto: RunAnalyticsDto,
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
      // Intentional HTTP errors (4xx from deeper layers) pass through as-is.
      if (err instanceof HttpException) throw err;

      
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(msg, err instanceof Error ? err.stack : undefined);
      throw new HttpException({ error: msg }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}