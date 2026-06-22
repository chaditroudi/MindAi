import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app.logger';
import { warmupEmbeddings } from './ai/embeddings';

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

  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  await app.listen(port);

  const logger = app.get(AppLogger);
  logger.log(`NestJS + Mongoose ready on http://localhost:${port}`, 'bootstrap');

  const groqKey   = process.env['GROQ_API_KEY']?.trim();
  const openaiKey = process.env['OPENAI_API_KEY']?.trim();
  if (!groqKey && !openaiKey) {
    logger.warn('No global AI key set (GROQ_API_KEY / OPENAI_API_KEY) — all requests will require a per-user key', 'AI');
  } else {
    const provider        = openaiKey && !groqKey ? 'OpenAI' : 'Groq';
    const supervisorModel = process.env['GROQ_SUPERVISOR_MODEL'] ?? (openaiKey && !groqKey ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile');
    const chartModel      = process.env['GROQ_CHART_MODEL']      ?? supervisorModel;
    const writerModel     = process.env['GROQ_WRITER_MODEL']      ?? supervisorModel;
    logger.log(`AI ready [${provider}] | supervisor: ${supervisorModel} | chart: ${chartModel} | writer: ${writerModel}`, 'AI');
  }
  const memoryPath = process.env['LIBSQL_URL'] ?? 'file:./data/memory.db';
  logger.log(`Session memory: ${memoryPath}`, 'AI');

  // Warm up local embedding model in background (downloads ~25MB on first run)
  warmupEmbeddings();
}

bootstrap().catch(err => {
  Logger.error('Failed to start:', err, 'bootstrap');
  process.exit(1);
});
