export function isCooldownActive(
  cooldownUntil?: Date | null,
  now = Date.now(),
): boolean {
  if (!cooldownUntil) return false;
  return new Date(cooldownUntil).getTime() > now;
}
