// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  installUpdate,
  isUpdateAvailable,
  parseVersion,
  pickApkAsset,
  releaseFromApi,
  resolveCurrentVersion,
} from '../updates';

const { httpGetMock, isNativeMock, writeFileMock, startActivityMock } = vi.hoisted(() => ({
  httpGetMock: vi.fn(),
  isNativeMock: vi.fn(() => true),
  writeFileMock: vi.fn(),
  startActivityMock: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: (...args: unknown[]) => isNativeMock(...args) },
  CapacitorHttp: { get: (...args: unknown[]) => httpGetMock(...args) },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: (...args: unknown[]) => writeFileMock(...args) },
}));

vi.mock('@capgo/capacitor-intent-launcher', () => ({
  ActivityAction: { VIEW: 'VIEW', MANAGE_UNKNOWN_APP_SOURCES: 'MANAGE_UNKNOWN_APP_SOURCES' },
  IntentLauncher: { startActivityAsync: (...args: unknown[]) => startActivityMock(...args) },
}));

describe('resolveCurrentVersion', () => {
  it('prefers a baked-in release version over the native version', () => {
    expect(resolveCurrentVersion('2026.08.01', '1.0')).toBe('2026.08.01');
  });

  it('falls back to the native installed version when not baked in', () => {
    expect(resolveCurrentVersion('dev', '2026.08.01')).toBe('2026.08.01');
  });

  it('falls back to dev when nothing is known', () => {
    expect(resolveCurrentVersion('dev', null)).toBe('dev');
    expect(resolveCurrentVersion('dev', '')).toBe('dev');
  });
});

describe('parseVersion', () => {
  it('parses date-style versions', () => {
    expect(parseVersion('2026.08.01')).toEqual([2026, 8, 1]);
    expect(parseVersion('v2026.08.01')).toEqual([2026, 8, 1]);
  });

  it('parses plain numeric versions and ignores junk', () => {
    expect(parseVersion('1.0')).toEqual([1, 0]);
    expect(parseVersion('1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseVersion('dev')).toEqual([]);
    expect(parseVersion('')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders date-style versions correctly', () => {
    expect(compareVersions('2026.08.01', '2026.08.02')).toBe(-1);
    expect(compareVersions('2026.08.01', '2026.08.01')).toBe(0);
    expect(compareVersions('2026.09.01', '2026.08.02')).toBe(1);
  });

  it('treats unknown local builds as older than any release', () => {
    expect(compareVersions('dev', '2026.08.01')).toBe(-1);
    expect(compareVersions('dev', 'dev')).toBe(0);
  });
});

describe('isUpdateAvailable', () => {
  it('is false when current equals or beats latest', () => {
    expect(isUpdateAvailable('2026.08.01', '2026.08.01')).toBe(false);
    expect(isUpdateAvailable('2026.09.01', '2026.08.01')).toBe(false);
  });

  it('is true when latest is newer', () => {
    expect(isUpdateAvailable('2026.08.01', '2026.09.01')).toBe(true);
  });

  it('always offers the update for local/dev builds', () => {
    expect(isUpdateAvailable('dev', '2026.08.01')).toBe(true);
  });
});

describe('pickApkAsset', () => {
  const assets = (list: { name: string; browser_download_url: string }[]) => list;

  it('prefers the signed APK over any other apk', () => {
    const picked = pickApkAsset(
      assets([
        { name: 'levelup-2026.08.01.apk', browser_download_url: 'https://x/levelup-2026.08.01.apk' },
        { name: 'levelup-2026.08.01-signed.apk', browser_download_url: 'https://x/signed.apk' },
      ]),
    );
    expect(picked?.url).toBe('https://x/signed.apk');
  });

  it('falls back to any apk and returns null when none exists', () => {
    expect(
      pickApkAsset(assets([{ name: 'levelup-2026.08.01.apk', browser_download_url: 'https://x/plain.apk' }]))?.url,
    ).toBe('https://x/plain.apk');
    expect(pickApkAsset(assets([{ name: 'readme.txt', browser_download_url: 'https://x/readme.txt' }]))).toBeNull();
  });
});

describe('releaseFromApi', () => {
  it('maps a GitHub release payload with a signed apk asset', () => {
    const release = releaseFromApi({
      tag_name: 'v2026.08.01',
      name: 'LevelUp v2026.08.01',
      body: '# Release 2026.08.01',
      published_at: '2026-08-01T10:00:00Z',
      html_url: 'https://github.com/anurag008w/levelup/releases/tag/v2026.08.01',
      assets: [
        { name: 'levelup-2026.08.01.apk', browser_download_url: 'https://x/plain.apk', size: 123 },
        { name: 'levelup-2026.08.01-signed.apk', browser_download_url: 'https://x/signed.apk', size: 456 },
      ],
    });
    expect(release).toMatchObject({
      version: '2026.08.01',
      tagName: 'v2026.08.01',
      apkUrl: 'https://x/signed.apk',
      apkSize: 456,
    });
  });

  it('returns null for a malformed payload', () => {
    expect(releaseFromApi({})).toBeNull();
    expect(releaseFromApi({ tag_name: 42 })).toBeNull();
  });
});

describe('installUpdate', () => {
  beforeEach(() => {
    isNativeMock.mockReturnValue(true);
    httpGetMock.mockReset();
    writeFileMock.mockReset();
    startActivityMock.mockReset();
  });

  it('downloads via native CapacitorHttp (blob) and launches the installer', async () => {
    httpGetMock.mockResolvedValue({ status: 200, data: 'aGVsbG8=', headers: {}, url: 'u' });
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    startActivityMock.mockResolvedValue({});

    const result = await installUpdate('https://github.com/anurag008w/levelup/releases/download/v1/app-signed.apk');

    expect(httpGetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://github.com/anurag008w/levelup/releases/download/v1/app-signed.apk',
        responseType: 'blob',
      }),
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'aGVsbG8=', directory: 'CACHE', recursive: true }),
    );
    expect(startActivityMock).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('reports a failed download without writing or launching the installer', async () => {
    httpGetMock.mockResolvedValue({ status: 500, data: '', headers: {}, url: 'u' });

    const result = await installUpdate('https://x/app.apk');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP 500');
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(startActivityMock).not.toHaveBeenCalled();
  });

  it('opens the APK link in the browser on non-native platforms', async () => {
    isNativeMock.mockReturnValue(false);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const result = await installUpdate('https://x/app.apk');

    expect(openSpy).toHaveBeenCalledWith('https://x/app.apk', '_blank');
    expect(result.ok).toBe(true);
    expect(httpGetMock).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
