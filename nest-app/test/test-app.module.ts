import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import configuration from '../src/config/configuration';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { ApiKeyGuard } from '../src/common/guards/api-key.guard';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AppLogger } from '../src/common/logger/app.logger';
import { AppController } from '../src/app.controller';
import { SourcesModule } from '../src/sources/sources.module';
import { CacheModule } from '../src/cache/cache.module';
import { SavedResultsModule } from '../src/saved-results/saved-results.module';

/**
 * e2e-only module: mirrors AppModule's cross-cutting wiring (guard, filter,
 * request-id middleware, config) plus only the feature modules that don't
 * transitively import @mastra/* (Analytics/History/UserSettings/AgentConfig
 * all do, via ai/model.ts or session/memory.ts, and pull in ESM-only
 * dependencies ts-jest can't parse — see nest-app CLAUDE notes / test log).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('mongodb.uri'),
        dbName: cfg.get<string>('mongodb.db'),
      }),
    }),
    SourcesModule,
    CacheModule,
    SavedResultsModule,
  ],
  controllers: [AppController],
  providers: [
    AppLogger,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
