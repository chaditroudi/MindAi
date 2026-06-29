import { log }                                        from '../common/logger/app.logger';
import { CHART_BY_TYPE }                               from './chart-config';
import type { LlmWidget }                              from './chart-config';
import type { DataRow, RowProfile, WidgetPlan }        from '../types';
import type { FieldKind }                             from '../types';
import { isNumericLike, pickFields, resolveFieldName } from './chart-profile';

type ChartAgg = WidgetPlan['agg'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function patchPlanField(plan: WidgetPlan, field: keyof WidgetPlan, value: string | undefined) {
  if (!value) return;
  if (plan[field] !== value) {
    log('chart:fix', `mapped ${String(field)}="${String(plan[field] ?? '-')}" → "${value}" for ${plan.type} "${plan.title}"`);
    (plan as unknown as Record<string, unknown>)[field] = value;
  }
}

// Build the exclude list for a field from every other string-valued plan field.
function collectExcludes(plan: WidgetPlan, skipField: string): string[] {
  return Object.entries(plan)
    .filter(([k]) => k !== skipField && k !== 'type' && k !== 'title' && k !== 'insight' && k !== 'agg')
    .flatMap(([, v]) => (typeof v === 'string' ? [v] : []));
}

function repairColumns(plan: WidgetPlan, profile: RowProfile): void {
  if (plan.type === 'radar_chart') {
    const valid = (plan.columns ?? []).filter(col => profile.numeric.includes(col));
    plan.columns = valid.length ? valid : pickFields(profile, ['numeric'], [plan.labelField ?? ''], 6);
  } else if (plan.type === 'table') {
    const valid = (plan.columns ?? []).filter(col => profile.all.includes(col));
    plan.columns = valid.length ? valid : profile.all.slice(0, 6);
  }
}

// ── Special-case repair for the 4 types whose logic cannot be expressed as config ──

function repairSpecial(plan: WidgetPlan, profile: RowProfile): void {
  switch (plan.type) {
    case 'scatter_plot': {
      // Needs two *different* numeric fields — config roles alone cannot express the uniqueness constraint.
      const numeric = pickFields(profile, ['numeric'], [plan.labelField ?? ''], 2);
      patchPlanField(plan, 'xField',     resolveFieldName(plan.xField,     profile, ['numeric'],     [plan.yField    ?? '', plan.labelField ?? '']) ?? numeric[0]);
      patchPlanField(plan, 'yField',     resolveFieldName(plan.yField,     profile, ['numeric'],     [plan.xField    ?? '', plan.labelField ?? '']) ?? numeric[1]);
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField, profile, ['categorical'], [plan.xField    ?? '', plan.yField ?? '']));
      break;
    }
    case 'heatmap':
      // x and y must be *different* categoricals — same uniqueness problem as scatter.
      patchPlanField(plan, 'xField',     resolveFieldName(plan.xField,     profile, ['categorical', 'temporal'], [plan.yField     ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'yField',     resolveFieldName(plan.yField,     profile, ['categorical', 'temporal'], [plan.xField     ?? '', plan.valueField ?? '']));
      patchPlanField(plan, 'valueField', resolveFieldName(plan.valueField, profile, ['numeric'],                 [plan.xField     ?? '', plan.yField ?? '']));
      break;
    case 'radar_chart':
      // labelField is standard, but columns[] is an array repair — a different data shape.
      patchPlanField(plan, 'labelField', resolveFieldName(plan.labelField ?? plan.xField, profile, ['categorical'], []));
      repairColumns(plan, profile);
      break;
    case 'table':
      // No single field mapping — repairs a columns[] array.
      repairColumns(plan, profile);
      break;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function repairWidgetPlan(raw: LlmWidget, profile: RowProfile, _rows: DataRow[]): WidgetPlan {
  const { agg, ...rest } = raw;
  const plan = { ...rest, ...(agg && agg !== 'none' ? { agg: agg as ChartAgg } : {}) } as WidgetPlan;
  const def  = CHART_BY_TYPE[plan.type];

  // Pre-normalize: label-axis charts sometimes receive xField where labelField was expected.
  if (def?.requiresLabel && !plan.labelField && plan.xField) {
    plan.labelField = plan.xField;
    plan.xField     = undefined;
  }

  if (def?.fieldResolution) {
    // Generic resolution — roles come from SKILL.md, adding a new chart type here is config-only.
    for (const [field, roles] of Object.entries(def.fieldResolution)) {
      patchPlanField(
        plan,
        field as keyof WidgetPlan,
        resolveFieldName(
          (plan as unknown as Record<string, unknown>)[field] as string | undefined,
          profile,
          roles as FieldKind[],
          collectExcludes(plan, field),
        ),
      );
    }
    for (const f of def.clearFields ?? []) {
      (plan as unknown as Record<string, unknown>)[f] = undefined;
    }
  } else {
    repairSpecial(plan, profile);
  }

  // Post-fix: last-resort valueField fallback for requiresValue types.
  if (def?.requiresValue && plan.agg !== 'count' && !plan.valueField) {
    patchPlanField(
      plan,
      'valueField',
      pickFields(profile, ['numeric'], [plan.labelField ?? '', plan.xField ?? '', plan.seriesField ?? '', plan.yField ?? ''], 1)[0],
    );
  }

  return plan;
}

// ── Validation helpers (used by chart.ts) ─────────────────────────────────────

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
