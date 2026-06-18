import { Injectable, Logger } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { extractMemories } from '../ai/memory-skill';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly repo: MemoryRepository) {}

  /**
   * Returns a formatted string of relevant long-term memories for injection
   * into the supervisor's system prompt before each query.
   */
  async getRelevantContext(userId: string, prompt: string): Promise<string> {
    try {
      const memories = await this.repo.findRelevant(userId, prompt, 8);
      if (!memories.length) return '';

      return memories
        .map(m => `[${m.type.toUpperCase()}] ${m.content}`)
        .join('\n');
    } catch (err) {
      this.logger.warn(`getRelevantContext failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  }

  /**
   * Extracts structured memories from a completed conversation turn and saves
   * them to MongoDB. Called fire-and-forget after every response.
   */
  async extractAndSave(
    userId:    string,
    sessionId: string,
    prompt:    string,
    summary:   string,
    apiKey?:   string,
  ): Promise<void> {
    const extracted = await extractMemories(prompt, summary, apiKey);
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
