import { Injectable, Logger } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { extractMemories } from '../ai/memory-skill';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  // ── Toggle state ─────────────────────────────────────────────────────────
  // Controls whether memory extraction (LLM Call #3) runs after each response.
  // Disabling saves tokens — no Groq API call is made for memory after responses.
  //
  // Reads MEMORY_EXTRACTION_ENABLED env var at startup (defaults to true).
  // Can be flipped at runtime via PATCH /api/memory/config without restarting.
  private extractionEnabled: boolean =
    process.env['MEMORY_EXTRACTION_ENABLED']?.toLowerCase() !== 'false';

  constructor(private readonly repo: MemoryRepository) {}

  // ── getEnabled() ─────────────────────────────────────────────────────────
  // Returns the current toggle state. Used by the controller for GET /api/memory/config.
  getEnabled(): boolean {
    return this.extractionEnabled;
  }

  // ── setEnabled() ─────────────────────────────────────────────────────────
  // Flips the toggle at runtime. No restart needed.
  // When disabled: extractAndSave() returns immediately without calling the LLM.
  setEnabled(enabled: boolean): void {
    this.extractionEnabled = enabled;
    this.logger.log(`memory extraction ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  // ── getRelevantContext() ──────────────────────────────────────────────────
  // Returns a formatted string of relevant long-term memories for injection
  // into the supervisor's system prompt before each query.
  // NOTE: this reads existing memories — it is NOT affected by the toggle.
  // The toggle only controls whether NEW memories are extracted and saved.
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

  // ── extractAndSave() ─────────────────────────────────────────────────────
  // Extracts structured memories from a completed conversation turn and saves
  // them to MongoDB. Called fire-and-forget after every response.
  //
  // SKIPPED entirely when extractionEnabled = false — zero tokens consumed.
  async extractAndSave(
    userId:    string,
    sessionId: string,
    prompt:    string,
    summary:   string,
    apiKey?:   string,
  ): Promise<void> {
    // Guard: if the toggle is off, skip the LLM call completely
    if (!this.extractionEnabled) {
      this.logger.debug('memory extraction skipped (disabled)');
      return;
    }

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
