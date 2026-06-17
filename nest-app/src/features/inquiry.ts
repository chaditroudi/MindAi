import type { CoreMessage } from 'ai';
import { aggregate } from './pipeline';
import { log } from '../common/logger/app.logger';
import { runInquirySkill } from '../ai/writer';

export async function executeInquiry(
  prompt:  string,
  context: CoreMessage[] = [],
  apiKey?: string,
): Promise<{ summary: string }> {
  const { plan, rows } = await aggregate(prompt, 'general_question', context, apiKey);

  if (!plan.skills.includes('inquiry')) {
    return { summary: 'The request could not be answered from the available sources.' };
  }

  if (!rows.length) {
    return { summary: 'No matching data found for this question.' };
  }

  log('inquiry', `rows: ${rows.length} | prompt: "${prompt}"`);
  const result = await runInquirySkill({ rows, prompt, apiKey });
  log('inquiry', 'done');
  return result;
}
