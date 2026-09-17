import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTextFile } from '../exportFile';

describe('exportTextFile browser download cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the object URL alive through the download start window', async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: revoke,
    });
    vi.stubGlobal('Blob', class {
      constructor(public parts: unknown[], public options: unknown) {}
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    });

    const result = await exportTextFile('hello', 'test.txt', 'text/plain');

    expect(result.ok).toBe(true);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
