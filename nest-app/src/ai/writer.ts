// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file is LLM CALL #2 for text-based outputs.
// After the MongoDB aggregation runs and returns rows of data, this file sends
// those rows to the LLM and asks it to write human-readable text.
//
// TWO FUNCTIONS, TWO USE CASES:
//   runInquirySkill()  → short factual answer  (e.g. "There are 42 active projects")
//   runReportSkill()   → structured report      (e.g. 3 sections with headings + body text)
//
// FLOW:
//   PipelineService.executeInquiry() → runInquirySkill()  ← THIS FILE
//   PipelineService.executeReport()  → runReportSkill()   ← THIS FILE
//
// NOTE: dashboards do NOT use this file — they use ai/chart.ts instead.
//
// USED BY: analytics/pipeline.service.ts, features/inquiry.ts, features/report.ts
// ─────────────────────────────────────────────────────────────────────────────

// generateObject → Vercel AI SDK: calls LLM and forces response to match a Zod schema
import { generateObject } from 'ai';

// z → Zod schema builder used to define the exact JSON shape we expect from the LLM
import { z } from 'zod';

// resolveModel → creates the Groq LLM client for the 'writer' role
// freshSignal  → creates an AbortSignal with the writer's timeout (default 8s)
import { resolveModel, freshSignal } from './model';

// readMarkdownSection → extracts a section from a .md file by heading name
// skillFile           → builds absolute path to a file inside the skills/ folder
import { readMarkdownSection, skillFile } from './skill-prompt';

// log      → tagged console log
// logTrace → verbose JSON dump (only when TRACE=1 env is set)
import { log, logTrace } from '../common/logger/app.logger';

// buildInquiryMessage → formats rows + prompt into the LLM user message for inquiry
// buildReportMessage  → formats rows + prompt into the LLM user message for report
import { buildInquiryMessage, buildReportMessage } from '../prompts/writer.prompt';

// ── SYSTEM PROMPTS (loaded once at startup, not per request) ──────────────────
// Each skill has its own Markdown file with a "## Runtime Prompt" section.
// These are the system prompts that tell the LLM HOW to write — its persona,
// rules, tone, and output constraints.
//
// Example from skills/inquiry/SKILL.md:
//   ## Runtime Prompt
//   You are a precise data analyst. Answer the question directly using the data.
//   Be concise. Use numbers from the data. Do not add assumptions.
const INQUIRY_INSTRUCTIONS = readMarkdownSection(skillFile('inquiry', 'SKILL.md'), 'Runtime Prompt');
const REPORT_INSTRUCTIONS  = readMarkdownSection(skillFile('report',  'SKILL.md'), 'Runtime Prompt');

// ── TOKEN / ROW LIMITS (tunable via env vars) ─────────────────────────────────
// These caps prevent runaway LLM costs and keep responses appropriately sized.

// Max tokens the LLM can use for an inquiry response (short answers = fewer tokens)
const INQUIRY_MAX_TOKENS = Number(process.env['INQUIRY_MAX_TOKENS'] ?? 400);

// Max tokens the LLM can use for a report response (longer = more sections allowed)
const REPORT_MAX_TOKENS  = Number(process.env['REPORT_MAX_TOKENS']  ?? 900);

// Max data rows sent to the inquiry LLM (sending all 500 rows would waste tokens)
const INQUIRY_MAX_ROWS   = Number(process.env['INQUIRY_MAX_ROWS']   ?? 10);

// Max total characters of data text sent to any writer LLM call
// Prevents token overflow if rows have very long string fields
const WRITER_MAX_CHARS   = Number(process.env['WRITER_MAX_CHARS']   ?? 8_000);

// ── OUTPUT SCHEMAS (what we demand the LLM returns) ───────────────────────────

// Inquiry schema: the LLM must return exactly { summary: "..." }
// A single string answer — no sections, no headings.
const summarySchema = z.object({
  summary: z.string(),
});

// Report schema: the LLM must return { reportSections: [{ heading, body }, ...] }
// At least 1 section, at most 5 — enforced by Zod BEFORE the response reaches our code.
const reportSectionsSchema = z.object({
  reportSections: z.array(z.object({
    heading: z.string(), // section title e.g. "Budget Overview"
    body:    z.string(), // section content e.g. "Total spending reached 4.2M..."
  })).min(1).max(5),    // 1-5 sections enforced by Zod
});

// ── EXPORTED TYPES ────────────────────────────────────────────────────────────
// z.infer<typeof schema> extracts the TypeScript type FROM the Zod schema.
// This means the types automatically stay in sync with the schema — no duplication.
export type InquirySummary = z.infer<typeof summarySchema>;       // { summary: string }
export type ReportSections = z.infer<typeof reportSectionsSchema>; // { reportSections: [...] }

