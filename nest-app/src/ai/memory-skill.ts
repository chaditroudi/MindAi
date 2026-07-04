import { z } from 'zod';
import { createSkillAgent, freshSignal, skillProviderOptions } from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log } from '../common/logger/app.logger';
import type { MemoryType } from '../memory/memory.repository';

/**
 * memory-skill.ts
 * ---------------
 * The "memory" agent role: after every analytics response, MemoryService
 * fires this (fire-and-forget) to distill the exchange into a handful of
 * short, typed, tagged facts — the kind of thing worth recalling on a LATER,
 * unrelated conversation (a stated preference, a decision, an entity the
 * user cares about) rather than the raw conversation itself. This is
 * entirely separate from session/memory.ts's chat-history store, which
 * remembers the literal turns of the current conversation.
 */

const SKILL_PROMPT = readMarkdownSection(
  skillFile('memory', 'SKILL.md'),
  'Runtime Prompt',
);
const MAX_TOKENS = Number(process.env['MEMORY_MAX_TOKENS'] ?? 400);

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
}

// Deliberately small ceilings (max 3 memories, 300 chars each, 5 tags) —
// this is meant to capture a few durable facts per exchange, not summarize
// the whole conversation.
const extractionSchema = z.object({
  memories: z
    .array(
      z.object({
        type: z.enum([
          'goal',
          'insight',
          'preference',
          'context',
          'decision',
          'entity',
          'correction',
        ]),
        content: z.string().min(5).max(300),
        tags: z.array(z.string().max(40)).max(5),
        importance: z.number().int().min(1).max(5),
      }),
    )
    .max(3),
});

/**
 * Runs the memory-extraction LLM call. Deliberately never throws: any
 * failure here (bad structured output, provider error) is logged and
 * swallowed, returning an empty result — because this always runs
 * fire-and-forget after the user's real request has already succeeded, and
 * a memory-extraction hiccup must never surface as an error to the user or
 * retroactively affect a response they already received.
 */
export async function extractMemories(
  prompt: string,
  responseSummary: string,
  apiKey?: string,
  userModel?: string,
  userProvider?: string,
  maxTokens?: number,
): Promise<{
  memories: ExtractedMemory[];
  inputTokens: number;
  outputTokens: number;
}> {
  try {
    const agent = createSkillAgent(
      'memory',
      SKILL_PROMPT,
      apiKey,
      userModel,
      userProvider,
    );
    const result = await agent.generate(
      [
        {
          role: 'user',
          // MODE: 'EXTRACT' is a hint to the skill's own prompt, which
          // apparently supports more than one mode (this file only ever
          // uses EXTRACT) — the user's question and a short summary of what
          // the assistant answered are both given, so the model can extract
          // facts from either side of the exchange.
          content: JSON.stringify({
            mode: 'EXTRACT',
            userPrompt: prompt,
            aiResponse: responseSummary,
          }),
        },
      ],
      {
        structuredOutput: { schema: extractionSchema },
        modelSettings: {
          maxOutputTokens: maxTokens ?? MAX_TOKENS,
          temperature: 0,
          maxRetries: 1,
        },
        abortSignal: freshSignal('memory'),
        providerOptions: skillProviderOptions(apiKey, userProvider),
      },
    );
    const object = result.object as z.infer<typeof extractionSchema>;
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    log(
      'memory-skill',
      `extracted ${object.memories.length} item(s) | in:${inputTokens} out:${outputTokens}`,
    );
    return {
      memories: object.memories,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    // Swallow everything — see the doc comment above for why.
    log(
      'memory-skill',
      `extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { memories: [], inputTokens: 0, outputTokens: 0 };
  }
}
