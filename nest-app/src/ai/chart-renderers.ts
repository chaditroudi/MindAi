import type { DataRow, Renderer, WidgetPlan } from '../types';
import {
  buildCategoricalSeries, findSeriesPoint, num, prepareRenderRows,
  resolveAxisField, resolveCategoryField, resolveNumericValueField,
  sortLineData, str, sumMatchingValues, uniqueStrings,
} from './chart-aggregation';

function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      typeof result[k] === 'object' && result[k] !== null && !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function mergeChartOptions(rendered: unknown, chartOptions: WidgetPlan['chartOptions']) {
  if (!rendered || !chartOptions) return rendered;
  const result = rendered as Record<string, unknown>;
  if (typeof result.option === 'object' && result.option !== null) {
    return { ...result, option: deepMerge(result.option as Record<string, unknown>, chartOptions) };
  }
  return rendered;
}

const widget = (plan: WidgetPlan, id: string, option: Record<string, unknown>) =>
  ({ id, type: plan.type, title: plan.title, insight: plan.insight, option });

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderBar(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  const labels = series.map(i => i.label);
  const values = series.map(i => i.value);
  const h = plan.type === 'horizontal_bar_chart';
  return widget(plan, id, {
    tooltip: { trigger: 'axis' },
    grid:    { containLabel: true, ...(h ? { left: '3%' } : {}) },
    xAxis:   h ? { type: 'value' } : { type: 'category', data: labels },
    yAxis:   h ? { type: 'category', data: labels.slice().reverse() } : { type: 'value' },
    series:  [{ type: 'bar', data: h ? values.slice().reverse() : values, itemStyle: { borderRadius: 4 } }],
  });
}

function renderMultiBar(plan: WidgetPlan, data: DataRow[], id: string, stacked: boolean) {
  const lf = resolveCategoryField(plan);
  if (!lf || !plan.valueField || !plan.seriesField) return null;
  const labels = uniqueStrings(data, lf);
  const groups = uniqueStrings(data, plan.seriesField);
  const series = groups.map(g => ({
    name: g, type: 'bar',
    ...(stacked ? { stack: 'total' } : {}),
    itemStyle: { borderRadius: stacked ? 0 : 2 },
    data: labels.map(l => sumMatchingValues(data, lf, l, plan.seriesField!, g, plan.valueField!)),
  }));
  return widget(plan, id, {
    tooltip: { trigger: 'axis' }, legend: { data: groups, top: 0 },
    xAxis: { type: 'category', data: labels }, yAxis: { type: 'value' }, series,
  });
}

function renderLine(plan: WidgetPlan, data: DataRow[], id: string) {
  const x = resolveAxisField(plan);
  if (!x || !plan.valueField) return null;
  const sorted = sortLineData(data, x);
  return widget(plan, id, {
    tooltip: { trigger: 'axis' },
    xAxis:   { type: 'category', data: sorted.map(r => str(r[x])) },
    yAxis:   { type: 'value' },
    series:  [{
      type: 'line', smooth: true,
      data: sorted.map(r => num(r[plan.valueField!])),
      ...(plan.type === 'area_chart' ? { areaStyle: {} } : {}),
    }],
  });
}

function renderMultiLine(plan: WidgetPlan, data: DataRow[], id: string) {
  const xf = resolveAxisField(plan);
  if (!xf || !plan.valueField || !plan.seriesField) return null;
  const sorted  = sortLineData(data, xf);
  const xValues = uniqueStrings(sorted, xf);
  const groups  = uniqueStrings(sorted, plan.seriesField);
  const series  = groups.map(g => ({
    name: g, type: 'line', smooth: true,
    data: xValues.map(xv => findSeriesPoint(sorted, xf, xv, plan.seriesField!, g, plan.valueField!)),
  }));
  return widget(plan, id, {
    tooltip: { trigger: 'axis' }, legend: { data: groups, top: 0 },
    xAxis: { type: 'category', data: xValues }, yAxis: { type: 'value' }, series,
  });
}

function renderDonut(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend:  { orient: 'vertical', left: 'left' },
    series:  [{ type: 'pie', radius: ['40%', '70%'], data: series.map(i => ({ name: i.label, value: i.value })) }],
  });
}

