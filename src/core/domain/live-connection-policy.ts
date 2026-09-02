/** Pure retry policy so reconnect behaviour is testable independently of the SDK. */
export function isPermanentLiveConnectionError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return /model|not found|unsupported|(?:401|403)|api key|authentication|unauthori[sz]ed|permission denied|invalid argument|invalid api/.test(message);
}

/**
 * INTENTIONAL SAFETY LIMIT (review item 4): with 20s-capped exponential backoff,
 * 500 attempts ≈ 2.5–3 hours of continuous retry on a permanently-down link.
 * This is NOT the call-termination policy — the caller gates on the user having
 * hung up (isUserExplicitlyClosed), so in real usage a call retries for the
 * entire outage. The cap exists purely as a sanity valve against truly
 * pathological endless churn (a lost device, a battery-dead background worker,
 * a permanently torn-down socket that never errors cleanly). If the product
 * contract is "only an explicit hangup ends the call", raising this constant is
 * the single knob — it is deliberately kept out of the per-attempt hot path.
 */
export const MAX_LIVE_RECONNECT_ATTEMPTS = 500;

export function canRetryLiveConnection(attempt: number): boolean {
  return attempt < MAX_LIVE_RECONNECT_ATTEMPTS;
}