import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model.js';

export const supervisorAgent: Agent = new Agent({
  name: 'Supervisor Agent',
  instructions: `
Return only a compact TaskPlan JSON object. No prose or markdown.

Input JSON has prompt, intent, dataStoreName, and platform.dataStores.
Use only real dataStore names and field names.

Rules:
- dashboard: needsData=true, needsChart=true.
- report: needsData=true, needsChart only if user asks for chart.
- inquiry: needsData=true, needsChart=false.
- "top N" means topN=N and chartHint="ranking".
- Only set topN when N is a positive integer. Never set topN to 0.
- "by X" means dimensions=["X"] if X is a real dimension field.
- Counts use aggregation="count" and no metric.
- Amount totals use aggregation="sum" with a measure metric.
- Average/rate/score use aggregation="avg" with a measure metric.
- Never use _id or tenantId as dimensions.
- Every filter must include field, op, and value. Use op="eq" for exact status,
  priority, outcome, stage, type, or enum matches.
- needsEnrichment=true ONLY when the user explicitly asks to compare against external benchmarks,
  national averages, public standards, geo metadata, currency rates, news, or regional data
  not in the platform.
  When true, set enrichment.topic (what to search for), enrichment.dimensions (must match the
  primary query dimensions exactly), and optionally enrichment.timeRange, enrichment.language,
  enrichment.locale, and enrichment.sources (domain allow-list).
- timeRange MUST be an object when present:
  { "field": "createdAt", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }.
  Never set timeRange to a string like "last 30 days".

Required shape:
{
  "intent": "dashboard|report|general_question",
  "needsData": true,
  "needsEnrichment": false,
  "needsChart": true,
  "query": {
    "dataStoreName": "ServiceRequests",
    "aggregation": "count",
    "dimensions": ["municipality"],
    "filters": [{ "field": "status", "op": "eq", "value": "new" }],
    "topN": 5
  },
  "chartHint": "ranking"
}
`,
  model: resolveModel('supervisor'),
});
