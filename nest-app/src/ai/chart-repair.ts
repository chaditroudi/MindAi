import { log }                               from '../common/logger/app.logger';
import { CHART_BY_TYPE }                      from './chart-config';
import type { LlmWidget }                     from './chart-config';
import type { DataRow, RowProfile, WidgetPlan } from '../types';
import { isNumericLike, pickFields, resolveFieldName } from './chart-profile';

type ChartAgg = WidgetPlan['agg'];

function patchPlanField(plan: WidgetPlan, field: keyof WidgetPlan, value: string | undefined) {
  if (!value) return;
  if (plan[field] !== value) {
    log('chart:fix', `mapped ${String(field)}="${String(plan[field] ?? '-')}" → "${value}" for ${plan.type} "${plan.title}"`);
    (plan as unknown as Record<string, unknown>)[field] = value;
  }
}

function repairColumns(plan: WidgetPlan, profile: RowProfile) {
  if (plan.type === 'radar_chart') {
    const valid = (plan.columns ?? []).filter(col => profile.numeric.includes(col));
    plan.columns = valid.length ? valid : pickFields(profile, ['numeric'], [plan.labelField ?? ''], 6);
  } else if (plan.type === 'table') {
    const valid = (plan.columns ?? []).filter(col => profile.all.includes(col));
    plan.columns = valid.length ? valid : profile.all.slice(0, 6);
  }
}

function normalizeFields(w: LlmWidget): LlmWidget {
  const def = CHART_BY_TYPE[w.type];
  if (def?.requiresLabel && !w.labelField && w.xField) return { ...w, labelField: w.xField, xField: undefined };
  return w;
}

export function repairWidgetPlan(raw: LlmWidget, profile: RowProfile, _rows: DataRow[]): WidgetPlan {
  const { agg, ...rest } = normalizeFields(raw);
  const plan = { ...rest, ...(agg && agg !== 'none' ? { agg: agg as ChartAgg } : {}) } as WidgetPlan;

  switch (plan.type) {
    case 'line_chart':
    case 'area_chart':
      patchPlanField(plan, 'xField',      resolveFieldName(plan.xField,      profile, ['temporal', 'categorical'], [plan.valueField ?? '', plan.seriesField ?? '']));
      patchPlanField(plan, 'valueField',  resolveFieldName(plan.valueField,  profile, ['numeric'],                 [plan.xField ?? '', plan.seriesField ?? '']));
      break;
    case 'multi_line_chart':
      patchPlanField(plan, 'xField',      resolveFieldName(plan.xField,      profile, ['temporal', 'categorical'], [plan.seriesField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'seriesField', resolveFieldName(plan.seriesField, profile, ['categorical'],             [plan.xField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'valueField',  resolveFieldName(plan.valueField,  profile, ['numeric'],                 [plan.xField ?? '', plan.seriesField ?? '']));
      break;
    case 'scatter_plot': {
      const numeric = pickFields(profile, ['numeric'], [plan.labelField ?? ''], 2);
      patchPlanField(plan, 'xField',      resolveFieldName(plan.xField,      profile, ['numeric'], [plan.yField ?? '',   plan.labelField ?? '']) ?? numeric[0]);
      patchPlanField(plan, 'yField',      resolveFieldName(plan.yField,      profile, ['numeric'], [plan.xField ?? '',   plan.labelField ?? '']) ?? numeric[1]);
      patchPlanField(plan, 'labelField',  resolveFieldName(plan.labelField,  profile, ['categorical'], [plan.xField ?? '', plan.yField ?? '']));
      break;
    }
    case 'heatmap':
      patchPlanField(plan, 'xField',      resolveFieldName(plan.xField,      profile, ['categorical', 'temporal'], [plan.yField ?? '',     plan.valueField ?? '']));
      patchPlanField(plan, 'yField',      resolveFieldName(plan.yField,      profile, ['categorical', 'temporal'], [plan.xField ?? '',     plan.valueField ?? '']));
      patchPlanField(plan, 'valueField',  resolveFieldName(plan.valueField,  profile, ['numeric'],                 [plan.xField ?? '',     plan.yField ?? '']));
      break;
    case 'grouped_bar_chart':
    case 'stacked_bar_chart':
      patchPlanField(plan, 'labelField',  resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical', 'temporal'], [plan.seriesField ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'seriesField', resolveFieldName(plan.seriesField,               profile, ['categorical'],             [plan.labelField ?? '',  plan.valueField ?? '']));
      patchPlanField(plan, 'valueField',  resolveFieldName(plan.valueField,                profile, ['numeric'],                 [plan.labelField ?? '',  plan.seriesField ?? '']));
      plan.xField = undefined;
      break;
    case 'radar_chart':
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical'], []));
      repairColumns(plan, profile);
      break;
    case 'table':
      repairColumns(plan, profile);
      break;
    case 'kpi_card':
    case 'gauge_chart':
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'], []));
      break;
    default:
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical', 'temporal'], [plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField,                profile, ['numeric'],                 [plan.labelField ?? '']));
      plan.xField = undefined;
      break;
  }

  if (CHART_BY_TYPE[plan.type]?.requiresValue && plan.agg !== 'count' && !plan.valueField) {
    patchPlanField(plan, 'valueField',
      pickFields(profile, ['numeric'], [plan.labelField ?? '', plan.xField ?? '', plan.seriesField ?? '', plan.yField ?? ''], 1)[0],
    );
  }

  return plan;
}

export function planFieldProps(type: string): string[] {
  const def = CHART_BY_TYPE[type];
  return [...(def?.requiredFields ?? []), ...(def?.optionalPlanFields ?? [])];
}

export function getFieldValue(plan: WidgetPlan, prop: string): string | undefined {
  return (plan as unknown as Record<string, unknown>)[prop] as string | undefined;
}

export function validateWidget(
  w:       WidgetPlan,
  profile: RowProfile,
  rows:    DataRow[],
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const def = CHART_BY_TYPE[w.type];

  if (w.type === 'custom') return { ok: true, reasons };

  for (const prop of planFieldProps(w.type)) {
    const name = getFieldValue(w, prop);
    if (name && !profile.all.includes(name)) reasons.push(`${prop}="${name}" not in data`);
  }

  const isNumeric = (f: string) =>
    rows.slice(0, 20).some(r => r[f] != null) &&
    rows.slice(0, 20).every(r => r[f] == null || isNumericLike(r[f]));

  if (w.valueField && profile.all.includes(w.valueField) && w.agg !== 'count' && !isNumeric(w.valueField))
    reasons.push(`valueField "${w.valueField}" is not numeric-like`);
  if (def?.requiresAxis && !w.labelField && !w.xField)
    reasons.push('no axis field');
  if (def?.requiresSeries && !w.seriesField)
    reasons.push(`${w.type} requires seriesField`);
  if (def?.requiresXY && (!w.xField || !w.yField))
    reasons.push(`${w.type} requires xField and yField`);

  return { ok: reasons.length === 0, reasons };
}
