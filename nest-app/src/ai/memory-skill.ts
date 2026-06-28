import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel, freshSignal } from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log } from '../common/logger/app.logger';
import type { MemoryType } from '../memory/memory.schema';

const SKILL_PROMPT  = readMarkdownSection(skillFile('memory', 'SKILL.md'), 'Runtime Prompt');
const MAX_TOKENS    = Number(process.env['MEMORY_MAX_TOKENS'] ?? 400);

export interface ExtractedMemory {
  type:       MemoryType;
  content:    string;
  tags:       string[];
  importance: number;
}

const extractionSchema = z.object({
  memories: z.array(z.object({
    type:       z.enum(['goal', 'insight', 'preference', 'context', 'decision']),
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
): Promise<ExtractedMemory[]> {
  try {
    const { object } = await generateObject({
      model:       resolveModel('memory', apiKey, userModel),
      abortSignal: freshSignal('memory'),
      temperature: 0,
      maxRetries:  1,
      maxTokens:   MAX_TOKENS,
      schema:      extractionSchema,
      system:      SKILL_PROMPT,
      messages: [{
        role:    'user',
        content: JSON.stringify({
          userPrompt:   prompt,
          aiResponse:   responseSummary,
        }),
      }],
    });
    log('memory-skill', `extracted ${object.memories.length} item(s)`);
    return object.memories as ExtractedMemory[];
  } catch (err) {
    log('memory-skill', `extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
