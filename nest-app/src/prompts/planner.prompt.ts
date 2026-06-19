import { interpolateTemplate, readMarkdownSection, skillFile } from '../ai/skill-prompt';
import { normalizeToken } from '../sources/source.repository';
import type { DataSource, DataSourceField, IntentKind } from '../types';

const AGGREGATION_SKILL_FILE     = skillFile('aggregation', 'SKILL.md');
const AGGREGATION_PROMPT_BASE    = readMarkdownSection(AGGREGATION_SKILL_FILE, 'Runtime Prompt');
const AGGREGATION_PROMPT_DASH    = readMarkdownSection(AGGREGATION_SKILL_FILE, 'Runtime Prompt Dashboard');
const AGGREGATION_PROMPT_NONDASH = readMarkdownSection(AGGREGATION_SKILL_FILE, 'Runtime Prompt Non-Dashboard');
const FALLBACK_STRATEGIES        = ['standard', 'trend', 'comparison', 'anomaly', 'overview'];

function uniq(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean))];
}

function extractStrategyValues(section: string): string[] {
  const lines = section.split('\n');
  const start = lines.findIndex(line => line.trim().startsWith('STRATEGY'));
  if (start === -1) return FALLBACK_STRATEGIES;

  const values: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) break;

    const match = /^([a-z][a-z0-9_-]*)\s+→/iu.exec(trimmed);
    if (match?.[1]) values.push(match[1]);
  }

  return uniq(values).length ? uniq(values) : FALLBACK_STRATEGIES;
}

export const PLANNER_STRATEGIES      = extractStrategyValues(AGGREGATION_PROMPT_DASH);
export const PLANNER_DEFAULT_STRATEGY = PLANNER_STRATEGIES[0] ?? 'standard';

function fieldDesc(f: DataSourceField): string | undefined {
  return f.description ?? (f as unknown as Record<string, unknown>)['desc'] as string | undefined;
}

function resolveReference(field: DataSourceField, sources: DataSource[]): DataSource | undefined {
  const desc = fieldDesc(field)?.toLowerCase() ?? '';
  const fn   = field.name.toLowerCase();

  if (field.referenceTo) {
    return sources.find(s => s.name === field.referenceTo || s.collection === field.referenceTo);
  }

  const byDesc = /reference| id|ref /.test(desc)
    && sources.find(s => desc.includes(s.name.toLowerCase()) || desc.includes(s.collection.toLowerCase()));
  if (byDesc) return byDesc;

  return sources.find(s => {
    const col = s.collection.toLowerCase().replace(/s$/, '');
    const nm  = s.name.toLowerCase().replace(/s$/, '');
    return col.startsWith(fn) || nm.startsWith(fn) || fn.startsWith(col) || fn.startsWith(nm);
  });
}

