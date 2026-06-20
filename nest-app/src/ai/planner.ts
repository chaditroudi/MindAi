// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file is LLM CALL #1 — the "Supervisor".
// It receives the user's natural-language prompt and translates it into a
// structured TaskPlan: which MongoDB collection to query, what aggregation
// pipeline to run, and which downstream skills to activate.
//
// Think of it as the "brain" that reads the question and decides what to do.
// Everything else in the pipeline just executes its instructions.
//
// FLOW:
//   AnalyticsService
//     -> PipelineService.aggregate()
//       -> runSupervisorPlan()   ← THIS FILE
//         -> returns TaskPlan
//       -> MongoDB aggregation
//       -> runChart() / runReportSkill() / runInquirySkill()
//
// USED BY: analytics/pipeline.service.ts, features/pipeline.ts
// ─────────────────────────────────────────────────────────────────────────────

// generateObject → Vercel AI SDK function that calls an LLM and forces the
// response to match a Zod schema. Returns { object } — a typed, validated result.
// If the LLM output doesn't match the schema, it retries or throws.
import { generateObject } from 'ai';

// CoreMessage → the message format the Vercel AI SDK uses for chat history.
// Shape: { role: 'user' | 'assistant', content: string }
import type { CoreMessage } from 'ai';

// z → Zod, a TypeScript-first schema validation library.
// We use it to define the exact shape we want the LLM to return.
import { z } from 'zod';

// resolveModel → creates the Groq LLM client for the 'supervisor' role
// freshSignal  → creates an AbortSignal with the supervisor's timeout (default 8s)
import { resolveModel, freshSignal } from './model';

// normalizeToken → lowercases + strips punctuation so "My Source" matches "my_source"
import { normalizeToken } from '../sources/source.repository';

// log      → prints a tagged log line to the console
// logTrace → prints detailed JSON dumps (only when TRACE=1 env is set)
import { log, logTrace } from '../common/logger/app.logger';

// buildPlannerPrompt   → builds the system prompt with all DataSource schemas injected
// PLANNER_DEFAULT_STRATEGY → the fallback strategy value (e.g. 'standard')
// PLANNER_STRATEGIES   → the full list of valid strategy values
import { buildPlannerPrompt, PLANNER_DEFAULT_STRATEGY, PLANNER_STRATEGIES } from '../prompts/planner.prompt';

// DataSource → registered data collection definition (name, fields, collection)
// TaskPlan   → what this file returns: { needsData, pipeline, skills, strategy, ... }
// IntentKind → 'dashboard' | 'report' | 'general_question'
import type { DataSource, TaskPlan, IntentKind } from '../types';

// How many tokens the LLM is allowed to use for its response.
// Lower = cheaper + faster. 600 is enough for a MongoDB pipeline plan.
const MAX_TOKENS = Number(process.env['PLANNER_MAX_TOKENS'] ?? 600);

// A Zod enum built from the PLANNER_STRATEGIES array (e.g. ['standard','trend','comparison',...])
// Used inside buildPlanSchema to validate the strategy field the LLM returns.
const STRATEGY_ENUM = z.enum(PLANNER_STRATEGIES as [string, ...string[]]);

// ── strategySchema() ──────────────────────────────────────────────────────────
// Returns a Zod schema for the strategy field that:
//   1. Trims and lowercases the LLM's response before validating (z.preprocess)
//      → handles "Standard" or " trend " being returned instead of "standard"/"trend"
//   2. Validates it is one of the allowed strategy values (STRATEGY_ENUM)
function strategySchema() {
  return z.preprocess(
    // preprocess runs BEFORE the enum check — cleans the value first
    value => typeof value === 'string' ? value.trim().toLowerCase() : value,
    STRATEGY_ENUM,
  );
}

