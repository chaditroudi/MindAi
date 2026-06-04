# Skill: Chart Selection

**ID:** `chart-selection`
**Version:** 1.0.0
**Applicable Agents:** Chart Planner

---

## Purpose

Guides the Chart Planner agent in selecting the most appropriate chart type for a given dataset.
This skill encodes decision rules that go beyond raw data-shape matching — it covers edge cases,
mixed-type schemas, small/large row counts, and supervisor hint precedence.

---

## When It Applies

Load this skill whenever the Chart Planner agent must choose a `chartType` from
`candidateTypes` given a `datasetSchema` and `sampleRows`.

---

## What It Provides

- Decision rules for each data shape (temporal, categorical, geo, numeric-only)
- Edge-case handling (0 rows, 1 row, >50 rows, single-value datasets)
- Priority rules when `supervisorHints` conflict with data-shape logic
- Guidance on when to override a candidate type in favour of a better fit
- Rules for `groupByField` selection to avoid incorrect multi-series charts

---

## Skill Does NOT Handle

- Rendering configuration (colours, axes, labels) → see `visualization-best-practices`
- Pipeline construction or field resolution → handled by MongoDB Agent and tools
- ECharts option building → handled by `chart-tools.ts`

---

## Maintained By

Mind Platform Analytics Team
