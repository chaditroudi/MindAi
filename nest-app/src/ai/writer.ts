import { z } from 'zod';
import {
  createSkillAgent,
  freshSignal,
  skillProviderOptions,
  withRateLimitRetry,
} from './model';
import { readMarkdownSection, skillFile } from './skill-prompt';
import { log, logTrace } from '../common/logger/app.logger';
import { buildInquiryMessage, buildReportMessage } from '../prompts';
import type { TokenUsage } from './token';

const INQUIRY_INSTRUCTIONS = readMarkdownSection(
  skillFile('inquiry', 'SKILL.md'),
  'Runtime Prompt',
);
const REPORT_INSTRUCTIONS = readMarkdownSection(
  skillFile('report', 'SKILL.md'),
  'Runtime Prompt',
);

const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);
const REPORT_MAX_TOKENS = Number(process.env['REPORT_MAX_TOKENS'] ?? 1_500);
const INQUIRY_MAX_ROWS = Number(process.env['INQUIRY_MAX_ROWS'] ?? 10);
const WRITER_MAX_CHARS = Number(process.env['WRITER_MAX_CHARS'] ?? 8_000);

const summarySchema = z.object({
  summary: z.string(),
});

const reportSectionsSchema = z.object({
  reportSections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
      }),
    )
    .min(1)
    .max(5),
});

export type InquirySummary = z.infer<typeof summarySchema>;
export type ReportSections = z.infer<typeof reportSectionsSchema>;

export interface WriterResult<T> {
  result: T;
  usage: TokenUsage;
}

export interface WriterInput {
  prompt: string;
  rows: unknown[];
  withChart?: boolean;
  apiKey?: string;
  userModel?: string;
  userProvider?: string;
  maxTokens?: number;
}

export async function runInquirySkill({
  prompt,
  rows,
  apiKey,
  userModel,
  userProvider,
  maxTokens,
}: WriterInput): Promise<WriterResult<InquirySummary>> {
  const limit = maxTokens ?? INQUIRY_MAX_TOKENS;
  const t0 = Date.now();
  log(
    'writer:inquiry',
    `rows: ${rows.length} | maxRows: ${INQUIRY_MAX_ROWS} | maxTokens: ${limit}`,
  );

  const agent = createSkillAgent(
    'writer',
    INQUIRY_INSTRUCTIONS,
    apiKey,
    userModel,
    userProvider,
  );
  const result = await withRateLimitRetry(
    () =>
      agent.generate(
        [
          {
            role: 'user',
            content: buildInquiryMessage(
              prompt,
              rows,
              INQUIRY_MAX_ROWS,
              WRITER_MAX_CHARS,
            ),
          },
        ],
        {
          structuredOutput: { schema: summarySchema },
          modelSettings: {
            maxOutputTokens: limit,
            temperature: 0,
            maxRetries: 0,
          },
          abortSignal: freshSignal('writer'),
          providerOptions: skillProviderOptions(apiKey, userProvider),
        },
      ),
    'inquiry',
  );

  const object = result.object as InquirySummary;
  const usage: TokenUsage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };

  log(
    'writer:inquiry',
    `done | ${Date.now() - t0}ms | in:${usage.inputTokens} out:${usage.outputTokens}`,
  );
  logTrace('writer:inquiry', `result`, object);
  return { result: object, usage };
}

export async function runReportSkill({
  prompt,
  rows,
  withChart,
  apiKey,
  userModel,
  userProvider,
  maxTokens,
}: WriterInput): Promise<WriterResult<ReportSections>> {
  const limit = maxTokens ?? REPORT_MAX_TOKENS;
  const start = Date.now();
  log(
    'writer:report',
    `rows: ${rows.length} | maxTokens: ${limit} | withChart: ${withChart ?? false}`,
  );

  const agent = createSkillAgent(
    'writer',
    REPORT_INSTRUCTIONS,
    apiKey,
    userModel,
    userProvider,
  );
  const result = await withRateLimitRetry(
    () =>
      agent.generate(
        [
          {
            role: 'user',
            content: buildReportMessage(
              prompt,
              rows,
              WRITER_MAX_CHARS,
              withChart,
            ),
          },
        ],
        {
          structuredOutput: { schema: reportSectionsSchema },
          modelSettings: {
            maxOutputTokens: limit,
            temperature: 0,
            maxRetries: 0,
          },
          abortSignal: freshSignal('writer'),
          providerOptions: skillProviderOptions(apiKey, userProvider),
        },
      ),
    'report',
  );

  const object = result.object as ReportSections;
  const usage: TokenUsage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };

  log(
    'writer:report',
    `done in ${Date.now() - start}ms | sections: ${object.reportSections.length} | in:${usage.inputTokens} out:${usage.outputTokens}`,
  );
  logTrace('writer:report', `result`, object);
  return { result: object, usage };
}
