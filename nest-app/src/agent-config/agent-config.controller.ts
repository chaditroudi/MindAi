import { Controller, Get, Put, Patch, Body } from '@nestjs/common';
import {
  IsString,
  IsInt,
  IsOptional,
  IsArray,
  IsEnum,
  IsIn,
  MinLength,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentConfigService } from './agent-config.service';
import { AgentHealthService } from './agent-health.service';

class AgentEntryDto {
  

  const AGENT_STATUS = [
    'active',
    'disabled',
    'expired',
    'idle'
  ] as const


}