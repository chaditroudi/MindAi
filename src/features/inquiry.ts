import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline.js';
import { log } from '../utils/logger.js';
import { runInquirySkill } from '../ai/writer.js';

export async function executeInquiry(
  prompt:    string,
  context:   CoreMessage[] = [],
  apiKey?:   string,
  model?:    string,
  provider?: string,
): Promise<{ summary: string }> {
  const { plan, rows } = await aggregate(prompt, 'general_question', context, apiKey, model, provider);

  if (!plan.skills.includes('inquiry')) {
    return { summary: 'The request could not be answered from the available sources.' };
  }

  if (!rows.length) {
    return { summary: 'No matching data found for this question.' };
  }

  log('inquiry', `rows: ${rows.length} | prompt: "${prompt}"`);
  const result = await runInquirySkill({ rows, prompt, apiKey, model, provider });
  log('inquiry', 'done');
  return result;
}
