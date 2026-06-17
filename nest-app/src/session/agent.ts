import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolveModel } from '../ai/model';
import { readMarkdownSection, skillFile } from '../ai/skill-prompt';
import { executeDashboard } from '../features/dashboard';
import { executeReport } from '../features/report';
import { executeInquiry } from '../features/inquiry';

const INSTRUCTIONS = readMarkdownSection(skillFile('analytics', 'SKILL.md'), 'Runtime Prompt');

const analyticsInputSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

const buildDashboardTool = createTool({
  id:          'build-dashboard',
  description: 'Execute the full dashboard pipeline: aggregate data then build a multi-widget visualization.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }: { prompt: string }) => executeDashboard(prompt) as unknown as Promise<Record<string, unknown>>,
});

const generateReportTool = createTool({
  id:          'generate-report',
  description: 'Execute the full report pipeline: aggregate data then write a structured analytical report with sections and insights.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }: { prompt: string }) => executeReport(prompt) as Promise<Record<string, unknown>>,
});

const executeInquiryTool = createTool({
  id:          'execute-inquiry',
  description: 'Execute the full inquiry pipeline: aggregate data then return a concise factual answer.',
  inputSchema:  analyticsInputSchema,
  outputSchema: z.record(z.unknown()),
  execute: async ({ prompt }: { prompt: string }) => executeInquiry(prompt) as Promise<Record<string, unknown>>,
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
