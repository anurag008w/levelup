import { describe, expect, it } from 'vitest';
import { canRetryLiveConnection, isPermanentLiveConnectionError } from '../live-connection-policy';

describe('live connection policy', () => {
  it('does not retry auth and invalid-model failures', () => {
    expect(isPermanentLiveConnectionError(new Error('401 API key invalid'))).toBe(true);
    expect(isPermanentLiveConnectionError(new Error('model not found'))).toBe(true);
  });
  it('keeps the call alive through sustained outages (long-lived rolling retry)', () => {
    expect(isPermanentLiveConnectionError(new Error('network socket closed'))).toBe(false);
    // Old behavior ended the call after 6 attempts / 90s — a temporary
    // multi-minute outage now keeps retrying (caller gates on user hangup).
    expect(canRetryLiveConnection(5, 10_000, 20_000)).toBe(true);
    expect(canRetryLiveConnection(6, 10_000, 20_000)).toBe(true);
    expect(canRetryLiveConnection(1, 10_000, 100_001)).toBe(true);
    expect(canRetryLiveConnection(20, 10_000, 600_000)).toBe(true);
    // Sanity valve: >= 500 attempts (hours of capped-backoff churn) is terminal.
    expect(canRetryLiveConnection(499, 10_000, 3_600_000)).toBe(true);
    expect(canRetryLiveConnection(500, 10_000, 3_600_000)).toBe(false);
  });
});
