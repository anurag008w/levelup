/** Pure retry policy so reconnect behaviour is testable independently of the SDK. */
export function isPermanentLiveConnectionError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return /model|not found|unsupported|(?:401|403)|api key|authentication|unauthori[sz]ed|permission denied|invalid argument|invalid api/.test(message);
}

export function canRetryLiveConnection(attempt: number, _windowStartedAt: number, _now = Date.now()): boolean {
  // LONG-LIVED ROLLING RETRY: as long as the user has NOT hung up (the caller
  // gates that via isUserExplicitlyClosed) a multi-minute network outage must
  // NOT silently become a terminal call state. The old 6-attempt / 90s window
  // ended the call on any temporary blip longer than 90 seconds — a lost
  // commute, elevator, or dead zone would kill a study call for no reason.
  // Backoff in the caller caps at 20s, so a permanently-down link retries at
  // most ~every 20s; the attempt count here is only a sanity valve against
  // truly pathological endless churn (>= 500 attempts ≈ hours at capped backoff).
  return attempt < 500;
}
