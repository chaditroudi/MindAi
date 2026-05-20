import type { Mastra } from '@mastra/core/mastra';
import { z } from 'zod';
import { blueprintRepo } from '../../db/blueprint.repository.js';
import { log, logged } from '../../observability/log.js';
import type { PermissionScope } from '../../types/index.js';
import { datasetSchema, taskPlanSchema } from '../schemas/intent.js';
import {
  buildAggregationFromPlan,
  executePipeline,
  validateRows,
} from '../tools/mongodb-tools.js';

/**
 * mongodb-runtime
 *
 * Bridge between workflow steps and the MongoDB Agent.
 *
 * Architectural pattern (matches chart-runtime.ts):
 *
 *   1. Always execute the safety-critical query deterministically through the
 *      tools (buildAggregationFromPlan -> executePipeline -> validateRows).
 *      This guarantees the tenant guard is on, the pipeline is well-formed,
 *      and we always have an authoritative dataset.
 *
 *   2. Optionally invoke the MongoDB Agent (LLM-driven) to refine the result:
 *      audit notes about field resolution, concerns, suggested plan repairs.
 *      The agent's output AUGMENTS the deterministic output - it cannot
 *      override rows or schema. This preserves correctness even if the LLM
 *      hallucinates.
 *
 *   3. The agent is invoked only when a Mastra instance is provided AND the
 *      OPENROUTER_API_KEY is set. Otherwise the runtime returns the
 *      deterministic result unchanged. This keeps local dev, smoke tests,
 *      and degraded-LLM scenarios working.
 */

// Structured output the agent must return (mirrors the agent's instructions).
const mongoAgentOutputSchema = z.object({
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  schema: z.record(z.string()),
  pipeline: z.array(z.record(z.unknown())),
  rowCount: z.number(),
  collection: z.string(),
  notes: z.array(z.string()),
});

type MongoAgentOutput = z.infer<typeof mongoAgentOutputSchema>;

export async function runMongoDatasetQuery({
  plan,
  scope,
  mastra,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
  mastra?: Mastra;
}) {
  const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };

  if (!plan.needsData || !plan.query.blueprintId || !plan.query.dataStoreName) {
    return {
      dataset: empty,
      executedPipeline: [] as Record<string, unknown>[],
      agentNotes: [] as string[],
    };
  }

  const dataStore = await blueprintRepo.findDataStore(plan.query.blueprintId, plan.query.dataStoreName);
  if (!dataStore) {
    throw new Error(
      `Data store '${plan.query.dataStoreName}' not found on blueprint '${plan.query.blueprintId}'.`,
    );
  }

  // 1) Deterministic execution path (always runs - this is the source of truth).
  const { pipeline } = await logged(
    'mongo.build-aggregation',
    { agent: 'mongodbAgent', tenantId: scope.tenantId, collection: dataStore.collection },
    async () => buildAggregationFromPlan({ plan, dataStore, scope }),
  );
  const executed = await logged(
    'mongo.execute-pipeline',
    { agent: 'mongodbAgent', tenantId: scope.tenantId, collection: dataStore.collection },
    async () => executePipeline({ pipeline, collection: dataStore.collection, scope }),
  );
  const validated = validateRows({ rows: executed.rows, dataStore });

  log.info('mongo.dataset-ready', {
    agent: 'mongodbAgent',
    tenantId: scope.tenantId,
    collection: dataStore.collection,
    rowCount: validated.rows.length,
  });

  // 2) Optional agent-assisted audit (notes only - never overrides data).
  const agentResult = await tryRunMongoAgent({
    mastra,
    plan,
    scope,
    dataStore,
  });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      source: 'mongodb' as const,
    },
    executedPipeline: pipeline,
    agentNotes: agentResult?.notes ?? [],
  };
}

export async function runMongoRecordFetch({
  plan,
  scope,
}: {
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
}) {
  const empty: z.infer<typeof datasetSchema> = { rows: [], schema: {}, source: 'mongodb' };

  if (!plan.needsData || !plan.query.blueprintId || !plan.query.dataStoreName) {
    return {
      dataset: empty,
      collection: undefined as string | undefined,
    };
  }

  const dataStore = await blueprintRepo.findDataStore(plan.query.blueprintId, plan.query.dataStoreName);
  if (!dataStore) {
    throw new Error(
      `Data store '${plan.query.dataStoreName}' not found on blueprint '${plan.query.blueprintId}'.`,
    );
  }

  // Record-fetch mode: strip aggregation and dimensions so we get raw documents
  // instead of grouped rows. Tenant guard + filters + time range still apply.
  const rawPlan = {
    ...plan,
    query: {
      ...plan.query,
      aggregation: undefined,
      dimensions: [],
    },
  };

  const { pipeline } = buildAggregationFromPlan({ plan: rawPlan, dataStore, scope });
  const executed = await executePipeline({
    pipeline,
    collection: dataStore.collection,
    scope,
  });
  const validated = validateRows({ rows: executed.rows, dataStore });

  return {
    dataset: {
      rows: validated.rows,
      schema: validated.schema,
      source: 'mongodb' as const,
    },
    collection: dataStore.collection,
  };
}

/**
 * Invoke the MongoDB Agent. Returns its structured output, or null if the
 * agent isn't available or fails. Failures here are NEVER fatal: the
 * deterministic path is the source of truth.
 */
async function tryRunMongoAgent({
  mastra,
  plan,
  scope,
  dataStore,
}: {
  mastra?: Mastra;
  plan: z.infer<typeof taskPlanSchema>;
  scope: PermissionScope;
  dataStore: Awaited<ReturnType<typeof blueprintRepo.findDataStore>>;
}): Promise<MongoAgentOutput | null> {
  if (!mastra) return null;
  if (!process.env.OPENROUTER_API_KEY?.trim()) return null;

  try {
    const agent = mastra.getAgent('mongodbAgent');
    if (!agent) return null;

    return await logged(
      'mongo.agent.generate',
      { agent: 'mongodbAgent', tenantId: scope.tenantId },
      async () => {
        const result = await agent.generate(
          [
            {
              role: 'user',
              content: JSON.stringify({
                plan,
                scope: {
                  userId: scope.userId,
                  tenantId: scope.tenantId,
                  allowedBlueprintIds: scope.allowedBlueprintIds,
                  rowFilter: scope.rowFilter,
                },
                dataStore,
              }),
            },
          ],
          { output: mongoAgentOutputSchema, maxTokens: 1400 },
        );
        return result.object;
      },
    );
  } catch {
    // Agent failures are non-fatal: deterministic path already produced data.
    log.warn('mongo.agent.skipped', { agent: 'mongodbAgent', reason: 'agent-error-or-invalid-output' });
    return null;
  }
}
