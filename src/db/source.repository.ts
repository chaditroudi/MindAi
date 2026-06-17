export function normalizeToken(value?: string | null) {
  return value?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') ?? '';
}
