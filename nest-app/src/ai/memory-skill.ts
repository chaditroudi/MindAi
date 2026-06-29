import { z } from 'zod';
import { createSkillAgent, freshSignal, skillProviderOptions } from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log } from '../common/logger/app.logger';
import type { MemoryType } from '../memory/memory.repository';

const SKILL_PROMPT = readMarkdownSection(skillFile('memory', 'SKILL.md'), 'Runtime Prompt');
const MAX_TOKENS   = Number(process.env['MEMORY_MAX_TOKENS'] ?? 400);

export interface ExtractedMemory {
  type:       MemoryType;
  content:    string;
  tags:       string[];
  importance: number;
}

const extractionSchema = z.object({
  memories: z.array(z.object({
    type:       z.enum(['goal', 'insight', 'preference', 'context', 'decision', 'entity', 'correction']),
    content:    z.string().min(5).max(300),
    tags:       z.array(z.string().max(40)).max(5),
    importance: z.number().int().min(1).max(5),
  })).max(3),
});

export async function extractMemories(
  prompt: string,
  responseSummary: string,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
  maxTokens?: number,
): Promise<{ memories: ExtractedMemory[]; inputTokens: number; outputTokens: number }> {
  try {
    const agent  = createSkillAgent('memory', SKILL_PROMPT, apiKey, userModel, userProvider);
    const result = await agent.generate(
      [{ role: 'user', content: JSON.stringify({ mode: 'EXTRACT', userPrompt: prompt, aiResponse: responseSummary }) }],
      {
        structuredOutput: { schema: extractionSchema },
        modelSettings:    { maxOutputTokens: maxTokens ?? MAX_TOKENS, temperature: 0, maxRetries: 1 },
        abortSignal:      freshSignal('memory'),
      },
    );
    const object       = result.object as z.infer<typeof extractionSchema>;
    const inputTokens  = result.usage.inputTokens  ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    log('memory-skill', `extracted ${object.memories.length} item(s) | in:${inputTokens} out:${outputTokens}`);
    return { memories: object.memories as ExtractedMemory[], inputTokens, outputTokens };
  } catch (err) {
    log('memory-skill', `extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return { memories: [], inputTokens: 0, outputTokens: 0 };
  }
}
