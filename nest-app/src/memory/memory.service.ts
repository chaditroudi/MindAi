import { Injectable, Logger } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { extractMemories } from '../ai/memory-skill';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  // Defaults to true; set MEMORY_EXTRACTION_ENABLED=false to disable at startup.
  private extractionEnabled: boolean =
    process.env['MEMORY_EXTRACTION_ENABLED']?.toLowerCase() !== 'false';

  constructor(private readonly repo: MemoryRepository) {}

  getEnabled(): boolean {
    return this.extractionEnabled;
  }

  setEnabled(enabled: boolean): void {
    this.extractionEnabled = enabled;
    this.logger.log(`memory extraction ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  async getRelevantContext(userId: string, prompt: string): Promise<string> {
    try {
      const memories = await this.repo.findRelevant(userId, prompt, 3);
      if (!memories.length) return '';

      return memories
        .map(m => `[${m.type.toUpperCase()}] ${m.content}`)
        .join('\n');
    } catch (err) {
      this.logger.warn(`getRelevantContext failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  async extractAndSave(
    userId:     string,
    sessionId:  string,
    prompt:     string,
    summary:    string,
    apiKey?:    string,
    userModel?: string,
  ): Promise<void> {
    if (!this.extractionEnabled) {
      this.logger.debug('memory extraction skipped (disabled)');
      return;
    }

    const extracted = await extractMemories(prompt, summary, apiKey, userModel);
    if (!extracted.length) return;

    await this.repo.upsert(
      extracted.map(m => ({ ...m, userId, sessionId })),
    );
    this.logger.log(`saved ${extracted.length} memory item(s) for user ${userId}`);
  }

  list(userId: string) {
    return this.repo.listByUser(userId);
  }

  clear(userId: string) {
    return this.repo.deleteByUser(userId);
  }
}