// Shared input shape for both functions
export interface WriterInput {
  prompt:    string;    // the user's original question
  rows:      unknown[]; // the MongoDB aggregation results
  withChart?: boolean;  // (report only) tells LLM a chart will also be shown
  apiKey?:   string;    // optional per-user Groq key
}

// ── runInquirySkill() ─────────────────────────────────────────────────────────
// Sends aggregated data rows to the LLM and gets back a SHORT factual answer.
//
// Example:
//   prompt: "how many projects are in progress?"
//   rows:   [{ status: "in_progress", count: 42 }]
//   output: { summary: "There are 42 projects currently in progress." }
//
// Only sends the first INQUIRY_MAX_ROWS rows (default 10) because inquiries
// are simple questions — sending all 500 rows would waste tokens.
export async function runInquirySkill({ prompt, rows, apiKey }: WriterInput): Promise<InquirySummary> {
  const t0 = Date.now();
  log('writer:inquiry', `rows: ${rows.length} | maxRows: ${INQUIRY_MAX_ROWS} | maxTokens: ${INQUIRY_MAX_TOKENS}`);

  const { object } = await generateObject({
    model:       resolveModel('writer', apiKey), // Groq client for writer role
    abortSignal: freshSignal('writer'),           // cancel if LLM takes > 8s
    temperature: 0,                               // 0 = deterministic answers
    maxRetries:  1,                               // retry once if schema mismatch
    schema:      summarySchema,                   // force { summary: string } output
    system:      INQUIRY_INSTRUCTIONS,            // tells LLM HOW to answer (persona + rules)
    maxTokens:   INQUIRY_MAX_TOKENS,              // cap response length

    // buildInquiryMessage formats the data rows + question into the user message.
    // It truncates rows to INQUIRY_MAX_ROWS and data to WRITER_MAX_CHARS.
    messages: [{ role: 'user', content: buildInquiryMessage(prompt, rows, INQUIRY_MAX_ROWS, WRITER_MAX_CHARS) }],
  });

  log('writer:inquiry', `done | ${Date.now() - t0}ms`);
  logTrace('writer:inquiry', `result`, object); // full JSON dump when TRACE=1
  return object; // { summary: "..." }
}

// ── runReportSkill() ──────────────────────────────────────────────────────────
// Sends aggregated data rows to the LLM and gets back a STRUCTURED REPORT
// with multiple sections (heading + body paragraph each).
//
// Example:
//   prompt: "generate a report on infrastructure projects"
//   rows:   [{ municipality: "...", budget: 500000, status: "..." }, ...]
//   output: {
//     reportSections: [
//       { heading: "Executive Summary", body: "Infrastructure spending totalled..." },
//       { heading: "Budget Breakdown",  body: "The largest allocation was..." },
//       { heading: "Key Findings",      body: "Three projects exceeded budget..." },
//     ]
//   }
//
// @param withChart - if true, tells the LLM a chart will accompany the report so
//                   it avoids repeating visual information in the prose
export async function runReportSkill({ prompt, rows, withChart, apiKey }: WriterInput): Promise<ReportSections> {
  const start = Date.now();
  log('writer:report', `rows: ${rows.length} | maxTokens: ${REPORT_MAX_TOKENS} | withChart: ${withChart ?? false}`);

  const { object } = await generateObject({
    model:       resolveModel('writer', apiKey), // Groq client for writer role
    abortSignal: freshSignal('writer'),           // cancel if LLM takes > 8s
    temperature: 0,                               // 0 = consistent, structured output
    maxRetries:  1,                               // retry once if schema mismatch
    schema:      reportSectionsSchema,            // force { reportSections: [...] } output
    system:      REPORT_INSTRUCTIONS,             // tells LLM HOW to write the report
    maxTokens:   REPORT_MAX_TOKENS,               // more tokens than inquiry (reports are longer)

    // buildReportMessage formats all rows + question + withChart flag into user message.
    // Truncates to WRITER_MAX_CHARS to prevent token overflow on large datasets.
    messages: [{ role: 'user', content: buildReportMessage(prompt, rows, WRITER_MAX_CHARS, withChart) }],
  });

  log('writer:report', `done in ${Date.now() - start}ms | sections: ${object.reportSections.length}`);
  logTrace('writer:report', `result`, object); // full JSON dump when TRACE=1
  return object; // { reportSections: [{ heading, body }, ...] }
}
