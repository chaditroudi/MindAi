/**
 * Pure, side-effect-free helpers for shaping MongoDB aggregation pipelines
 * before execution. Everything in this file is deterministic and easily
 * unit-testable in isolation.
 */

/** A single MongoDB document / pipeline stage. */
export type Row = Record<string, unknown>;

/** A pipeline that has been validated and bound to a concrete collection. */
export interface ResolvedPipeline {
  pipeline: Row[];
  collection: string;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively hardens `$convert`-to-date expressions produced by the LLM.
 *
 * MongoDB throws on unparseable date inputs unless `onError` / `onNull`
 * are provided, so we default both to `null` when the planner omits them.
 * All other values pass through untouched.
 */
export function patchConvert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(patchConvert);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (
      '$convert' in obj &&
      obj['$convert'] !== null &&
      typeof obj['$convert'] === 'object'
    ) {
      const conv = { ...(obj['$convert'] as Record<string, unknown>) };
      if (conv['to'] === 'date' || conv['to'] === 4) {
        if (!('onError' in conv)) conv['onError'] = null;
        if (!('onNull' in conv)) conv['onNull'] = null;
      }
      return { ...obj, $convert: conv };
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, patchConvert(v)]),
    );
  }
  return value;
}

/**
 * Validates that a raw stage from the planner is a plain object containing
 * exactly one `$operator` key, and strips any stray commentary keys the
 * LLM may have attached beside it.
 *
 * @returns The cleaned single-operator stage plus the keys that were removed
 *          (surfaced by the caller as a warning log).
 * @throws  If the stage is not an object, is empty, or has zero / multiple
 *          operator keys. Error messages are 1-indexed for human readability
 *          and are fed back to the LLM verbatim as retry hints — do not
 *          reword them casually.
 */
export function normalizePipelineStage(
  stage: unknown,
  index: number,
): { stage: Row; strippedKeys: string[] } {
  if (!isPlainRecord(stage)) {
    throw new Error(`Pipeline stage ${index + 1} must be a plain object.`);
  }

  const keys = Object.keys(stage);
  if (!keys.length) {
    throw new Error(`Pipeline stage ${index + 1} must not be empty.`);
  }

  const operatorKeys = keys.filter((key) => key.startsWith('$'));
  if (!operatorKeys.length) {
    throw new Error(
      `Pipeline stage ${index + 1} must include exactly one MongoDB operator key starting with "$". ` +
        `Found keys: ${keys.join(', ')}.`,
    );
  }

  if (operatorKeys.length > 1) {
    throw new Error(
      `Pipeline stage ${index + 1} must contain exactly one MongoDB operator key. ` +
        `Found operators: ${operatorKeys.join(', ')}.`,
    );
  }

  const op = operatorKeys[0];
  return {
    stage: { [op]: stage[op] },
    strippedKeys: keys.filter((key) => key !== op),
  };
}

/**
 * Reconciles a user-supplied token limit with a per-stage ceiling.
 *
 * - No valid ceiling  → the user limit wins (may be undefined).
 * - No valid user limit → the ceiling wins.
 * - Both valid → the smaller of the two.
 */
export function clampStageTokens(
  limit: number | undefined,
  fallback: number,
): number | undefined {
  if (!Number.isFinite(fallback) || fallback <= 0) return limit;
  if (!Number.isFinite(limit) || (limit as number) <= 0) return fallback;
  return Math.min(Math.round(limit as number), Math.round(fallback));
}

/**
 * True when any top-level `$match` stage filters on a string value —
 * the usual culprit when a pipeline unexpectedly returns zero rows
 * (enum casing mismatches, etc.). Used to decide whether an empty
 * result set warrants a planner retry.
 */
export function hasStringMatch(pipeline: Row[]): boolean {
  return pipeline.some((stage) => {
    const match = stage['$match'] as Record<string, unknown> | undefined;
    if (!match) return false;
    return Object.values(match).some((v) => typeof v === 'string');
  });
}