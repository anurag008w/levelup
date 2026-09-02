import { describe, expect, it } from 'vitest';
import { canRetryLiveConnection, isPermanentLiveConnectionError, MAX_LIVE_RECONNECT_ATTEMPTS } from '../live-connection-policy';

describe('live connection policy', () => {
  it('does not retry auth and invalid-model failures', () => {
    expect(isPermanentLiveConnectionError(new Error('401 API key invalid'))).toBe(true);
    expect(isPermanentLiveConnectionError(new Error('model not found'))).toBe(true);
  });
  it('keeps the call alive through sustained outages (long-lived rolling retry)', () => {
    expect(isPermanentLiveConnectionError(new Error('network socket closed'))).toBe(false);
    // Old behavior ended the call after 6 attempts / 90s — a temporary
    // multi-minute outage now keeps retrying (caller gates on user hangup).
    expect(canRetryLiveConnection(5)).toBe(true);
    expect(canRetryLiveConnection(6)).toBe(true);
    expect(canRetryLiveConnection(20)).toBe(true);
    expect(canRetryLiveConnection(49)).toBe(true);
    expect(canRetryLiveConnection(99)).toBe(true);
  });
  it('only hits the intentional safety valve after pathological churn', () => {
    // ~2.5–3h of continuous retry at 20s-capped backoff. Terminal only as a
    // sanity limit, never as the normal outage policy.
    expect(canRetryLiveConnection(MAX_LIVE_RECONNECT_ATTEMPTS - 1)).toBe(true);
    expect(canRetryLiveConnection(MAX_LIVE_RECONNECT_ATTEMPTS)).toBe(false);
    expect(MAX_LIVE_RECONNECT_ATTEMPTS).toBe(500);
  });
});