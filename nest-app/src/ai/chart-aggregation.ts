import type { DataRow, WidgetPlan } from '../types';

export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
export const str = (v: unknown): string => (v == null ? '' : String(v));

export function resolveCategoryField(plan: Pick<WidgetPlan, 'labelField' | 'xField'>) {
  return plan.labelField ?? plan.xField;
}

export function resolveAxisField(plan: Pick<WidgetPlan, 'labelField' | 'xField'>) {
  return plan.xField ?? plan.labelField;
}

export function uniqueStrings(rows: DataRow[], field: string) {
  return [...new Set(rows.map(r => str(r[field])))];
}

export function resolveNumericValueField(data: DataRow[], valueField?: string) {
  return valueField ?? Object.keys(data[0] ?? {}).find(k => typeof data[0]?.[k] === 'number');
}

export function sumMatchingValues(
  rows: DataRow[], lf: string, label: string, sf: string, group: string, vf: string,
) {
  return rows.reduce((s, r) => (str(r[lf]) === label && str(r[sf]) === group ? s + num(r[vf]) : s), 0);
}

export function findSeriesPoint(
  rows: DataRow[], xf: string, xv: string, sf: string, group: string, vf: string,
) {
  const r = rows.find(row => str(row[xf]) === xv && str(row[sf]) === group);
  return r != null ? num(r[vf]) : null;
}

export function prepareRenderRows(plan: WidgetPlan, rows: DataRow[]) {
  const data = [...rows];
  if (plan.sortDesc && plan.valueField && !plan.agg) {
    data.sort((a, b) => num(b[plan.valueField!]) - num(a[plan.valueField!]));
  }
  if (plan.topN && !plan.agg) return data.slice(0, plan.topN);
  return data;
}

function buildDirectSeries(rows: DataRow[], lf: string, vf?: string) {
  if (!vf) return [];
  return rows.map(r => ({ label: str(r[lf]), value: num(r[vf]) })).filter(i => i.label);
}

function aggregateValues(vals: number[], agg: WidgetPlan['agg']) {
  if (!vals.length || !agg) return Number.NaN;
  if (agg === 'count') return vals.length;
  if (agg === 'sum')   return vals.reduce((a, b) => a + b, 0);
  if (agg === 'avg')   return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (agg === 'min')   return Math.min(...vals);
  return Math.max(...vals);
}

export function aggregateByLabel(rows: DataRow[], lf: string, agg: WidgetPlan['agg'], vf?: string) {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const label = str(row[lf]).trim();
    if (!label) continue;
    let vals = buckets.get(label);
    if (!vals) buckets.set(label, (vals = []));
    if (agg === 'count') vals.push(1);
    else if (vf) { const v = num(row[vf]); if (Number.isFinite(v)) vals.push(v); }
  }
  return [...buckets.entries()]
    .map(([label, vals]) => ({ label, value: aggregateValues(vals, agg) }))
    .filter(i => Number.isFinite(i.value));
}

export function buildCategoricalSeries(plan: WidgetPlan, rows: DataRow[]) {
  const lf = resolveCategoryField(plan);
  if (!lf) return [];
  const series = plan.agg
    ? aggregateByLabel(rows, lf, plan.agg, plan.valueField)
    : buildDirectSeries(rows, lf, plan.valueField);
  if (!series.length) return [];
  const sorted = plan.sortDesc ? [...series].sort((a, b) => b.value - a.value) : series;
  return plan.topN ? sorted.slice(0, plan.topN) : sorted;
}

function detectAxisMode(rows: DataRow[], field: string): 'number' | 'date' | 'preserve' {
  const vals = rows.map(r => r[field]).filter(v => v != null);
  if (!vals.length) return 'preserve';
  if (vals.every(v => v !== '' && Number.isFinite(Number(v)))) return 'number';
  if (vals.every(v => !Number.isNaN(new Date(String(v)).getTime()))) return 'date';
  return 'preserve';
}

function compareAxisValue(a: unknown, b: unknown, mode: 'number' | 'date') {
  return mode === 'number'
    ? Number(a) - Number(b)
    : new Date(String(a)).getTime() - new Date(String(b)).getTime();
}

export function sortLineData(rows: DataRow[], field: string) {
  const mode = detectAxisMode(rows, field);
  if (mode === 'preserve') return [...rows];
  return [...rows].sort((a, b) => compareAxisValue(a[field], b[field], mode));
}
