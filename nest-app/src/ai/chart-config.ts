import { z }                          from 'zod';
import { readJsonSection, skillFile } from './skill-prompt';

export interface ChartDefinition {
  type:                string;
  requiredFields:      string[];
  optionalFields:      string[];
  optionalPlanFields?: string[];
  llmHidden?:          boolean;
  requiresAxis?:       boolean;
  requiresLabel?:      boolreean;
  requiresSeries?:     boolean;
  requiresXY?:         boolean;
  requiresValue?:      boolean;
}

interface SkillConfig {
  aggregations: string[];
  layouts:      string[];
  types:        ChartDefinition[];
}

const cfg = readJsonSection<SkillConfig>(skillFile('chart', 'SKILL.md'), 'Chart Config');

function assertNonEmpty(arr: string[], label: string): [string, ...string[]] {
  if (!arr.length) throw new Error(`SKILL.md: "${label}" must have at least one entry`);
  return arr as [string, ...string[]];
}

export const CHART_DEFINITIONS: readonly ChartDefinition[] = cfg.types;
export const CHART_AGGREGATIONS     = assertNonEmpty(cfg.aggregations, 'aggregations');
export const LLM_CHART_AGGREGATIONS = [...CHART_AGGREGATIONS, 'none'] as [string, ...string[]];
export const DASHBOARD_LAYOUTS      = assertNonEmpty(cfg.layouts, 'layouts');
export const CHART_BY_TYPE          = Object.fromEntries(cfg.types.map(d => [d.type, d])) as Record<string, ChartDefinition>;

function getLlmChartTypes(): [string, ...string[]] {
  return assertNonEmpty(cfg.types.filter(d => !d.llmHidden).map(d => d.type), 'visible chart types');
}

export const chartOptionsSchema = z.record(z.unknown()).optional();

export const widgetSchema = z.object({
  type:         z.enum(getLlmChartTypes()),
  title:        z.string(),
  insight:      z.string().optional(),
  labelField:   z.string().optional(),
  valueField:   z.string().optional(),
  xField:       z.string().optional(),
  yField:       z.string().optional(),
  seriesField:  z.string().optional(),
  columns:      z.array(z.string()).optional(),
  agg:          z.enum(LLM_CHART_AGGREGATIONS).optional(),
  sortDesc:     z.boolean().optional(),
  topN:         z.number().int().positive().optional(),
  chartOptions: chartOptionsSchema,
});

export const dashboardSchema = z.object({
  layout:  z.enum(DASHBOARD_LAYOUTS),
  summary: z.string(),
  widgets: z.array(widgetSchema).min(1),
});

export type LlmWidget    = z.infer<typeof widgetSchema>;
export type LlmDashboard = z.infer<typeof dashboardSchema>;
