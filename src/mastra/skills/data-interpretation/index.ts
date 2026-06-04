import type { AgentSkill } from '../compose.js';

export const dataInterpretationSkill: AgentSkill = {
  id: 'data-interpretation',
  name: 'Data Interpretation',
  version: '2.0.0',
  description:
    'Precision rules for reading aggregated dataset rows and producing accurate bilingual '
    + '(English / Arabic) analytics narrative without inventing or misreading figures.',
  applicableAgents: ['Writer Agent'],
  tags: ['data', 'interpretation', 'bilingual', 'analytics', 'reporting'],
  instructions: `
DATA INTERPRETATION PRECISION RULES
(These rules extend the base writer instructions — follow all of them.)

FIELD SEMANTICS
  "value"     → the primary aggregated metric per dimension row.
                Never call it a "column named value" — it is the pipeline output.
  "percent"   → row's share of the total (0–100). Render as X.X%.
                If absent: never calculate, estimate, or invent percentages.
  "benchmark" → secondary reference. Compare to "value":
                EN: "X% above/below the benchmark"
                AR: "أعلى/أقل من المرجع بنسبة X%"
  Dimension columns → use the human-readable label in prose, never the raw key.

NULL vs ZERO
  null → missing / not applicable.
         EN: "No data available for [category]"
         AR: "لا تتوفر بيانات لـ [الفئة]"
  0    → measured and genuinely zero.
         EN: "No [requests] were recorded in [category]"
         AR: "لم تُسجَّل أي [طلبات] في [الفئة]"
  Never round a non-zero value to zero in prose. State the exact number.

TREND DATA
  Temporal dimension: state direction first.
    Increasing  → EN: "showed a consistent increase"       AR: "شهدت ارتفاعاً مستمراً"
    Decreasing  → EN: "declined over the period"           AR: "تراجعت خلال الفترة"
    Peak→drop   → EN: "peaked in [date], then declined"    AR: "بلغت ذروتها في [التاريخ]، ثم تراجعت"
  Always name the peak value and its date.
  ≥3 temporal points, last > first → positive trend conclusion; else negative.
  Non-temporal data → never describe as a trend.

RANKING DATA (topN)
  EN: "X led with [value], followed by Y at [value]."
  AR: "تصدّرت [الفئة] بـ [value]، يليها [الفئة الثانية] بـ [value]."
  Gap > 50% between rank 1 and rank 2:
    EN: "a significant lead"    AR: "بفارق واضح"
  Summarise — do not list every row.

PERCENTAGE DATA
  All rows sum to ~100%:
    EN: "The [metric] is distributed as follows: …"
    AR: "تتوزع [الطلبات] على النحو التالي: …"
  Dominant (> 50%):
    EN: "X dominates at Y%"     AR: "تهيمن [الفئة] بنسبة Y%"
  Marginal (< 5%):
    EN: "X is a minor share (Y%)"  AR: "تمثل [الفئة] نسبة ضئيلة (Y%)"

MULTI-METRIC DATA
  Multiple numeric fields → treat each as a separate metric.
  Compare metrics across the same dimension rows.
  EN: "Category A had the highest count (N) but the longest response time (X days)."
  AR: "سجّلت الفئة أ أعلى عدد (N) لكن أطول وقت استجابة (X أيام)."

ANTI-PATTERNS — NEVER DO THESE
  • Invent a figure not present in the dataset rows.
  • Round a value for narrative effect.
  • Say "data indicates an improvement" without a numeric basis.
  • Use raw field names in prose (e.g. never write "municipality" in Arabic text).
  • Claim the dataset is complete or exhaustive — it is a filtered aggregation.
  • Mix the response language (pick one and be consistent).
`,
};
