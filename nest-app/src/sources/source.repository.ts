export function normalizeToken(name: string | undefined | null): string {
  return (name ?? '').toLowerCase().replace(/[\s_-]+/g, '').trim();
}