// ── buildPlanSchema() ─────────────────────────────────────────────────────────
// Builds the Zod schema that defines the exact JSON shape we demand from the LLM.
// The schema is DIFFERENT per intent because dashboards need chart metadata,
// reports optionally need a chart, and inquiries only need the base fields.
//
// generateObject() uses this schema to:
//   a) Tell the LLM what JSON shape to produce (via the system prompt)
//   b) Validate and parse the LLM's response
//   c) Retry if the response doesn't match
function buildPlanSchema(intent: IntentKind) {

  // BASE fields — present in all intents
  const base = z.object({
    // needsData: does the LLM think we actually need to query MongoDB?
    // false = the question can be answered without data (e.g. "what is the app for?")
    needsData: z.boolean(),

    query: z.object({
      // sourceName: which registered DataSource to query (e.g. "projects")
      // optional because needsData might be false
      sourceName: z.string().optional(),

      // limit: optional row limit hint from the LLM (rarely used — pipeline has $limit)
      limit: z.number().optional(),
    }),

    // pipeline: the MongoDB aggregation stages the LLM wants to run.
    // Each stage is a record like { "$match": { "status": "active" } }
    // z.record(z.unknown()) accepts any object shape — MongoDB stages vary widely.
    // .default([]) means if the LLM omits this field, we get an empty array.
    pipeline: z.array(z.record(z.unknown())).default([]),
  });

  // DASHBOARD extras — chart metadata required
  if (intent === 'dashboard') {
    return base.extend({
      // strategy: how to approach the visualization (trend, comparison, overview, etc.)
      // .catch(PLANNER_DEFAULT_STRATEGY) → if strategy is invalid, use default instead of throwing
      // .default(PLANNER_DEFAULT_STRATEGY) → if strategy is missing, use default
      strategy:  strategySchema().catch(PLANNER_DEFAULT_STRATEGY).default(PLANNER_DEFAULT_STRATEGY),

      // chartHint: a one-word hint for the chart agent (e.g. 'distribution', 'trend')
      // .catch('distribution') → invalid value falls back to 'distribution'
      chartHint: z.string().catch('distribution').default('distribution'),
    });
  }

  // REPORT extras — chart is optional, not required
  if (intent === 'report') {
    return base.extend({
      // wantChart: should a chart accompany the written report?
      // The LLM decides based on whether the data is visual (false by default)
      wantChart: z.boolean().default(false),

      // strategy and chartHint are optional for reports (only used if wantChart=true)
      strategy:  strategySchema().optional(),
      chartHint: z.string().optional(),
    });
  }

  // INQUIRY (general_question) — just the base fields, no chart needed
  return base;
}

// ── runSupervisorPlan() ───────────────────────────────────────────────────────
// THE MAIN EXPORT. Calls the Groq LLM and returns a structured TaskPlan.
//
// @param prompt   - user's natural-language question
// @param intent   - 'dashboard' | 'report' | 'general_question'
// @param sources  - all registered DataSources (their schemas are injected into the prompt)
// @param context  - previous conversation messages (for multi-turn sessions)
// @param apiKey   - optional per-user Groq key (overrides global key)
//
// @returns TaskPlan - { needsData, pipeline, skills, query, strategy?, chartHint? }
export async function runSupervisorPlan({
  prompt,
  intent,
  sources,
  context = [],  // default to empty array if no conversation history
  apiKey,
}: {
  prompt:   string;
  intent:   IntentKind;
  sources:  DataSource[];
  context?: CoreMessage[];
  apiKey?:  string;
}): Promise<TaskPlan> {
  const start = Date.now(); // track how long the LLM call takes

  log('planner', `LLM call | intent: ${intent} | sources: ${sources.length} | context: ${context.length} | prompt: "${prompt}"`);

  // generateObject sends the prompt to Groq and forces the response to match
  // the Zod schema. If it doesn't match, it retries once (maxRetries: 1).
  const { object } = await generateObject({
    model:       resolveModel('supervisor', apiKey), // Groq client for supervisor role
    abortSignal: freshSignal('supervisor'),          // cancel if LLM takes > 8s
    schema:      buildPlanSchema(intent),            // the JSON shape we expect back
    mode:        'json',                             // force JSON output mode
    temperature: 0,                                  // 0 = deterministic, no creativity
    maxRetries:  1,                                  // retry once on schema mismatch
    maxTokens:   MAX_TOKENS,                         // cap response length (default 600)

    // system: the full system prompt — includes all DataSource schemas so the LLM
    // knows what collections and fields exist to build the MongoDB pipeline against
    system: buildPlannerPrompt(intent, sources),

    // messages: conversation history first, then the current user prompt.
    // We wrap the prompt in JSON so the LLM sees both the text and the intent clearly.
    messages: [
      ...context,                                                    // prior messages (if any)
      { role: 'user', content: JSON.stringify({ prompt, intent }) }, // current request
    ],
  });

  // Log timing and key plan fields for observability
  const { strategy, chartHint } = object as { strategy?: string; chartHint?: string };
  log('planner', `done in ${Date.now() - start}ms | strategy: ${strategy ?? '-'} | chartHint: ${chartHint ?? '-'} | stages: ${object.pipeline.length}`);

  // logTrace dumps the full plan object — only visible when TRACE=1 env var is set
  logTrace('planner', `generated plan`, object);

  // Post-process the raw LLM output before returning it to the pipeline
  return finalizeTaskPlan({ plan: object as TaskPlan, intent, availableSources: sources });
}

