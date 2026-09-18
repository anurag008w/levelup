import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = new URL('./release-version.mjs', import.meta.url);

function run(version) {
  try {
    const stdout = execFileSync(process.execPath, [script.pathname, '--set', version, '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error ?? {};
    return {
      status: e.status ?? 1,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    };
  }
}

describe('release-version policy', () => {
  it('accepts the supported date and same-day sequence forms', () => {
    expect(run('2026.09.01').status).toBe(0);
    expect(run('v2026.09.7004').status).toBe(0);
  });

  it('rejects an oversized final component before a release can be prepared', () => {
    const result = run('2026.09.10000');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Invalid app version');
  });
});