function renderScatter(plan: WidgetPlan, data: DataRow[], id: string) {
  if (!plan.xField || !plan.yField) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}' },
    xAxis:   { type: 'value', name: plan.xField },
    yAxis:   { type: 'value', name: plan.yField },
    series:  [{ type: 'scatter', symbolSize: 12,
                data: data.map(r => ({
                  name:  plan.labelField ? str(r[plan.labelField]) : '',
                  value: [num(r[plan.xField!]), num(r[plan.yField!])],
                })) }],
  });
}

function renderKpi(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  return { id, type: 'kpi_card' as const, title: plan.title, insight: plan.insight, value: num(data[0][vf]) };
}

function renderGauge(plan: WidgetPlan, data: DataRow[], id: string) {
  const vf = resolveNumericValueField(data, plan.valueField);
  if (!vf || !data.length) return null;
  const val = num(data[0][vf]);
  const max = val <= 1 ? 1 : val <= 100 ? 100 : Math.ceil(val * 1.2);
  return widget(plan, id, {
    series: [{ type: 'gauge', data: [{ value: val, name: plan.title }], min: 0, max }],
  });
}

function renderFunnel(plan: WidgetPlan, data: DataRow[], id: string) {
  const series = buildCategoricalSeries(plan, data);
  if (!series.length) return null;
  return widget(plan, id, {
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    series:  [{ type: 'funnel', data: series.map(s => ({ name: s.label, value: s.value })) }],
  });
}

function renderRadar(plan: WidgetPlan, data: DataRow[], id: string) {
  const lf = plan.labelField ?? plan.xField;
  if (!lf || !data.length) return null;
  const metrics = plan.columns?.length
    ? plan.columns
    : Object.keys(data[0]).filter(k => typeof data[0][k] === 'number').slice(0, 6);
  if (!metrics.length) return null;
  const entities = data.slice(0, 5).map(r => ({ name: str(r[lf]), value: metrics.map(m => num(r[m])) }));
  return widget(plan, id, {
    tooltip: {}, legend: { data: entities.map(e => e.name) },
    radar:   { indicator: metrics.map(m => ({ name: m })) },
    series:  [{ type: 'radar', data: entities }],
  });
}

function renderHeatmap(plan: WidgetPlan, data: DataRow[], id: string) {
  if (!plan.xField || !plan.yField || !plan.valueField) return null;
  const xVals    = uniqueStrings(data, plan.xField);
  const yVals    = uniqueStrings(data, plan.yField);
  const heatData: [number, number, number][] = data.map(r => [
    xVals.indexOf(str(r[plan.xField!])),
    yVals.indexOf(str(r[plan.yField!])),
    num(r[plan.valueField!]),
  ]);
  const maxVal = heatData.reduce((m, d) => Math.max(m, d[2]), 1);
  return widget(plan, id, {
    tooltip:   { position: 'top' },
    xAxis:     { type: 'category', data: xVals },
    yAxis:     { type: 'category', data: yVals },
    visualMap: { min: 0, max: maxVal, calculable: true, orient: 'horizontal', left: 'center', bottom: '15%' },
    series:    [{ type: 'heatmap', data: heatData, label: { show: true } }],
  });
}

export function renderTable(
  plan: Pick<WidgetPlan, 'type' | 'title' | 'insight' | 'columns'>,
  rows: DataRow[],
  id:   string,
) {
  const columns = plan.columns?.length ? plan.columns : Object.keys(rows[0] ?? {});
  return {
    id, type: 'table' as const, title: plan.title, insight: plan.insight, columns,
    rows: rows.slice(0, 100).map(r => Object.fromEntries(columns.map(c => [c, r[c]]))),
  };
}

function renderCustom(plan: WidgetPlan, _data: DataRow[], id: string) {
  return { id, type: 'custom' as const, title: plan.title, insight: plan.insight, option: {} };
}

export const RENDERERS: Record<string, Renderer> = {
  bar_chart:             renderBar,
  horizontal_bar_chart:  renderBar,
  grouped_bar_chart:     (p, d, i) => renderMultiBar(p, d, i, false),
  stacked_bar_chart:     (p, d, i) => renderMultiBar(p, d, i, true),
  line_chart:            renderLine,
  area_chart:            renderLine,
  multi_line_chart:      renderMultiLine,
  donut_chart:           renderDonut,
  scatter_plot:          renderScatter,
  kpi_card:              renderKpi,
  gauge_chart:           renderGauge,
  funnel_chart:          renderFunnel,
  radar_chart:           renderRadar,
  heatmap:               renderHeatmap,
  table:                 renderTable,
  custom:                renderCustom,
};
