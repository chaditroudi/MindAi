import {
  Controller, Get, Post, Delete, Param, Body, Headers,
  UnauthorizedException, NotFoundException, BadRequestException, HttpCode,
} from '@nestjs/common';
import { IsString, IsIn, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { SavedResultsService } from './saved-results.service';

class SaveDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) prompt!: string;
  @IsIn(['dashboard', 'report', 'inquiry']) intent!: 'dashboard' | 'report' | 'inquiry';
  result: unknown;
}

function requireUserId(raw: string | undefined): string {
  const id = raw?.trim();
  if (!id) throw new UnauthorizedException('User ID missing. Please reload the app.');
  return id;
}

@Controller('api/saved')
export class SavedResultsController {
  constructor(private readonly service: SavedResultsService) {}

  // Phase 1 — read routes
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

  // Phase 2 — write routes (included here so the module is complete)
  @Post()
  @HttpCode(201)
  async save(
    @Body() dto: SaveDto,
    @Headers('x-user-id') rawUserId: string,
  ) {
    const userId = requireUserId(rawUserId);
    if (dto.result === undefined) throw new BadRequestException('result is required');
    const id = await this.service.save({ userId, ...dto });
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
