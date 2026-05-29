import { z } from 'zod';
import { permissionScopeSchema } from '../mastra/schemas/datastore.js';
import { chartResultSchema } from '../mastra/schemas/chart.js';
import { datasetSchema, taskPlanSchema } from '../mastra/schemas/intent.js';

export const promptRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  scope: permissionScopeSchema,
  topic: z.string().trim().min(1).optional(),
  dataStoreName: z.string().trim().min(1).optional(),
  theme: z.enum(['light', 'dark', 'brand']).optional(),
  threadId: z.string().trim().min(1).max(200).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
});

export const conversationRefSchema = z.object({
  threadId: z.string(),
  resourceId: z.string(),
});

export const recordLinkSchema = z.object({
  collection: z.string(),
  id: z.string(),
  label: z.string(),
});

export const reportSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});

export const searchImpactSchema = z.object({
  status: z.enum(['not_requested', 'requested_no_results', 'used']),
  requested: z.boolean(),
  used: z.boolean(),
  rowCount: z.number().int().nonnegative(),
  citationCount: z.number().int().nonnegative(),
  effect: z.string(),
  source: z.string().optional(),
  topic: z.string().optional(),
  dimensions: z.array(z.string()).optional(),
});

export const inquiryResponseSchema = z.object({
  intent: z.literal('general_question'),
  summary: z.string(),
  recordLinks: z.array(recordLinkSchema),
  conversation: conversationRefSchema,
  audit: z.object({
    plan: taskPlanSchema,
    enrichment: datasetSchema.optional(),
    searchImpact: searchImpactSchema,
    elapsedMs: z.number(),
  }),
});

export const reportResponseSchema = z.object({
  intent: z.literal('report'),
  reportSections: z.array(reportSectionSchema),
  charts: z.array(chartResultSchema).optional(),
  conversation: conversationRefSchema,
  audit: z.object({
    plan: taskPlanSchema,
    dataset: datasetSchema.optional(),
    enrichment: datasetSchema.optional(),
    searchImpact: searchImpactSchema,
    elapsedMs: z.number(),
  }),
});

export const dashboardResponseSchema = z.object({
  intent: z.literal('dashboard'),
  chart: chartResultSchema,
  conversation: conversationRefSchema,
  audit: z.object({
    plan: taskPlanSchema,
    pipeline: z.array(z.record(z.unknown())),
    schema: z.record(z.string()).optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    enrichment: datasetSchema.optional(),
    searchImpact: searchImpactSchema,
    elapsedMs: z.number(),
  }),
});

export const reviewMetaSchema = z.object({
  app: z.object({
    title: z.string(),
    subtitle: z.string(),
    stack: z.array(z.string()),
  }),
  modes: z.array(
    z.object({
      endpoint: z.enum(['/api/dashboard', '/api/report', '/api/inquiry']),
      label: z.string(),
      description: z.string(),
      placeholder: z.string(),
      prompts: z.array(
        z.object({
          label: z.string(),
          prompt: z.string(),
          dataStoreName: z.string().optional(),
          topic: z.string().optional(),
        }),
      ),
    }),
  ),
  capabilities: z.object({
    done: z.array(z.string()),
    partial: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  agents: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      capabilities: z.array(z.string()),
      tools: z.array(z.string()),
      boundaries: z.array(z.string()),
    }),
  ),
});

export type PromptRequest = z.infer<typeof promptRequestSchema>;
export type InquiryResponse = z.infer<typeof inquiryResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type ReviewMetaResponse = z.infer<typeof reviewMetaSchema>;
