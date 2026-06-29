import { log, logTrace }                               from '../common/logger/app.logger';
import { createSkillAgent, freshSignal, skillProviderOptions } from './model';
import type { TokenUsage }                               from './token';
import { buildChartPrompt }                              from '../prompts';
import type { DashboardSpec, SkillKind, ChartHint, DataSource, WidgetSpec } from '../types';

export type { ChartDefinition } from './chart-config';
export { CHART_DEFINITIONS }    from './chart-config';
import { dashboardSchema, CHART_DEFINITIONS } from './chart-config';
import type { LlmDashboard }                  from './chart-config';

// ── Entry point ───────────────────────────────────────────────────────────────

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 3);
const MAX_TOKENS  = Number(process.env['CHART_MAX_TOKENS']  ?? 2_000);

export interface ChartResult { result: DashboardSpec; usage: TokenUsage; }

export async function runChart(
  rows:          Record<string, unknown>[],
  prompt:        string,
  strategy?:     SkillKind,
  chartHint?:    ChartHint,
  source?:       DataSource,
  apiKey?:       string,
  userModel?:    string,
  userProvider?: string,
  maxTokens?:    number,
): Promise<ChartResult> {
  if (!rows.length) {
    return {
      result: { layout: 'operational', title: 'No data', summary: 'No rows returned for this request.', widgets: [] },
      usage:  { inputTokens: 0, outputTokens: 0 },
    };
  }

  log('chart', `rows: ${rows.length} | strategy: ${strategy ?? 'standard'} | hint: ${chartHint ?? '-'} | source: ${source?.name ?? '?'}`);

  let plan: LlmDashboard;
  let llmUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const t0 = Date.now();

  try {
    const agent  = createSkillAgent('chart', '', apiKey, userModel, userProvider);
    const result = await agent.generate(
      [{ role: 'user', content: buildChartPrompt(rows, prompt, strategy, chartHint, source) }],
      {
        structuredOutput: { schema: dashboardSchema },
        modelSettings:    { maxOutputTokens: maxTokens ?? MAX_TOKENS, temperature: 0, maxRetries: 1 },
        abortSignal:      freshSignal('chart'),
        providerOptions:  skillProviderOptions(apiKey, userProvider),
      },
    );
    plan     = result.object as LlmDashboard;
    llmUsage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
    log('chart:llm', `done in ${Date.now() - t0}ms | widgets: ${plan.widgets.length} | in:${llmUsage.inputTokens} out:${llmUsage.outputTokens}`);
    logTrace('chart:llm', 'widget plan', plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('chart', `agent.generate failed: ${msg}`);
    throw err;
  }

  const widgets: WidgetSpec[] = plan.widgets
    .slice(0, MAX_WIDGETS)
    .filter(w => {
      const opt = w.option;
      const valid = opt !== null && typeof opt === 'object' && Object.keys(opt).length > 0;
      if (!valid) log('chart', `dropped widget "${w.title}" — missing or empty option`);
      return valid;
    })
    .map((w, i) => ({
      id:      `w${i + 1}`,
      type:    w.type,
      title:   w.title,
      insight: w.insight,
      option:  w.option as Record<string, unknown>,
    }));

  log('chart', `done | widgets: ${widgets.length} | layout: ${plan.layout}`);

  return {
    result: { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec,
    usage:  llmUsage,
  };
}

// Keep CHART_DEFINITIONS accessible so analytics.service can reference chart types if needed.
void CHART_DEFINITIONS;
