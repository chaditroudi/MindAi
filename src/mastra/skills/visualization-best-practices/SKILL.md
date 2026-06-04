# Skill: Visualization Best Practices

**ID:** `visualization-best-practices`
**Version:** 1.0.0
**Applicable Agents:** Chart Planner

---

## Purpose

Ensures every chart produced by the Chart Planner meets the platform's standards for
clarity, accessibility, and correct representation of Arabic-language analytics data.

---

## When It Applies

Load this skill whenever the Chart Planner agent generates a chart title or decides
on field assignments that affect how the chart will be rendered.

---

## What It Provides

- Arabic title formatting rules (concise, RTL-aware, no redundant labels)
- Accessibility requirements (meaningful titles, readable descriptions)
- Guidance on when NOT to set a groupByField (avoiding overplotting)
- Labeling conventions for time-series axes
- Rules for charts with percentage or normalized data

---

## Skill Does NOT Handle

- Chart type selection → see `chart-selection`
- Colour palette, theme, data zoom → controlled by `chart-runtime.ts` render options
- ECharts option generation → handled by `chart-tools.ts`

---

## Maintained By

Mind Platform Analytics Team
