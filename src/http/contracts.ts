import { z } from 'zod';
import { permissionScopeSchema, dataStoreSchema } from '../mastra/schemas/datastore.js';
import { chartResultSchema } from '../mastra/schemas/chart.js';
import { datasetSchema, taskPlanSchema } from '../mastra/schemas/intent.js';

const schemaStructureFieldSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  desc: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

const schemaStructureCollectionSchema = z.object({
  collection: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  fields: z.array(schemaStructureFieldSchema).min(1),
});

export const promptRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  scope: permissionScopeSchema,
  topic: z.string().trim().min(1).optional(),
  dataStoreName: z.string().trim().min(1).optional(),
  theme: z.enum(['light', 'dark', 'brand']).optional(),
  threadId: z.string().trim().min(1).max(200).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
  datastores: z.array(dataStoreSchema).min(1).optional(),
  schemaStructure: z.array(schemaStructureCollectionSchema).min(1).optional(),
  dataset: datasetSchema.optional(),
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

export const inquiryResponseSchema = z.object({
  intent: z.literal('general_question'),
  summary: z.string(),
  recordLinks: z.array(recordLinkSchema),
  conversation: conversationRefSchema,
  audit: z.object({
    plan: taskPlanSchema,
    dataset: datasetSchema.optional(),
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
    dataset: datasetSchema.optional(),
    schema: z.record(z.string()).optional(),
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

export const searchResponseSchema = z.object({
  intent: z.literal('search'),
  summary: z.string(),
  searchTerms: z.array(z.string()),
  recordLinks: z.array(recordLinkSchema),
  conversation: conversationRefSchema,
  audit: z.object({
    collection: z.string(),
    elapsedMs: z.number(),
  }),
});

// ─── History schemas ──────────────────────────────────────────────────────────

export const historyResultSchema = z.object({
  summary: z.string().optional(),
  chart: z.record(z.unknown()).optional(),
  reportSections: z.array(z.object({ heading: z.string(), body: z.string() })).optional(),
  recordLinks: z.array(recordLinkSchema).optional(),
  searchTerms: z.array(z.string()).optional(),
  rows: z.array(z.record(z.unknown())).optional(),
});

export const historyEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  intent: z.enum(['general_question', 'report', 'dashboard', 'search']),
  prompt: z.string(),
  pipeline: z.array(z.record(z.unknown())).optional(),
  result: historyResultSchema,
  durationMs: z.number(),
  createdAt: z.string(),
});

export const historyListResponseSchema = z.object({
  entries: z.array(historyEntrySchema),
  total: z.number(),
  limit: z.number(),
  skip: z.number(),
});

export const historyQuerySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  intent: z.enum(['general_question', 'report', 'dashboard', 'search']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export type PromptRequest = z.infer<typeof promptRequestSchema>;
export type InquiryResponse = z.infer<typeof inquiryResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HistoryListResponse = z.infer<typeof historyListResponseSchema>;
export type ReviewMetaResponse = z.infer<typeof reviewMetaSchema>;
