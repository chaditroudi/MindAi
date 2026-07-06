/**
 * Translators from raw MongoDB / validation errors into corrective prompts
 * ("hints") that are fed back to the planner LLM on retry.
 *
 * ⚠️  These strings are effectively prompts. They have been tuned against
 * real model behavior — treat any wording change as a behavior change and
 * re-verify retry success rates before shipping.
 */
import type { DataSource } from '../types';
import { ResolvedPipeline } from './pipeline.transform';

/** Names commonly embedded in integer fields that actually encode time. */
const TEMPORAL_NAME_TOKENS = ['year', 'month', 'date', 'day'];

function isStageStructureError(lower: string): boolean {
  return (
    lower.includes('pipeline stage') &&
    (lower.includes('exactly one') ||
      lower.includes('operator key') ||
      lower.includes('non-empty'))
  );
}

function isDateCoercionError(lower: string): boolean {
  return (
    lower.includes('only supports date') ||
    lower.includes('arguments to $date') ||
    lower.includes('coercible to date') ||
    (lower.includes('bson type') && lower.includes('date')) ||
    (lower.includes('convert') && lower.includes('to date'))
  );
}

/**
 * Builds a retry hint for a MongoDB *execution* failure, or `undefined`
 * when the error is not one we know how to coach the model through
 * (in which case the caller rethrows).
 *
 * @param onKnownError Invoked with a log line when a recognized-and-retryable
 *                     error class is hit, so the service can emit its
 *                     existing warn logs without this module owning a Logger.
 */
export function buildRetryHint(
  msg: string,
  lower: string,
  resolved: ResolvedPipeline,
  sources: DataSource[],
  onKnownError: (logMessage: string) => void,
): string | undefined {
  if (isStageStructureError(lower)) {
    return `Pipeline structure error: "${msg}". Each pipeline item must be exactly one MongoDB stage object like { "$match": { ... } }. Do not merge multiple stages into one object, and do not add commentary keys beside the stage operator.`;
  }

  if (lower.includes('unsupported conversion')) {
    return `MongoDB aggregation error: "${msg}". When converting integer/string fields to dates, always use $convert with onError: null and onNull: null, e.g. { $convert: { input: "$field", to: "date", onError: null, onNull: null } }.`;
  }

  if (lower.includes('exclusion') && lower.includes('inclusion projection')) {
    onKnownError(`retrying after MongoDB projection mix error`);
    return `MongoDB aggregation error: "${msg}". In a $project that includes fields (field: 1), you CANNOT also exclude nested fields like "<join>._id": 0 — MongoDB forbids mixing exclusion and inclusion except for the root "_id". Instead, add a separate $unset stage BEFORE $project to remove the joined _id: { "$unset": "<joinAlias>._id" }. Then $project only lists the fields you want (never exclude joined _id there).`;
  }

  if (isDateCoercionError(lower)) {
    const src = sources.find(
      (s) =>
        s.collection === resolved.collection || s.name === resolved.collection,
    );
    const intTemporalFields = (src?.fields ?? [])
      .filter(
        (f) =>
          (f.type === 'integer' || f.type === 'number') &&
          (f.role === 'temporal' ||
            TEMPORAL_NAME_TOKENS.some((t) =>
              f.name.toLowerCase().includes(t),
            )),
      )
      .map((f) => `"${f.name}" (stored as ${f.type}, NOT a Date)`)
      .join(', ');
    onKnownError(`retrying after MongoDB date-type error: ${msg}`);
    return (
      `MongoDB aggregation error: "${msg}". ` +
      (intTemporalFields
        ? `The temporal fields ${intTemporalFields} are plain integers, NOT Date objects. `
        : '') +
      `Do NOT use date extraction operators ($year, $month, $dayOfMonth, $dateToString, $dateToParts, $toDate, etc.) on integer or number fields. ` +
      `Instead, reference them directly as numbers: e.g., group by year using "$startYear" as the _id value.`
    );
  }

  return undefined;
}

/**
 * Builds a retry hint for a plan *validation* failure (bad structure or
 * unknown field references). Unlike execution errors, this always returns
 * a hint — validation failures are always worth one retry.
 */
export function buildPlanValidationHint(msg: string): string {
  const lower = msg.toLowerCase();
  if (isStageStructureError(lower)) {
    return `Pipeline structure failed: ${msg}. Each item in pipeline must be a single MongoDB stage object like { "$match": { ... } }. Do not combine multiple stages or attach extra descriptive keys.`;
  }
  return `Field validation failed: ${msg}. Use only the exact field names listed in the schema — check casing carefully.`;
}

/** Hint used when a syntactically valid pipeline matched zero rows. */
export function buildEmptyResultHint(pipeline: unknown[]): string {
  return (
    `The pipeline returned 0 rows: ${JSON.stringify(pipeline)}. ` +
    `The $match filter values may not match actual data — check enum values use exact casing from schema allowed values.`
  );
}

/** Hint used when the planner's structured output failed schema validation. */
export function buildPlannerOutputHint(msg: string): string {
  return (
    `Your previous response failed output validation: ${msg}. ` +
    `Re-read the required output shape and enum values exactly — ` +
    `"strategy" must be exactly one of: standard, trend, comparison, anomaly, overview.`
  );
}
