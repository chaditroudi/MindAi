import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(AppLogger));

  app.use(helmet({ contentSecurityPolicy: false }));

  const allowedOrigins = process.env['ALLOWED_ORIGINS']
    ? process.env['ALLOWED_ORIGINS'].split(',').map(o => o.trim()).filter(Boolean)
    : [];

  app.enableCors(
    allowedOrigins.length
      ? { origin: allowedOrigins, credentials: true }
      : { origin: true, credentials: true },
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3001;
  await app.listen(port);

  const logger = app.get(AppLogger);
  logger.log(`NestJS + Mongoose ready on http://localhost:${port}`, 'bootstrap');

  // AI configuration summary — surfaces missing/misconfigured AI settings at startup
  const groqKey = process.env['GROQ_API_KEY'];
  if (!groqKey?.trim()) {
    logger.warn('GROQ_API_KEY is not set — all AI requests will require a per-user key', 'AI');
  } else {
    const supervisorModel = process.env['GROQ_SUPERVISOR_MODEL'] ?? 'llama-3.3-70b-versatile';
    const chartModel      = process.env['GROQ_CHART_MODEL']      ?? 'llama-3.1-8b-instant';
    const writerModel     = process.env['GROQ_WRITER_MODEL']      ?? 'llama-3.1-8b-instant';
    logger.log(`AI ready | supervisor: ${supervisorModel} | chart: ${chartModel} | writer: ${writerModel}`, 'AI');
  }
  const memoryPath = process.env['LIBSQL_URL'] ?? 'file:./data/memory.db';
  logger.log(`Session memory: ${memoryPath}`, 'AI');
}

bootstrap().catch(err => {
  Logger.error('Failed to start:', err, 'bootstrap');
  process.exit(1);
});
