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

const { httpGetMock, isNativeMock, writeFileMock, appendFileMock, deleteFileMock, startActivityMock } = vi.hoisted(() => ({
  httpGetMock: vi.fn(),
  isNativeMock: vi.fn(() => true),
  writeFileMock: vi.fn(),
  appendFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
  startActivityMock: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativeMock() },
  CapacitorHttp: { get: (...args: unknown[]) => httpGetMock(...args) },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    appendFile: (...args: unknown[]) => appendFileMock(...args),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
  },
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
    appendFileMock.mockReset();
    deleteFileMock.mockReset();
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

  it('downloads in chunks and reports real byte progress when a handler is attached', async () => {
    // 5 MB total → 3 ranged requests (2MB + 2MB + 1MB).
    httpGetMock
      .mockResolvedValueOnce({ status: 206, data: 'Y2h1bmstMQ==', headers: { 'Content-Range': 'bytes 0-2097151/5242880' }, url: 'u' })
      .mockResolvedValueOnce({ status: 206, data: 'Y2h1bmstMg==', headers: { 'Content-Range': 'bytes 2097152-4194303/5242880' }, url: 'u' })
      .mockResolvedValueOnce({ status: 206, data: 'Y2h1bmstMw==', headers: { 'Content-Range': 'bytes 4194304-5242879/5242880' }, url: 'u' });
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    appendFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    startActivityMock.mockResolvedValue({});

    const calls: { receivedBytes: number; percent: number | null }[] = [];
    const result = await installUpdate('https://x/app.apk', {
      totalBytes: 5 * 1024 * 1024,
      onProgress: (p) => calls.push({ receivedBytes: p.receivedBytes, percent: p.percent }),
    });

    expect(result.ok).toBe(true);
    // initial 0%, then a tick per chunk
    expect(calls[0]).toEqual({ receivedBytes: 0, percent: 0 });
    expect(calls[1].receivedBytes).toBe(2 * 1024 * 1024);
    expect(calls[1].percent).toBe(40);
    expect(calls[2].receivedBytes).toBe(4 * 1024 * 1024);
    expect(calls[2].percent).toBe(80);
    expect(calls[3].receivedBytes).toBe(5 * 1024 * 1024);
    expect(calls[3].percent).toBe(100);
    // ranged requests use the Range header + blob type
    expect(httpGetMock).toHaveBeenCalledWith(expect.objectContaining({ headers: { Range: 'bytes=0-2097151' }, responseType: 'blob' }));
    expect(httpGetMock).toHaveBeenCalledWith(expect.objectContaining({ headers: { Range: 'bytes=2097152-4194303' }, responseType: 'blob' }));
    expect(httpGetMock).toHaveBeenCalledWith(expect.objectContaining({ headers: { Range: 'bytes=4194304-5242879' }, responseType: 'blob' }));
    // first chunk writes the file, later chunks append
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock).toHaveBeenCalledTimes(2);
    expect(startActivityMock).toHaveBeenCalled();
  });

  it('probes the total size when unknown and then reports progress', async () => {
    httpGetMock
      .mockResolvedValueOnce({ status: 206, data: '', headers: { 'Content-Range': 'bytes 0-0/3145728' }, url: 'u' })
      .mockResolvedValueOnce({ status: 206, data: 'Y2h1bmstMQ==', headers: { 'Content-Range': 'bytes 0-2097151/3145728' }, url: 'u' })
      .mockResolvedValueOnce({ status: 206, data: 'Y2h1bmstMg==', headers: { 'Content-Range': 'bytes 2097152-3145727/3145728' }, url: 'u' });
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    appendFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    startActivityMock.mockResolvedValue({});

    const calls: { receivedBytes: number; percent: number | null }[] = [];
    const result = await installUpdate('https://x/app.apk', {
      onProgress: (p) => calls.push({ receivedBytes: p.receivedBytes, percent: p.percent }),
    });

    expect(result.ok).toBe(true);
    // probe returns total → first progress tick has percent 0 (not null)
    expect(calls[1]).toEqual({ receivedBytes: 0, percent: 0 });
    expect(calls.at(-1)?.percent).toBe(100);
    expect(httpGetMock).toHaveBeenCalledWith(expect.objectContaining({ headers: { Range: 'bytes=0-0' } }));
  });

  it('falls back to a whole download when the server does not support ranges', async () => {
    // Persistent 200: the ranged chunk call gets 200 (ignored Range), then the
    // whole-download fallback call also gets 200 with the full body.
    httpGetMock.mockResolvedValue({ status: 200, data: 'd2hvbGUtYXBr', headers: {}, url: 'u' });
    writeFileMock.mockResolvedValue({ uri: 'file:///cache/updates/levelup.apk' });
    startActivityMock.mockResolvedValue({});

    const result = await installUpdate('https://x/app.apk', {
      totalBytes: 1000,
      onProgress: () => undefined,
    });

    expect(result.ok).toBe(true);
    // ranged chunk failed → partial deleted → whole download wrote the file
    expect(deleteFileMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith(expect.objectContaining({ data: 'd2hvbGUtYXBr', directory: 'CACHE' }));
    expect(startActivityMock).toHaveBeenCalled();
  });
});
