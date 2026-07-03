import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentConfig, AgentConfigSchema } from './agent-config.repository';
import { AgentConfigRepository } from './agent-config.repository';
import { AgentConfigService } from './agent-config.service';
import { AgentConfigController } from './agent-config.controller';
import { AgentHealthService } from './agent-health.service';

/**
 * AgentConfigModule
 * -----------------
 * Owns the "pooled agents" feature: a shared, admin-managed list of fallback
 * LLM provider connections that requests fall back to when a user hasn't
 * configured their own personal API key (see UserSettingsModule for that).
 *
 * Wiring notes:
 * - `MongooseModule.forFeature(...)` registers just the AgentConfig schema
 *   against the single Mongo connection that AppModule already opened via
 *   `forRootAsync` — this module doesn't open its own connection.
 * - `AgentHealthService` (the @Cron jobs in agent-health.service.ts) is a
 *   provider here, so ScheduleModule.forRoot() in AppModule can find and
 *   schedule its @Cron-decorated methods automatically — nothing calls it
 *   directly except AgentConfigController (same module, see below) and Nest's
 *   own scheduler.
 * - `exports: [AgentConfigService]` is deliberately narrow: only the service
 *   is visible to other modules (e.g. AnalyticsModule injects it into
 *   AnalyticsService to resolve which LLM connection to use). The repository
 *   and the health-check service stay private to this module — nothing
 *   outside agent-config/ should touch the database directly or trigger a
 *   health probe on its own.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentConfig.name, schema: AgentConfigSchema },
    ]),
  ],
  controllers: [AgentConfigController],
  providers: [AgentConfigRepository, AgentConfigService, AgentHealthService],
  exports: [AgentConfigService],
})
export class AgentConfigModule {}
