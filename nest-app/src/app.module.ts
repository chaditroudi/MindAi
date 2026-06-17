import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
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
import { AnalyticsModule } from './analytics/analytics.module';

const angularDist = path.join(__dirname, '..', '..', 'client', 'dist', 'mind-ui', 'browser');
const angularBuilt = existsSync(path.join(angularDist, 'index.html'));

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    SourcesModule,
    HistoryModule,
    CacheModule,
    SavedResultsModule,
    UserKeysModule,
    AnalyticsModule,
    ...(angularBuilt
      ? [ServeStaticModule.forRoot({
          rootPath: angularDist,
          exclude:  ['/api*', '/health'],
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
