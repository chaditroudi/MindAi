import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useLogger(app.get(AppLogger));

  app.use(helmet({ contentSecurityPolicy: false }));

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