// ── finalizeTaskPlan() ────────────────────────────────────────────────────────
// Cleans up the raw LLM plan before it reaches the pipeline:
//   1. Resolves the fuzzy source name to a canonical DataSource name
//   2. Derives which execution skills the pipeline should activate
//
// WHY SOURCE NAME RESOLUTION: the LLM might return "Projects" or "project_data"
// when the actual registered name is "projects". normalizeToken() strips case and
// punctuation so "Projects" and "projects" both match.
function finalizeTaskPlan({
  plan,
  intent,
  availableSources,
}: {
  plan:             TaskPlan;
  intent:           IntentKind;
  availableSources: DataSource[];
}): TaskPlan {
  // Normalize the LLM's source name guess for fuzzy matching
  const token = normalizeToken(plan.query.sourceName);

  // Find the matching registered DataSource by comparing normalized names/collections
  const source = availableSources.find(s =>
    normalizeToken(s.name) === token || normalizeToken(s.collection) === token,
  );

  return {
    ...plan, // spread all LLM-returned fields

    // Replace LLM's guess with the real canonical source name (if found)
    // Falls back to whatever the LLM returned if no match is found
    query: {
      ...plan.query,
      sourceName: source?.name ?? plan.query.sourceName,
    },

    // Overwrite 'skills' with our derived list (LLM doesn't return this — we compute it)
    skills: deriveExecutionSkills(plan, intent),
  };
}

// ── deriveExecutionSkills() ───────────────────────────────────────────────────
// Decides which downstream steps the pipeline should run, based on:
//   - plan.needsData  → does the answer require querying MongoDB at all?
//   - intent          → what type of output does the user want?
//   - plan.wantChart  → (report only) should a chart accompany the text?
//
// The returned array tells PipelineService exactly what to execute:
//   'aggregation' → run the MongoDB pipeline
//   'chart'       → call runChart() to build ECharts widgets
//   'report'      → call runReportSkill() to write sections
//   'inquiry'     → call runInquirySkill() to write a summary
function deriveExecutionSkills(
  plan:   Pick<TaskPlan, 'needsData' | 'wantChart'>,
  intent: IntentKind,
): TaskPlan['skills'] {
  // If no data is needed, skip everything — the LLM will answer from knowledge alone
  if (!plan.needsData) return [];

  // Dashboard always needs both: aggregate data + build charts
  if (intent === 'dashboard') return ['aggregation', 'chart'];

  // Report needs aggregate + write text, optionally + chart
  if (intent === 'report') return plan.wantChart
    ? ['aggregation', 'report', 'chart']  // text sections + visual chart
    : ['aggregation', 'report'];           // text sections only

  // Inquiry (general_question) needs aggregate + write a short summary
  return ['aggregation', 'inquiry'];
}
