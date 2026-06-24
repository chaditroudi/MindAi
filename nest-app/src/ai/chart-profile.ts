import type { DataRow, FieldKind, RowProfile } from './chart-types';

const GENERIC_LABEL_TOKENS = new Set(['label', 'name', 'title', 'category', 'group', 'segment', 'region', 'type']);
const GENERIC_VALUE_TOKENS = new Set(['value', 'total', 'amount', 'metric', 'budget', 'count', 'sum', 'score']);
const GENERIC_TIME_TOKENS  = new Set(['date', 'time', 'month', 'year', 'day', 'week', 'period']);

function normalizeFieldToken(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isTemporalLike(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !Number.isNaN(Date.parse(trimmed));
}

export function isNumericLike(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/,/g, '');
    return trimmed.length > 0 && Number.isFinite(Number(trimmed));
  }
  return false;
}

function fieldSamples(rows: DataRow[], field: string) {
  return rows.map(r => r[field]).filter(v => v != null).slice(0, 20);
}

function classifyField(rows: DataRow[], field: string): FieldKind {
  const samples = fieldSamples(rows, field);
  if (!samples.length) return 'categorical';
  if (samples.every(isNumericLike))  return 'numeric';
  if (samples.every(isTemporalLike)) return 'temporal';
  return 'categorical';
}

export function buildRowProfile(keys: Set<string>, rows: DataRow[]): RowProfile {
  const all:         string[] = [...keys];
  const numeric:     string[] = [];
  const temporal:    string[] = [];
  const categorical: string[] = [];

  for (const field of all) {
    const kind = classifyField(rows, field);
    if (kind === 'numeric') numeric.push(field);
    else if (kind === 'temporal') temporal.push(field);
    else categorical.push(field);
  }

  return { all, numeric, temporal, categorical };
}

export function pickFields(profile: RowProfile, kinds: FieldKind[], exclude: string[] = [], limit = 1) {
  const blocked = new Set(exclude.filter(Boolean));
  const picked: string[] = [];

  for (const kind of kinds) {
    for (const field of profile[kind]) {
      if (blocked.has(field)) continue;
      picked.push(field);
      blocked.add(field);
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}

function scoreFieldCandidate(requested: string, candidate: string) {
  const wanted  = normalizeFieldToken(requested);
  const current = normalizeFieldToken(candidate);
  const rawWanted = requested.trim().toLowerCase();
  const rawNow    = candidate.trim().toLowerCase();

  if (!wanted) return 0;
  if (requested === candidate) return 100;
  if (rawWanted === rawNow) return 90;
  if (wanted === current) return 80;
  if (current.includes(wanted) || wanted.includes(current)) return 55;
  return 0;
}

function defaultKindsForToken(token: string): FieldKind[] {
  if (GENERIC_TIME_TOKENS.has(token))  return ['temporal', 'categorical'];
  if (GENERIC_VALUE_TOKENS.has(token)) return ['numeric'];
  if (GENERIC_LABEL_TOKENS.has(token)) return ['categorical', 'temporal'];
  return [];
}

export function resolveFieldName(
  requested: string | undefined,
  profile:   RowProfile,
  preferred: FieldKind[],
  exclude:   string[] = [],
) {
  const blocked = new Set(exclude.filter(Boolean));
  const token   = normalizeFieldToken(requested);
  const scoped  = preferred.length
    ? pickFields(profile, preferred, exclude, profile.all.length)
    : profile.all.filter(f => !blocked.has(f));
  const pool    = scoped.length ? scoped : profile.all.filter(f => !blocked.has(f));

  if (requested && !blocked.has(requested) && profile.all.includes(requested)) return requested;

  if (requested) {
    const scored = pool
      .map(field => ({ field, score: scoreFieldCandidate(requested, field) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].field;
  }

  const genericKinds = token ? defaultKindsForToken(token) : [];
  return pickFields(profile, genericKinds.length ? genericKinds : preferred, exclude, 1)[0];
}
