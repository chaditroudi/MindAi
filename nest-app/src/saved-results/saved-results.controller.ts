import {
  Controller, Get, Post, Delete, Param, Body, Headers,
  UnauthorizedException, NotFoundException, BadRequestException, HttpCode,
} from '@nestjs/common';
import { IsString, IsOptional, MaxLength, Allow } from 'class-validator';
import { SavedResultsService } from './saved-results.service';

const INTENT_MAP: Record<string, 'dashboard' | 'report' | 'inquiry'> = {
  dashboard:        'dashboard',
  report:           'report',
  inquiry:          'inquiry',
  general_question: 'inquiry',
};

class SaveDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) prompt?: string;
  @IsString() intent!: string;
  @Allow() result: unknown;
}

function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing. Please reload the app.');
  return id;
}

@Controller('api/saved')
export class SavedResultsController {
  constructor(private readonly service: SavedResultsService) {}

  @Get()
  async list(@Headers('x-user-id') rawUserId: string) {
    const userId = requireUserId(rawUserId);
    return this.service.list(userId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    const item   = await this.service.findOne(id, userId);
    if (!item) throw new NotFoundException('Not found.');
    return item;
  }

  @Post()
  @HttpCode(201)
  async save(
    @Body() dto: SaveDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    if (dto.result === undefined || dto.result === null) {
      throw new BadRequestException('result is required');
    }
    const intent = INTENT_MAP[dto.intent] ?? 'inquiry';
    const id = await this.service.save({
      userId,
      title:  dto.title,
      prompt: dto.prompt ?? '',
      intent,
      result: dto.result,
    });
    return { ok: true, id };
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId  = requireUserId(rawUserId);
    const deleted = await this.service.remove(id, userId);
    if (!deleted) throw new NotFoundException('Not found.');
    return { ok: true };
  }
}
