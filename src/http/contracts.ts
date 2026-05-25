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

export const inquiryResponseSchema = z.object({
  intent: z.literal('general_question'),
  summary: z.string(),
  recordLinks: z.array(recordLinkSchema),
  audit: z.object({
    plan: taskPlanSchema,
    enrichment: datasetSchema.optional(),
    elapsedMs: z.number(),
  }),
});

export const reportResponseSchema = z.object({
  intent: z.literal('report'),
  reportSections: z.array(reportSectionSchema),
  charts: z.array(chartResultSchema).optional(),
  audit: z.object({
    plan: taskPlanSchema,
    dataset: datasetSchema.optional(),
    elapsedMs: z.number(),
  }),
});

export const dashboardResponseSchema = z.object({
  intent: z.literal('dashboard'),
  chart: chartResultSchema,
  audit: z.object({
    plan: taskPlanSchema,
    pipeline: z.array(z.record(z.unknown())),
    schema: z.record(z.string()).optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    enrichment: datasetSchema.optional(),
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
});

export type PromptRequest = z.infer<typeof promptRequestSchema>;
export type InquiryResponse = z.infer<typeof inquiryResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type ReviewMetaResponse = z.infer<typeof reviewMetaSchema>;
