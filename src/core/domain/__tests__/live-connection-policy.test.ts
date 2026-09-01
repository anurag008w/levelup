import { describe, expect, it } from 'vitest';
import { canRetryLiveConnection, isPermanentLiveConnectionError } from '../live-connection-policy';

describe('live connection policy', () => {
  it('does not retry auth and invalid-model failures', () => {
    expect(isPermanentLiveConnectionError(new Error('401 API key invalid'))).toBe(true);
    expect(isPermanentLiveConnectionError(new Error('model not found'))).toBe(true);
  });
  it('keeps a bounded retry budget for transient failures', () => {
    expect(isPermanentLiveConnectionError(new Error('network socket closed'))).toBe(false);
    expect(canRetryLiveConnection(5, 10_000, 20_000)).toBe(true);
    expect(canRetryLiveConnection(6, 10_000, 20_000)).toBe(false);
    expect(canRetryLiveConnection(1, 10_000, 100_001)).toBe(false);
  });
});
