import {
  Controller, Get, Post, Delete, Param, Body, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { UserKeysService } from './user-keys.service';

class SaveKeyDto {
  @IsString() @MinLength(1) @MaxLength(200) userId!: string;
  @IsString() @MinLength(1) @MaxLength(300) apiKey!: string;
}

@Controller('api')
export class UserKeysController {
  constructor(private readonly service: UserKeysService) {}

  @Get('key/:userId')
  async get(@Param('userId') userId: string) {
    const apiKey = await this.service.get(userId);
    if (!apiKey) throw new NotFoundException('No API key found for this user.');
    return { ok: true, hasKey: true };
  }

  @Post('key')
  async save(@Body() dto: SaveKeyDto) {
    if (!dto.userId || !dto.apiKey) throw new BadRequestException('userId and apiKey are required');
    await this.service.save(dto.userId, dto.apiKey);
    return { ok: true };
  }

  @Delete('key/:userId')
  async remove(@Param('userId') userId: string) {
    await this.service.delete(userId);
    return { ok: true };
  }
}
