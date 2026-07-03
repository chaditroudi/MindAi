/**
 * isCooldownActive
 * -----------------
 * A pooled agent gets put "on cooldown" after a rate-limit error — instead of
 * being marked permanently expired, it gets a `cooldownUntil` timestamp and
 * should be skipped (but not deleted/disabled) until that time passes.
 *
 * This one function is the single source of truth for "is this agent still
 * cooling down right now?" — used by agent-config.service.ts (deciding which
 * agent is eligible to become `currentAgentId`) and agent-health.service.ts
 * (deciding whether to bother probing an agent at all this minute).
 *
 * @param cooldownUntil - the stored cooldown expiry, or null/undefined if the
 *   agent was never put on cooldown (or has already had it cleared).
 * @param now - defaults to the real current time, but accepts an override so
 *   tests can assert behavior at an exact, deterministic instant instead of
 *   racing the real clock.
 */
export function isCooldownActive(
  cooldownUntil?: Date | null,
  now = Date.now(),
): boolean {
  // No cooldown set at all → definitely not cooling down.
  if (!cooldownUntil) return false;

  // Still cooling down only if the stored expiry is strictly in the future
  // relative to `now`. Once `cooldownUntil` has passed, the agent is
  // considered eligible again — nothing proactively clears the stale
  // timestamp, it just stops being "active" from this check's perspective.
  return new Date(cooldownUntil).getTime() > now;
}
