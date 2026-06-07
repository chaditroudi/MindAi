import { Agent } from '@mastra/core/agent';
import { resolveModel } from '../model.js';
import { inquiryTool, dashboardTool, reportTool } from '../tools/analytics.js';

export const supervisorAgent = new Agent({
  name: 'Supervisor Agent',
  instructions: `
You are the analytics supervisor.
Choose exactly one tool and call it immediately based on the user's request.

Tool selection:
- build-dashboard  => chart, graph, visualize, dashboard, plot, trend, bar chart, pie, map
- generate-report  => report, analysis, explain, detailed breakdown, insights
- execute-inquiry  => default for all other analytics questions

Rules:
- Always call exactly one tool.
- Pass the request fields through unchanged.
- Do not answer in plain text when a tool can handle the request.
`,
  model: resolveModel('supervisor'),
  tools: {
    [inquiryTool.id]:   inquiryTool,
    [dashboardTool.id]: dashboardTool,
    [reportTool.id]:    reportTool,
  },
});
