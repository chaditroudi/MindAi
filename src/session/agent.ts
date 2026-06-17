import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveModel } from '../ai/model.js';
import { readMarkdownSection } from '../ai/skill-prompt.js';
import { executeDashboard } from '../features/dashboard.js';
import { executeReport } from '../features/report.js';
import { executeInquiry } from '../features/inquiry.js';

const INSTRUCTIONS = readMarkdownSection(
  new URL('../../skills/analytics/SKILL.md', import.meta.url),
  'Runtime Prompt',
);

const analyticsInputSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

const buildDashboardTool = createTool({
  id:          'build-dashboard',
  description: 'Execute the full dashboard pipeline: aggregate data then build a multi-widget visualization. Covers trend, comparison, anomaly detection, distribution, and executive overview.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }) => executeDashboard(prompt) as unknown as Promise<Record<string, unknown>>,
});

const generateReportTool = createTool({
  id:          'generate-report',
  description: 'Execute the full report pipeline: aggregate data then write a structured analytical report with sections and insights.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }) => executeReport(prompt) as Promise<Record<string, unknown>>,
});

const executeInquiryTool = createTool({
  id:          'execute-inquiry',
  description: 'Execute the full inquiry pipeline: aggregate data then return a concise factual answer. Use for direct questions, counts, rankings, specific values.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }) => executeInquiry(prompt) as Promise<Record<string, unknown>>,
});

export const analyticsAgent = new Agent({
  id:    'mind-analytics-agent',
  name:  'MindAnalyticsAgent',
  model: resolveModel('supervisor'),
  instructions: INSTRUCTIONS,
  tools: {
    buildDashboard: buildDashboardTool,
    generateReport: generateReportTool,
    executeInquiry: executeInquiryTool,
  },
});
