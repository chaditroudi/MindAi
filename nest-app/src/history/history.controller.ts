import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Headers,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HistoryService } from './history.service';
import { requireUserId } from '../common/helpers/user-id';

@ApiTags('history')
@Controller('api/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('results')
  async listResults(
    @Query('intent') intent?: string,
    @Query('skip') rawSkip?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const skip = Math.max(0, Number(rawSkip) || 0);
    const limit = Math.min(Number(rawLimit) || 20, 100);
    return this.history.listResults({ intent, skip, limit });
  }

  @Get('results/:id')
  async getResult(@Param('id') id: string) {
    const doc = await this.history.findResultById(id);
    if (!doc) throw new NotFoundException('not found');
    return doc;
  }

  @Get('sessions')
  listSessions(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    return this.history.listSessions(userId);
  }

  @Get('sessions/:sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    const detail = await this.history.getSessionDetail(sessionId, userId);
    if (!detail) throw new NotFoundException('session not found');
    return detail;
  }

  @Delete('sessions/:sessionId')
  async deleteSession(
    @Param('sessionId') sessionId: string,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    const ok = await this.history.deleteSession(sessionId, userId);
    if (!ok) throw new NotFoundException('session not found');
    return { ok: true };
  }
}
