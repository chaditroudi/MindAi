import { Controller, Get, Post, Delete, Param, Body, NotFoundException } from '@nestjs/common';
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
  MinLength,
  MaxLength,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import type { DataSource } from './sources-cache';

const FIELD_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'enum',
  'reference',
  'array',
  'object',
  'geo',
  'text',
] as const;

const FIELD_ROLES = ['dimension', 'measure', 'temporal', 'id', 'text'] as const;
const CHART_AGGS = ['sum', 'avg', 'count', 'min', 'max'] as const;

class DataSourceFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(200) label?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;

  @IsIn(FIELD_TYPES)
  type!: (typeof FIELD_TYPES)[number];

  @IsOptional() @IsIn(FIELD_ROLES) role?: (typeof FIELD_ROLES)[number];

  @IsOptional() @IsArray() @IsString({ each: true }) enumValues?: string[];
  @IsOptional() @IsString() @MaxLength(200) referenceTo?: string;
  @IsOptional() @IsArray() sampleValues?: unknown[];
  @IsOptional() @IsBoolean() searchable?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

class DataSourceJoinDto {
  @IsString() @MinLength(1) @MaxLength(200) from!: string;
  @IsString() @MinLength(1) @MaxLength(200) localField!: string;
  @IsString() @MinLength(1) @MaxLength(200) foreignField!: string;
  @IsString() @MinLength(1) @MaxLength(200) as!: string;
}

class SuggestedChartDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsString() @MinLength(1) @MaxLength(100) chartType!: string;
  @IsOptional() @IsString() labelField?: string;
  @IsOptional() @IsString() valueField?: string;
  @IsOptional() @IsString() xField?: string;
  @IsOptional() @IsString() yField?: string;
  @IsOptional() @IsString() seriesField?: string;
  @IsOptional() @IsIn(CHART_AGGS) agg?: (typeof CHART_AGGS)[number];
  @IsOptional() @IsArray() pipeline?: Record<string, unknown>[];
}

class RegisterSourceDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;

  // MongoDB reserves "$"-prefixed and "system.*" collection names.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  collection!: string;

  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DataSourceFieldDto)
  fields!: DataSourceFieldDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DataSourceJoinDto)
  joins?: DataSourceJoinDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestedChartDto)
  suggestedCharts?: SuggestedChartDto[];
}

function assertSafeNames(source: RegisterSourceDto): void {
  if (
    source.collection.startsWith('$') ||
    /^system\./i.test(source.collection)
  ) {
    throw new NotFoundException('collection name is not allowed');
  }
  const badField = source.fields.find(
    (f) => f.name.startsWith('$') || f.name.includes('\0'),
  );
  if (badField) {
    throw new NotFoundException(`field name "${badField.name}" is not allowed`);
  }
}

@ApiTags('sources')
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
  async register(@Body() body: RegisterSourceDto) {
    assertSafeNames(body);
    return this.sources.register(body as DataSource);
  }

  @Delete('sources/:collection')
  async remove(@Param('collection') collection: string) {
    const ok = await this.sources.remove(collection);
    if (!ok) throw new NotFoundException('source not found');
    return { ok: true, loaded: this.sources.list().length };
  }
}
