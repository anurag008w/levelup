/** Pure retry policy so reconnect behaviour is testable independently of the SDK. */
export function isPermanentLiveConnectionError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return /model|not found|unsupported|(?:401|403)|api key|authentication|unauthori[sz]ed|permission denied|invalid argument|invalid api/.test(message);
}

/**
 * INTENTIONAL SAFETY LIMIT (review item 4 / review 7 P2): with 20s-capped
 * exponential backoff, 500 attempts ≈ 2.5–3 hours of continuous retry on a
 * permanently-down link.
 *
 * CONTRACT CLARIFICATION: this constant is a TERMINAL SAFETY VALVE only, not
 * the product's call-termination policy. The product contract stays
 * "an explicit hangup is the only way a call ends" — the caller never enters
 * this loop once the user hangs up (the reconnect worker is also cancelled
 * immediately on hangup: pending backoff timer cleared + epoch token bumped).
 * The cap exists purely so a PATHOLOGICAL state (lost device, battery-dead
 * background worker, a socket that never errors cleanly) cannot spin forever.
 *
 * When the valve trips the user sees a clear error card ("Network connection
 * could not be restored. End the call or try again.") — the outage ceiling is
 * therefore USER-VISIBLE and documented, not silent. If the product wants a
 * call to survive longer than ~3h of link outage, raise this single knob.
 */
export const MAX_LIVE_RECONNECT_ATTEMPTS = 500;

export function canRetryLiveConnection(attempt: number): boolean {
  return attempt < MAX_LIVE_RECONNECT_ATTEMPTS;
}