import {
  Controller, Get, Post, Delete, Param, Body,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { SourcesService } from './sources.service';
import type { DataSource } from './sources-cache';

@Controller('api')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get('meta')
  getMeta() {
    return this.sources.getMeta();
  }

  @Get('sources')
  list() {
    return this.sources.list();
  }

  @Post('sources')
  async register(@Body() body: DataSource) {
    if (!body.name || !body.collection || !Array.isArray(body.fields) || !body.fields.length) {
      throw new BadRequestException('source must have name, collection, and at least one field');
    }
    if (body.collection.startsWith('$') || /^system\./i.test(body.collection)) {
      throw new BadRequestException('collection name is not allowed');
    }
    const badField = body.fields.find(f => !f.name || f.name.startsWith('$') || f.name.includes('\0'));
    if (badField) {
      throw new BadRequestException(`field name "${badField.name}" is not allowed`);
    }
    return this.sources.register(body);
  }

  @Delete('sources/:collection')
  async remove(@Param('collection') collection: string) {
    const ok = await this.sources.remove(collection);
    if (!ok) throw new NotFoundException('source not found');
    return { ok: true, loaded: this.sources.list().length };
  }
}
