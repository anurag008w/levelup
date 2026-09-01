// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates } from '../updates';

const { isNativeMock } = vi.hoisted(() => ({
  isNativeMock: vi.fn(() => true),
}));

// Simulate the Beta flavor installed on device: app-packaging resolves the
// beta package and isBetaApp() is true. Capacitor natives report beta identity.
vi.mock('../app-packaging', () => ({
  STABLE_PACKAGE_ID: 'com.anurag.levelup',
  BETA_PACKAGE_ID: 'com.anurag.levelup.beta',
  STABLE_APP_NAME: 'LevelUp',
  BETA_APP_NAME: 'LevelUp Beta',
  getAppId: () => 'com.anurag.levelup.beta',
  getAppName: () => 'LevelUp Beta',
  isBetaApp: () => true,
  resolveAppId: async () => 'com.anurag.levelup.beta',
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativeMock() },
  CapacitorHttp: { get: vi.fn() },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: () =>
      Promise.resolve({
        id: 'com.anurag.levelup.beta',
        name: 'LevelUp Beta',
        version: '2026.08.01-beta',
        build: '2026080100',
      }),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: vi.fn(), appendFile: vi.fn(), deleteFile: vi.fn(), stat: vi.fn(), getUri: vi.fn() },
}));

vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

vi.mock('@capgo/capacitor-intent-launcher', () => ({
  ActivityAction: { VIEW: 'VIEW', MANAGE_UNKNOWN_APP_SOURCES: 'MANAGE_UNKNOWN_APP_SOURCES' },
  IntentLauncher: { startActivityAsync: vi.fn() },
}));

describe('checkForUpdates — Beta flavor', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the newest release that carries a beta APK, skipping newer stable-only releases', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => [
        // Newer tag, but only a stable asset — must NOT be offered to Beta.
        {
          tag_name: 'v2026.09.02',
          name: 'LevelUp v2026.09.02',
          body: '',
          published_at: '2026-09-02T10:00:00Z',
          html_url: 'https://x/0902',
          draft: false,
          prerelease: false,
          assets: [{ name: 'levelup-2026.09.02-signed.apk', browser_download_url: 'https://x/0902-stable.apk' }],
        },
        {
          tag_name: 'v2026.09.01',
          name: 'LevelUp v2026.09.01',
          body: '',
          published_at: '2026-09-01T10:00:00Z',
          html_url: 'https://x/0901',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'levelup-2026.09.01-signed.apk', browser_download_url: 'https://x/0901-stable.apk' },
            { name: 'levelup-2026.09.01-beta-signed.apk', browser_download_url: 'https://x/0901-beta.apk' },
          ],
        },
      ],
    });

    const result = await checkForUpdates();

    expect(result.error).toBeUndefined();
    expect(result.latest?.version).toBe('2026.09.01');
    expect(result.latest?.apkUrl).toBe('https://x/0901-beta.apk');
    // installed 2026.08.01-beta < 2026.09.01 — update offered
    expect(result.available).toBe(true);
  });

  it('reports no update when no release carries a beta APK', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => [
        {
          tag_name: 'v2026.09.02',
          name: 'LevelUp v2026.09.02',
          body: '',
          published_at: '2026-09-02T10:00:00Z',
          html_url: 'https://x/0902',
          draft: false,
          prerelease: false,
          assets: [{ name: 'levelup-2026.09.02-signed.apk', browser_download_url: 'https://x/0902-stable.apk' }],
        },
      ],
    });

    const result = await checkForUpdates();

    expect(result.latest).toBeNull();
    expect(result.available).toBe(false);
    expect(result.error).toBeUndefined();
  });
});