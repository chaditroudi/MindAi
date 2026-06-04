import type { AgentSkill } from '../compose.js';

export const chartSelectionSkill: AgentSkill = {
  id: 'chart-selection',
  name: 'Chart Selection',
  version: '1.0.0',
  description:
    'Decision rules for selecting the optimal chart type based on data shape, '
    + 'row count, schema composition, and supervisor hints.',
  applicableAgents: ['Chart Planner'],
  tags: ['chart', 'visualization', 'selection', 'data-shape'],
  instructions: `
CHART SELECTION — EXTENDED DECISION RULES

ROW COUNT THRESHOLDS
  • rowCount = 0          → never enter the planner; caller returns empty chart directly.
  • rowCount = 1          → single-value callout: prefer "donut" if schema has a string dim,
                            else fall back to first candidateType.
  • 2 ≤ rowCount ≤ 12     → categorical shapes (donut, bar) are preferred over line.
  • 13 ≤ rowCount ≤ 30    → horizontalBar over donut for string+numeric shapes.
  • rowCount > 30         → always use horizontalBar or line; never donut (too cluttered).

SUPERVISOR HINT PRECEDENCE
  • supervisorHints.intentHint overrides data-shape detection when set.
    - "ranking"       → horizontalBar, sorted descending by yAxisField.
    - "trend"         → line; abort if no temporal field exists (return first candidateType).
    - "compare"       → bar (vertical) if rowCount ≤ 20, else horizontalBar.
    - "part_of_whole" → donut if rowCount ≤ 12, else horizontalBar.
    - "distribution"  → histogram; yAxisField must equal xAxisField (frequency bucket).
    - "geo"           → map if a "geo" field exists, else fallback to horizontalBar.
  • suggestedXAxis / suggestedYAxis are strong hints: override only when the
    suggested field does not exist in datasetSchema.

GROUPBY SELECTION RULES
  • Only set groupByField when the schema has ≥2 string/boolean fields AND the
    secondary string field produces meaningful series (< 8 distinct values typical).
  • Never set groupByField equal to xAxisField or yAxisField.
  • If supervisorHints.suggestedGroupBy is set and exists in schema, prefer it
    over shape-derived logic.
  • For "ranking" intentHint: always omit groupByField.
  • For histogram: always omit groupByField.

MULTI-METRIC DISAMBIGUATION
  • When datasetSchema contains multiple numeric fields (e.g. "value", "benchmark",
    "percent"), set yAxisField to the primary metric:
    - prefer "value" > "count" > "total" > "sum" > "avg" > "rate" > "amount"
    - treat "percent" as secondary — use it as groupByField only if it is the
      supervisor's explicit suggestedGroupBy.
  • When a "benchmark" field is present alongside "value", use both as separate
    series by setting groupByField only when the chart supports multi-series
    (line, bar, horizontalBar — NOT donut, scatter, histogram).

FIELD EXCLUSION
  • Exclude from all axis/group fields: "_id", "tenantId", any field ending in "Id",
    any field starting with "__", and "benchmark" unless it is the supervisor's hint.

CONFLICT RESOLUTION
  • candidateTypes is the authoritative allowed list — never output a chartType
    outside this list, even if the shape or hint suggests one.
  • When shape logic and intentHint conflict, intentHint wins unless the required
    field type for that intent is absent (e.g. no temporal field for "trend").
  • When all decision rules still leave ambiguity, choose the first value in
    candidateTypes.
`,
};
