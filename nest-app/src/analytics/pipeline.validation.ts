/**
 * Guard-rails applied to LLM-generated aggregation pipelines before they
 * are allowed anywhere near MongoDB:
 *
 *  1. Forbidden-stage checks ($out, $merge, ... — configured in the
 *     aggregation skill file, not hard-coded here).
 *  2. Field-reference validation against the registered source schema,
 *     driven by declarative per-stage semantics from the same config.
 */
import type { DataSource } from '../types';
import { readJsonSection, skillFile } from '../ai/skill-prompt';
import type { Row } from './pipeline-transforms';

/** How field references inside one pipeline stage should be interpreted. */
interface StageBehavior {
  /** Top-level keys of this stage are field names to validate (e.g. $match). */
  validateKeys: boolean;
  /** Values may contain "$field" references to validate (e.g. $group). */
  walkValues: boolean;
  /** Top-level keys introduce NEW computed fields (e.g. $addFields). */
  computeKeys: boolean;
  /** When computing keys, "_id" is not a real output field (e.g. $group). */
  skipIdKey: boolean;
  /** Escape hatch for stages with bespoke shapes (currently: 'lookup'). */
  special?: string;
}

interface PipelineConfig {
  forbiddenStages: string[];
  stageSemantics: Record<string, StageBehavior>;
}

// Loaded once at module init, mirroring the previous behavior. A malformed
// skill file therefore fails fast at boot rather than mid-request.
const pipelineCfg = readJsonSection<PipelineConfig>(
  skillFile('aggregation', 'SKILL.md'),
  'Pipeline Config',
);

const FORBIDDEN_STAGES = new Set(pipelineCfg.forbiddenStages);
const STAGE_BEHAVIORS = pipelineCfg.stageSemantics;

/**
 * Throws if the pipeline uses a stage operator that is disallowed by
 * configuration (write stages, cross-collection escapes, etc.).
 */
export function assertNoForbiddenStages(pipeline: Row[]): void {
  for (const stage of pipeline) {
    const op = Object.keys(stage)[0];
    if (op && FORBIDDEN_STAGES.has(op)) {
      throw new Error(`Pipeline stage "${op}" is not permitted`);
    }
  }
}

/**
 * Walks every stage of the pipeline and verifies that each referenced field
 * either exists in the source's registered schema or was computed by an
 * earlier stage. Stage-specific rules (which keys are fields, which values
 * hold "$field" references, which keys CREATE fields) come from config, so
 * supporting a new operator is a config change, not a code change.
 *
 * @throws With a message listing the unknown fields alongside the full set
 *         of registered fields — this string doubles as the LLM retry hint.
 */
export function validatePipelineFields(
  pipeline: Row[],
  source: DataSource,
): void {
  const known = new Set([
    '_id',
    ...source.fields.filter((f) => !f.name.startsWith('$')).map((f) => f.name),
  ]);
  const computed = new Set<string>();
  const bad: string[] = [];

  const addBad = (name: string) => {
    if (name && !known.has(name) && !computed.has(name)) bad.push(name);
  };

  // Recursively collect "$field.path" references ("$$variables" are skipped).
  const walkRefs = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.startsWith('$') && !v.startsWith('$$')) {
        addBad(v.slice(1).split('.')[0]);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walkRefs);
    } else if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>))
        walkRefs(val);
    }
  };

  for (const stage of pipeline) {
    const op = Object.keys(stage)[0];
    const content = stage[op] as Record<string, unknown> | undefined;
    if (!op || !content) continue;

    const behavior = STAGE_BEHAVIORS[op];
    if (!behavior) {
      // Unknown stage: fall back to scanning values for field references.
      walkRefs(content);
    } else {
      if (behavior.validateKeys) {
        for (const k of Object.keys(content))
          if (!k.startsWith('$')) addBad(k.split('.')[0]);
      }
      if (behavior.walkValues) walkRefs(content);
      if (behavior.computeKeys) {
        for (const k of Object.keys(content))
          if (!behavior.skipIdKey || k !== '_id') computed.add(k);
      }
      if (behavior.special === 'lookup') {
        if (typeof content['localField'] === 'string')
          addBad(content['localField'].split('.')[0]);
        if (typeof content['as'] === 'string') computed.add(content['as']);
      }
    }
  }

  const unknown = [...new Set(bad)];
  if (!unknown.length) return;

  throw new Error(
    `Pipeline references field(s) not registered for "${source.name}": ` +
      `${unknown.map((f) => `"${f}"`).join(', ')}. ` +
      `Registered fields: ${[...known].map((f) => `"${f}"`).join(', ')}.`,
  );
}