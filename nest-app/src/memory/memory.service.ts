import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { extractMemories } from '../ai/memory-skill';

@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger(MemoryService.name);

  private extractionEnabled: boolean = (() => {
    const v = process.env['MEMORY_EXTRACTION_ENABLED']?.toLowerCase().trim();
    return v !== 'false' && v !== '0' && v !== 'no';
  })();

  constructor(private readonly repo: MemoryRepository) {}

  async onModuleInit(): Promise<void> {
    try {
      const stored = await this.repo.getExtractionEnabled();
      if (stored !== null) this.extractionEnabled = stored;
    } catch (err) {
      this.logger.warn(
        `failed to load persisted memory toggle (using default): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getEnabled(): boolean {
    return this.extractionEnabled;
  }

  setEnabled(enabled: boolean): void {
    this.extractionEnabled = enabled;
    this.logger.log(`memory extraction ${enabled ? 'ENABLED' : 'DISABLED'}`);
    this.repo
      .setExtractionEnabled(enabled)
      .catch((err) =>
        this.logger.error(
          `failed to persist memory toggle: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  async getRelevantContext(
    userId: string,
    prompt: string,
    limit = 3,
  ): Promise<string> {
    if (!this.extractionEnabled) return '';

    try {
      const memories = await this.repo.findRelevant(userId, prompt, limit);
      if (!memories.length) return '';

      return memories
        .map((m) => `[${m.type.toUpperCase()}] ${m.content}`)
        .join('\n');
    } catch (err) {
      this.logger.warn(
        `getRelevantContext failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }

  async extractAndSave(
    userId: string,
    sessionId: string,
    prompt: string,
    summary: string,
    apiKey?: string,
    userModel?: string,
    userProvider?: string,
    maxTokens?: number,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    if (!this.extractionEnabled) {
      this.logger.debug('memory extraction skipped (disabled)');
      return { inputTokens: 0, outputTokens: 0 };
    }

    const { memories, inputTokens, outputTokens } = await extractMemories(
      prompt,
      summary,
      apiKey,
      userModel,
      userProvider,
      maxTokens,
    );
    if (memories.length) {
      await this.repo.upsert(
        memories.map((m) => ({ ...m, userId, sessionId })),
      );
      this.logger.log(
        `saved ${memories.length} memory item(s) for user ${userId}`,
      );
    }
    return { inputTokens, outputTokens };
  }

  list(userId: string) {
    return this.repo.listByUser(userId);
  }

  clear(userId: string) {
    return this.repo.deleteByUser(userId);
  }
}
