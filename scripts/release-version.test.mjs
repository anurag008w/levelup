import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = new URL('./release-version.mjs', import.meta.url);
const workflow = new URL('../.github/workflows/release.yml', import.meta.url);

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

  it('does not interpolate the untrusted manual version input into shell source', () => {
    const source = readFileSync(workflow, 'utf8');
    expect(source).toContain('RELEASE_INPUT_VERSION: ${{ github.event.inputs.version }}');
    expect(source).toContain('VERSION=\"$RELEASE_INPUT_VERSION\"');
    expect(source).not.toContain('VERSION=\"${{ github.event.inputs.version }}\"');
  });

  it('does not persist a write-capable checkout credential during dependency installation', () => {
    const source = readFileSync(workflow, 'utf8');
    const checkout = source.indexOf('uses: actions/checkout@');
    const install = source.indexOf('run: npm ci');
    const persistCredentials = source.indexOf('persist-credentials: false', checkout);
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(persistCredentials).toBeGreaterThan(checkout);
    expect(persistCredentials).toBeLessThan(install);
  });

  it('does not push a release tag before release creation', () => {
    const source = readFileSync(workflow, 'utf8');
    const tagPush = source.indexOf('git push origin "$VERSION"');
    const releaseAction = source.indexOf('softprops/action-gh-release@');
    expect(tagPush).toBe(-1);
    expect(source).toContain('target_commitish: ${{ github.sha }}');
    expect(releaseAction).toBeGreaterThan(-1);
  });

  it('treats the previous tag as git revision data, not shell syntax', () => {
    const source = readFileSync(workflow, 'utf8');
    expect(source).toContain('git log --format="- %s" --end-of-options "$LAST_TAG..HEAD"');
    expect(source).not.toContain('git log $LAST_TAG..HEAD --format="- %s"');
  });

  it('fails closed instead of publishing a debug APK when signing credentials are missing', () => {
    const source = readFileSync(workflow, 'utf8');
    expect(source).toContain('Production release signing credentials are required');
    expect(source).toContain('./gradlew assembleRelease --no-daemon');
    expect(source).toContain('levelup-${{ steps.version.outputs.VERSION_NAME }}-signed.apk');
    expect(source).not.toContain('assembleDebug --no-daemon');
    expect(source).not.toContain('SIGNED=false');
  });
});
