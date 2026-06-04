import type { AgentSkill } from '../compose.js';

export const queryPlanningSkill: AgentSkill = {
  id: 'query-planning',
  name: 'MongoDB Query Planning',
  version: '1.0.0',
  description:
    'Expert rules for translating natural language questions into accurate MongoDB '
    + 'aggregation pipelines using only the schema provided.',
  applicableAgents: ['Supervisor Agent'],
  tags: ['mongodb', 'aggregation', 'pipeline', 'query', 'planning'],
  instructions: `
QUERY PLANNING — EXPERT RULES

SCHEMA DISCIPLINE
  • Only use field names exactly as listed in the datastore schema.
  • If the user mentions a concept not in the schema, find the closest matching field — do not invent one.
  • If no matching field exists, return the best available approximation with the data you have.
  • Enum fields: always match against one of the listed enumValues — never guess a value.

INTENT CLASSIFICATION
  • "how many", "count", "عدد", "كم"       → aggregation with $sum:1
  • "total", "sum", "مجموع", "إجمالي"      → aggregation with $sum:"$fieldName"
  • "average", "avg", "متوسط"               → aggregation with $avg:"$fieldName"
  • "show", "list", "find", "أعرض", "أظهر" → raw record fetch, no grouping, $limit:50
  • "top N", "أعلى N", "أكثر N"             → aggregation + $sort:{value:-1} + $limit:N
  • "trend", "over time", "خلال", "بمرور"   → group by temporal field (day/month/year)
  • "compare", "مقارنة"                     → group by two dimensions

PIPELINE BUILDING RULES
  1. Always start with $match if a filter is needed.
  2. Use $lookup only when a join is declared in "joins" or a field has "referenceTo".
     Follow $lookup with $unwind immediately.
  3. For grouping: $group → $project (to rename _id) → $sort → $limit.
  4. Project away _id in every output: always add { "$project": { "_id": 0 } }.
  5. Default $limit is 1000 for aggregations, 50 for raw record fetches.
  6. Never include tenantId in the pipeline — it is injected automatically.

TEMPORAL GROUPING
  • Group by day:   { "$dateToString": { "format": "%Y-%m-%d", "date": "$field" } }
  • Group by month: { "$dateToString": { "format": "%Y-%m", "date": "$field" } }
  • Group by year:  { "$dateToString": { "format": "%Y", "date": "$field" } }
  • Choose granularity from the time range: ≤3 months → day, ≤2 years → month, else → year.

FILTER BUILDING
  • String equality:    { "$match": { "field": "value" } }
  • Enum membership:    { "$match": { "field": { "$in": ["a", "b"] } } }
  • Date range:         { "$match": { "field": { "$gte": "YYYY-MM-DD", "$lte": "YYYY-MM-DD" } } }
  • Numeric comparison: { "$match": { "field": { "$gt": N } } }
  • Combine filters:    { "$match": { "$and": [ ...conditions ] } }

CHART HINT SELECTION
  • count/sum by one category → "compare" if rowCount ≤ 20, else "ranking"
  • count/sum over time → "trend"
  • part-of-whole / percentage → "part_of_whole"
  • top-N → "ranking"
  • geographic dimension → "geo"
  • distribution of numeric values → "distribution"
`,
};
