import { generateObject }         from 'ai';
import { z }                       from 'zod';
import { log, logTrace }           from '../common/logger/app.logger';
import { resolveModel, freshSignal } from './model';
import { buildChartPrompt }        from '../prompts/chart.prompt';
import type { DashboardSpec, SkillKind, ChartHint, DataSource } from '../types';

const MAX_WIDGETS = Number(process.env['CHART_MAX_WIDGETS'] ?? 3);
const MAX_TOKENS  = Number(process.env['CHART_MAX_TOKENS']  ?? 2000);

const widgetSchema = z.object({
  type:    z.string(),
  title:   z.string(),
  insight: z.string().optional(),
  option:  z.record(z.unknown()).optional(),           // full ECharts option — LLM embeds actual data
  value:   z.number().optional(),                     // kpi_card: direct numeric
  columns: z.array(z.string()).optional(),            // table: column list
  rows:    z.array(z.record(z.unknown())).optional(), // table: data rows
});

const dashboardSchema = z.object({
  layout:  z.enum(['analytical', 'executive', 'operational']),
  summary: z.string(),
  widgets: z.array(widgetSchema).min(1),
});

export async function runChart(
  rows:       Record<string, unknown>[],
  prompt:     string,
  strategy?:  SkillKind,
  chartHint?: ChartHint,
  source?:    DataSource,
  apiKey?:    string,
): Promise<DashboardSpec> {
  if (!rows.length) {
    return { layout: 'operational', title: 'No data', summary: 'No rows returned for this request.', widgets: [] };
  }

  log('chart', `rows: ${rows.length} | strategy: ${strategy ?? 'standard'} | hint: ${chartHint ?? '-'} | source: ${source?.name ?? '?'}`);

  let plan: z.infer<typeof dashboardSchema>;
  const t0 = Date.now();
  try {
    const { object } = await generateObject({
      model:       resolveModel('chart', apiKey),
      abortSignal: freshSignal('chart'),
      temperature: 0,
      maxTokens:   MAX_TOKENS,
      maxRetries:  1,
      schema:      dashboardSchema,
      messages:    [{ role: 'user', content: buildChartPrompt(rows, prompt, strategy, chartHint, source) }],
    });
    plan = object;
    log('chart:llm', `done in ${Date.now() - t0}ms | widgets: ${plan.widgets.length}`);
    logTrace('chart:llm', `plan`, plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('chart', `generateObject failed: ${msg}`);
    throw err;
  }

  const widgets = plan.widgets
    .slice(0, MAX_WIDGETS)
    .map((w, i) => ({ ...w, id: `w${i + 1}` }));

  return { layout: plan.layout, title: prompt, summary: plan.summary, widgets } as DashboardSpec;
}
