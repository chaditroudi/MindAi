import {
  Controller, Post, Delete, Param, Body, BadRequestException,
} from '@nestjs/common';
import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';
import { UserKeysService } from './user-keys.service';

class SaveKeyDto {
  @IsUUID() userId!: string;
  @IsString() @MinLength(1) @MaxLength(300) apiKey!: string;
}

@Controller('api')
export class UserKeysController {
  constructor(private readonly service: UserKeysService) {}

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