function buildSchemaSection(sources: DataSource[]): string {
  if (!sources.length) return '\nNo data sources — return needsData=false.';

  const lines: string[] = [
    '',
    '══════════════════════════════════════════════════════════',
    'YOUR DATABASE SCHEMA',
    '  Every "$fieldName" in the pipeline MUST appear here.',
    '  Never use a name from the user prompt — only names listed below.',
    '══════════════════════════════════════════════════════════',
  ];

  for (const source of sources) {
    const refByField = new Map(source.fields.map(f => [f, resolveReference(f, sources)]));

    const dims     = source.fields.filter(f => f.type === 'string' || f.type === 'enum' || f.type === 'text');
    const metrics  = source.fields.filter(f => f.type === 'number' || f.type === 'integer');
    const temporal = source.fields.filter(f =>
      f.type === 'date' || f.type === 'datetime' || f.role === 'temporal' ||
      ['year', 'month', 'quarter', 'date'].some(t => f.name.toLowerCase().includes(t)),
    );
    const refFields = source.fields
      .map(f => ({ field: f, target: refByField.get(f) }))
      .filter((x): x is { field: DataSourceField; target: DataSource } => x.target !== undefined);
    const allProj = source.fields
      .filter(f => f.name !== '_id')
      .map(f => `"${f.name}":1`)
      .join(', ');

    lines.push('', `Collection: "${source.collection}"   →   query.sourceName = "${source.name}"`);
    if (source.description) lines.push(`  ${source.description}`);

    lines.push('  Fields (use the exact quoted names in every pipeline stage):');
    for (const field of source.fields) {
      const ref  = refByField.get(field);
      const desc = fieldDesc(field);
      const tags = [
        field.type,
        metrics.includes(field)      && 'measure',
        temporal.includes(field)     && 'temporal',
        dims.includes(field) && !ref && 'dimension',
        ref                          && `→ references ${ref.collection}`,
        desc,
      ].filter((t): t is string => typeof t === 'string' && t.length > 0);
      lines.push(`    "${field.name}"  (${[...new Set(tags)].join(' | ')})`);
    }

    lines.push('', '  Pipeline templates (ready to copy — field names are already correct):');

    const groupableDim = dims.find(f => !refByField.get(f));
    if (groupableDim) {
      const g = groupableDim.name;
      if (metrics.length) {
        const m = metrics[0].name;
        lines.push(
          `  • Sum "${m}" by "${g}":`,
          `    [{"$group":{"_id":"$${g}","value":{"$sum":"$${m}"}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]`,
          `  • Avg "${m}" by "${g}":`,
          `    [{"$group":{"_id":"$${g}","value":{"$avg":"$${m}"}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]`,
        );
      }
      lines.push(
        `  • Count by "${g}":`,
        `    [{"$group":{"_id":"$${g}","value":{"$sum":1}}},{"$sort":{"value":-1}},{"$project":{"_id":0,"label":"$_id","value":1}}]`,
      );
    }

    if (temporal.length && metrics.length) {
      const t = temporal[0].name;
      const m = metrics[0].name;
      lines.push(
        `  • Trend over "${t}":`,
        `    [{"$group":{"_id":"$${t}","value":{"$sum":"$${m}"}}},{"$sort":{"_id":1}},{"$project":{"_id":0,"year":"$_id","value":1}}]`,
      );
    }

    lines.push(
      `  • Raw list — overview / scatter:`,
      `    [{"$sort":{"_id":-1}},{"$limit":150},{"$project":{"_id":0,${allProj}}}]`,
    );

    for (const { field, target } of refFields) {
      const fk    = target.fields.find(f => f.role === 'id' || f.name === 'id')?.name ?? 'id';
      const label = target.fields.find(f => (f.type === 'string' || f.type === 'text') && f.name !== fk)?.name ?? 'name';
      const proj  = [
        ...source.fields.filter(f => f.name !== '_id' && f.name !== field.name).map(f => `"${f.name}":1`),
        `"${label}":"$_ref.${label}"`,
      ].join(', ');
      lines.push(
        `  • Join "${source.collection}.${field.name}" → "${target.collection}" (resolve to "${label}"):`,
        `    [{"$lookup":{"from":"${target.collection}","localField":"${field.name}","foreignField":"${fk}","as":"_ref"}},`,
        `     {"$unwind":{"path":"$_ref","preserveNullAndEmptyArrays":true}},`,
        `     {"$project":{"_id":0,${proj}}}]`,
      );
    }
  }

  return lines.join('\n');
}

export function buildPlannerPrompt(intent: IntentKind, sources: DataSource[]): string {
  return interpolateTemplate(AGGREGATION_PROMPT_BASE, {
    '{{DATABASE_SCHEMA}}': buildSchemaSection(sources),
    '{{INTENT_GUIDANCE}}': intent === 'dashboard'
      ? AGGREGATION_PROMPT_DASH
      : AGGREGATION_PROMPT_NONDASH,
  });
}

export { resolveReference, normalizeToken };
