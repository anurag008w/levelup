/** Pure retry policy so reconnect behaviour is testable independently of the SDK. */
export function isPermanentLiveConnectionError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return /model|not found|unsupported|(?:401|403)|api key|authentication|unauthori[sz]ed|permission denied|invalid argument|invalid api/.test(message);
}

export function canRetryLiveConnection(attempt: number, windowStartedAt: number, now = Date.now()): boolean {
  return attempt < 6 && (!windowStartedAt || now - windowStartedAt <= 90_000);
}
