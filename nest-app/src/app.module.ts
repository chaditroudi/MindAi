import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppLogger } from './common/logger/app.logger';
import { AppController } from './app.controller';
import { SourcesModule } from './sources/sources.module';
import { HistoryModule } from './history/history.module';
import { CacheModule } from './cache/cache.module';
import { SavedResultsModule } from './saved-results/saved-results.module';
import { UserKeysModule } from './user-keys/user-keys.module';
import { UserSettingsModule } from './user-settings/user-settings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AgentConfigModule } from './agent-config/agent-config.module';

const angularDist = path.join(__dirname, '..', '..', 'client', 'dist', 'mind-ui', 'browser');
const angularBuilt = existsSync(path.join(angularDist, 'index.html'));

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const uri = cfg.get<string>('mongodb.uri');
        if (!uri) throw new Error('MONGODB_URI environment variable is required');
        return {
          uri,
          dbName:                    cfg.get<string>('mongodb.db'),
          serverSelectionTimeoutMS:  cfg.get<number>('mongodb.serverSelectionTimeoutMs') ?? 8_000,
        };
      },
    }),
    SourcesModule,
    HistoryModule,
    CacheModule,
    SavedResultsModule,
    UserKeysModule,
    UserSettingsModule,
    AnalyticsModule,
    AgentConfigModule,
    ...(angularBuilt
      ? [ServeStaticModule.forRoot({
          rootPath: angularDist,
          renderPath: /^(?!\/(?:api(?:\/|$)|health$)).*/,
        })]
      : []),
  ],
  controllers: [AppController],
  providers: [
    AppLogger,
    { provide: APP_GUARD,  useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
