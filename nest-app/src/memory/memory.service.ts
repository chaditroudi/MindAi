import { Injectable, Logger } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { extractMemories } from '../ai/memory-skill';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  // Defaults to true; set MEMORY_EXTRACTION_ENABLED=false to disable at startup.
  private extractionEnabled: boolean = (() => {
    const v = process.env['MEMORY_EXTRACTION_ENABLED']?.toLowerCase().trim();
    return v !== 'false' && v !== '0' && v !== 'no';
  })();

  constructor(private readonly repo: MemoryRepository) {}

  getEnabled(): boolean {
    return this.extractionEnabled;
  }

  setEnabled(enabled: boolean): void {
    this.extractionEnabled = enabled;
    this.logger.log(`memory extraction ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  async getRelevantContext(
    userId: string,
    prompt: string,
    limit = 3,
  ): Promise<string> {
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
