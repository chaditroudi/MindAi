import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model.js';
import { inquiryTool, dashboardTool, reportTool } from '../tools/analytics.js';

export const supervisorAgent = new Agent({
  name:         'Supervisor Agent',
  model:        resolveModel('supervisor'),
  instructions: `
You are the analytics supervisor.
Read the user request and call exactly one tool — no exceptions.

Tool selection:
- build-dashboard  → chart, graph, visualize, plot, trend, distribution, compare
- generate-report  → report, analysis, detailed breakdown, insights
- execute-inquiry  → everything else (counts, averages, lists, lookups, "how many", "show me")

Rules:
- Always call exactly one tool.
- Never answer in plain text.
- Pass the request fields through unchanged.
`,
  tools: {
    [inquiryTool.id]:   inquiryTool,
    [dashboardTool.id]: dashboardTool,
    [reportTool.id]:    reportTool,
  },
});
