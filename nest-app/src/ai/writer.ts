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

/**
 * writer.ts
 * ---------
 * The "writer" agent role, which actually covers two distinct skills sharing
 * one file because they're structurally identical (rows in, prose out) but
 * with different SKILL.md instructions and output shapes:
 *  - runInquirySkill: a short one-line answer to a direct question
 *  - runReportSkill: a multi-section written report
 *
 * Both are much simpler than chart.ts's runChart — there's no runtime
 * sanitization step here because the output is plain text, not a structured
 * ECharts option the frontend has to render safely.
 */

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
// Inquiry only ever shows the model a handful of rows (it's answering one
// question, not analyzing a full dataset) — report gets the fuller
// WRITER_MAX_CHARS budget below instead.
const INQUIRY_MAX_ROWS = Number(process.env['INQUIRY_MAX_ROWS'] ?? 10);
const WRITER_MAX_CHARS = Number(process.env['WRITER_MAX_CHARS'] ?? 8_000);

const summarySchema = z.object({
  summary: z.string(),
});

// 1-5 sections, each just a heading + a body paragraph — the report skill's
// SKILL.md presumably guides what those sections should cover (trends,
// context, recommendations), enforced only structurally here.
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

/** Answers a direct question about the data with one short summary sentence. */
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
            // buildInquiryMessage caps both row count (INQUIRY_MAX_ROWS) and
            // total character size (WRITER_MAX_CHARS) so a huge result set
            // never blows the model's context window.
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

/** Writes a multi-section analytical report over the given rows. */
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
            // `withChart` tells buildReportMessage to instruct the model NOT
            // to restate distributions/rankings in prose — a chart widget
            // will already be shown alongside this report for that.
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
