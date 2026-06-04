import type { AgentSkill } from '../compose.js';

export const visualizationBestPracticesSkill: AgentSkill = {
  id: 'visualization-best-practices',
  name: 'Visualization Best Practices',
  version: '1.0.0',
  description:
    'Ensures chart titles, field assignments, and structural choices meet '
    + 'the platform\'s Arabic-language accessibility and clarity standards.',
  applicableAgents: ['Chart Planner'],
  tags: ['visualization', 'accessibility', 'arabic', 'best-practices', 'chart'],
  instructions: `
VISUALIZATION BEST PRACTICES

TITLE RULES (Arabic)
  • Title must be concise: ≤ 8 words.
  • Derive the title from userPrompt — extract the subject, not the question.
    Example: "أعلى 5 بلديات حسب عدد الطلبات" (not "ما هي أعلى البلديات؟")
  • For "top N" queries, include the N: "أعلى 5 بلديات"
  • For time-range queries, include the period: "الطلبات خلال 2024"
  • For comparison charts, include both dimensions: "مقارنة الطلبات حسب النوع والبلدية"
  • Never echo the raw field name in the title — use the human label if available.
  • Always write the title in Arabic, right-to-left.

FIELD ASSIGNMENT CLARITY
  • xAxisField for a temporal field → do not also set it as groupByField.
  • When rowCount = 1 and chartType = "donut", both xAxisField and yAxisField
    must still be set (the builder needs them even for single-slice donuts).
  • For scatter charts, xAxisField and yAxisField must both be numeric/integer.
    If the schema has a string dimension, it becomes groupByField only.
  • For histogram, xAxisField = yAxisField = the single numeric bucket field.
    Do not set groupByField for histograms.

OVERPLOTTING PREVENTION
  • Never set groupByField when the secondary string dimension has > 10 known
    distinct values (high cardinality kills readability).
  • For line charts with groupByField, the chart will render one line per group.
    Only set groupByField when ≤ 6 distinct group values are expected.
  • Prefer horizontalBar over bar when xAxisField dimension labels are long
    (Arabic city/region names are typically long — default to horizontalBar for
    string+numeric shapes when rowCount > 5).

PERCENTAGE DATA
  • When schema contains "percent", do NOT use it as yAxisField unless
    supervisorHints.suggestedYAxis explicitly requests it.
  • "percent" is a supplementary field — the primary metric is "value".
  • Exception: supervisorHints.intentHint = "part_of_whole" → donut with yAxis="percent".

ACCESSIBILITY
  • Title must be meaningful and describe the data shown (not just the chart type).
    ✓ "توزيع الطلبات حسب الحالة"
    ✗ "مخطط دائري"
  • Avoid titles that are identical to axis labels.
`,
};
