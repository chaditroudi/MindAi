import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentConfig, AgentConfigSchema } from './agent-config.repository';
import { AgentConfigRepository } from './agent-config.repository';
import { AgentConfigService } from './agent-config.service';
import { AgentConfigController } from './agent-config.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentConfig.name, schema: AgentConfigSchema }]),
  ],
  controllers: [AgentConfigController],
  providers:   [AgentConfigRepository, AgentConfigService],
  exports:     [AgentConfigService],
})
export class AgentConfigModule {}
