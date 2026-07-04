import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app.logger';

function setupSwagger(app: import('@nestjs/common').INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MindAi API')
    .setDescription(
      'Natural-language analytics API — turns a prompt into a dashboard, report, ' +
        'or inquiry answer over registered MongoDB data sources. ' +
        'See README.md for the full architecture and worked examples.',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-api-key' },
      'apiKey',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-user-id' },
      'userId',
    )
    .addTag('analytics', 'Main AI query endpoint')
    .addTag('sources', 'Registered dataset schemas')
    .addTag('history', 'Past pipeline runs and conversation sessions')
    .addTag('cache', 'Prompt-result cache')
    .addTag('saved-results', 'User-pinned dashboards/reports/inquiries')
    .addTag('settings', 'Per-user AI connection settings')
    .addTag('memory', 'Long-term memory')
    .addTag('agent-config', 'Shared fallback AI connection pool')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useLogger(app.get(AppLogger));

  app.use(helmet({ contentSecurityPolicy: false }));

  if (process.env['DISABLE_SWAGGER'] !== 'true') {
    setupSwagger(app);
  }

  const allowedOrigins = process.env['ALLOWED_ORIGINS']
    ? process.env['ALLOWED_ORIGINS']
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  app.enableCors(
    allowedOrigins.length
      ? { origin: allowedOrigins, credentials: true }
      : { origin: true, credentials: true },
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);

  const logger = app.get(AppLogger);
  logger.log(
    `NestJS + Mongoose ready on http://localhost:${port}`,
    'bootstrap',
  );

  const memoryPath = process.env['LIBSQL_URL'] ?? 'file:./data/memory.db';
  logger.log(`Session memory: ${memoryPath}`, 'AI');
}

bootstrap().catch((err) => {
  Logger.error('Failed to start:', err, 'bootstrap');
  process.exit(1);
});
