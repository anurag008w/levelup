import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { ActivityAction, IntentLauncher } from '@capgo/capacitor-intent-launcher';

const GITHUB_REPO = 'anurag008w/levelup';
const APP_PACKAGE = 'com.anurag.levelup';
const APK_MIME = 'application/vnd.android.package-archive';
const UPDATE_DIR = 'updates';
const APK_FILE = 'levelup.apk';

// android.content.Intent flags — FLAG_GRANT_READ_URI_PERMISSION lets the system
// package installer read the FileProvider content URI; FLAG_ACTIVITY_NEW_TASK
// is required because we launch the intent from the plugin (not an Activity).
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

export interface ReleaseInfo {
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  releaseUrl: string;
  apkUrl: string | null;
  apkSize?: number;
  /** True for GitHub draft releases — never offered as an update. */
  draft?: boolean;
  /** True for GitHub prereleases — never offered as an update. */
  prerelease?: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latest: ReleaseInfo | null;
  available: boolean;
  error?: string;
}

export interface InstallResult {
  ok: boolean;
  message: string;
}

/** Real-time APK download progress (native chunked download). */
export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  /** 0-100, null while the total size is still unknown. */
  percent: number | null;
}

export interface InstallUpdateOptions {
  /** Known APK size from the release asset (bytes). Used for the progress bar. */
  totalBytes?: number;
  /** Native chunked download reports real bytes/percent as it goes. */
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ApkAsset {
  name: string;
  url: string;
  size?: number;
}

/** 2 MB chunks — GitHub S3 serves release assets with Range support, so we can
 *  download in slices and report true byte-level progress to the UI. */
const DOWNLOAD_CHUNK_SIZE = 2 * 1024 * 1024;

export function getEnvVersion(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const version = env.VITE_APP_VERSION?.trim();
  return version ? version : 'dev';
}

// Priority: real installed versionName from the OS → bake-time version
// (VITE_APP_VERSION, set by the release build) → unknown ('dev').
// The native versionName is the ground truth of the installed APK — it is
// what the OS reports, so it can never go stale the way a baked-in web build
// constant can. The gradle default "1.0" carries no info, so we skip it.
export function resolveCurrentVersion(envVersion: string, nativeVersion: string | null): string {
  const native = nativeVersion?.trim();
  if (native && native !== '1.0') return native;
  const env = envVersion?.trim();
  if (env && env !== 'dev') return env;
  return 'dev';
}

async function detectNativeVersion(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await App.getInfo();
    const version = info.version?.trim();
    return version || null;
  } catch {
    return null;
  }
}

export async function getInstalledVersion(): Promise<string> {
  return resolveCurrentVersion(getEnvVersion(), await detectNativeVersion());
}

export function parseVersion(version: string): number[] {
  const parts = version
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter((p) => p.length > 0);
  // Date-style release tags are vYYYY.MM.DD or vYYYY.MM.DDSS (same-day
  // releases carry a 2-digit sequence: v2026.08.0503 = day 05 + seq 03).
  // As raw numbers "0503" (503) would look NEWER than "06" (6) and break
  // update detection — so split the last component into day + sequence.
  const isDateTag = parts.length >= 3 && parts[0].length === 4;
  const nums: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const n = parseInt(part, 10);
    if (Number.isNaN(n)) continue;
    if (isDateTag && i === 2 && part.length > 2) {
      nums.push(parseInt(part.slice(0, 2), 10));
      nums.push(parseInt(part.slice(2) || '0', 10));
    } else {
      nums.push(n);
    }
  }
  return nums;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  if (current === 'dev') return true;
  return compareVersions(current, latest) < 0;
}

export function pickApkAsset(assets: { name: string; browser_download_url: string; size?: number }[]): ApkAsset | null {
  const signed = assets.find((a) => a.name.toLowerCase().endsWith('signed.apk'));
  const fallback = assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
  const asset = signed ?? fallback;
  return asset
    ? { name: asset.name, url: asset.browser_download_url, size: typeof asset.size === 'number' ? asset.size : undefined }
    : null;
}

export function releaseFromApi(payload: Record<string, unknown>): ReleaseInfo | null {
  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : '';
  if (!tagName) return null;
  const assets = Array.isArray(payload.assets)
    ? (payload.assets as { name: string; browser_download_url: string; size?: number }[])
    : [];
  const apk = pickApkAsset(assets);
  return {
    tagName,
    version: tagName.replace(/^v/i, ''),
    name: typeof payload.name === 'string' && payload.name ? payload.name : tagName,
    body: typeof payload.body === 'string' ? payload.body : '',
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : '',
    releaseUrl:
      typeof payload.html_url === 'string' ? payload.html_url : `https://github.com/${GITHUB_REPO}/releases/latest`,
    apkUrl: apk?.url ?? null,
    apkSize: apk?.size,
    draft: payload.draft === true,
    prerelease: payload.prerelease === true,
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getInstalledVersion();
  try {
    // GitHub's `/releases/latest` returns the most recently *published*
    // release, which is not always the highest *tag* (a backdated publish, a
    // stray draft, or a prerelease can throw it off). List every release and
    // pick the one with the newest tag (vYYYY.MM.DD[SS]) — the app then always
    // reports the actual latest version, exactly what the tag says.
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      return { currentVersion, latest: null, available: false };
    }
    if (!response.ok) {
      throw new Error(`Update check fail (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>[];
    const releases = payload
      .map((item) => releaseFromApi(item))
      .filter((r): r is ReleaseInfo => r !== null && !r.draft && !r.prerelease);
    // Highest tag first — stable sort keeps ordering deterministic.
    const latest = [...releases].sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
    return {
      currentVersion,
      latest,
      available: latest ? isUpdateAvailable(currentVersion, latest.version) : false,
    };
  } catch (error) {
    return {
      currentVersion,
      latest: null,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await IntentLauncher.startActivityAsync({ action: ActivityAction.VIEW, data: url });
      return;
    } catch {
      // browser intent fail ho jaye to web fallback
    }
  }
  window.open(url, '_blank');
}

/** Full single-shot download (no progress) — used when no progress handler is
 *  attached (existing callers/tests) or as a fallback when ranged download
 *  isn't supported. Returns the base64 payload. */
async function downloadWhole(apkUrl: string): Promise<string> {
  const response = await CapacitorHttp.get({
    url: apkUrl,
    responseType: 'blob',
    connectTimeout: 30_000,
    readTimeout: 120_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`APK download fail (HTTP ${response.status})`);
  }
  const base64 = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  if (!base64) throw new Error('APK data empty');
  return base64;
}

/** Reads the total byte size from a `Range: bytes=0-0` probe (206 response
 *  carries `Content-Range: bytes 0-0/<total>`). Returns null if unknown. */
async function probeTotalBytes(apkUrl: string): Promise<number | null> {
  try {
    const probe = await CapacitorHttp.get({
      url: apkUrl,
      headers: { Range: 'bytes=0-0' },
      responseType: 'blob',
      connectTimeout: 30_000,
      readTimeout: 30_000,
    });
    if (probe.status === 206) {
      const contentRange = String(probe.headers?.['Content-Range'] ?? probe.headers?.['content-range'] ?? '');
      const match = contentRange.match(/\/(\d+)\s*$/);
      if (match) return Number(match[1]);
    }
  } catch {
    // probe fail — caller falls back to a whole download
  }
  return null;
}

/** Ranged download that writes chunks straight to cache and reports real
 *  progress. Throws on failure (caller falls back to a whole download). */
async function downloadChunked(
  apkUrl: string,
  totalBytes: number,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  const filePath = `${UPDATE_DIR}/${APK_FILE}`;
  let received = 0;
  let start = 0;
  let first = true;

  while (start < totalBytes) {
    const end = Math.min(start + DOWNLOAD_CHUNK_SIZE - 1, totalBytes - 1);
    const response = await CapacitorHttp.get({
      url: apkUrl,
      headers: { Range: `bytes=${start}-${end}` },
      responseType: 'blob',
      connectTimeout: 30_000,
      readTimeout: 120_000,
    });
    // Server must answer 206 Partial Content — a 200 means it ignored Range
    // and sent the full body, which would corrupt a chunked file.
    if (response.status !== 206) {
      throw new Error(`Ranged download unsupported (HTTP ${response.status})`);
    }
    const base64 = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (!base64) throw new Error('APK data empty');

    if (first) {
      await Filesystem.writeFile({ path: filePath, data: base64, directory: Directory.Cache, recursive: true });
      first = false;
    } else {
      await Filesystem.appendFile({ path: filePath, data: base64, directory: Directory.Cache });
    }

    received += end - start + 1;
    start = end + 1;
    onProgress({
      receivedBytes: Math.min(received, totalBytes),
      totalBytes,
      percent: totalBytes > 0 ? Math.min(100, Math.round((received / totalBytes) * 100)) : null,
    });
  }
}

/** Launches the Android package installer on the freshly written APK. */
async function launchInstaller(): Promise<InstallResult> {
  const contentUri = `content://${APP_PACKAGE}.fileprovider/${UPDATE_DIR}/${APK_FILE}`;
  try {
    await IntentLauncher.startActivityAsync({
      action: ActivityAction.VIEW,
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    });
    return { ok: true, message: 'APK installer khul gaya — "Install" par tap karo.' };
  } catch {
    try {
      await IntentLauncher.startActivityAsync({ action: ActivityAction.MANAGE_UNKNOWN_APP_SOURCES });
    } catch {
      // settings screen bhi nahi khula — sirf message dikha do
    }
    return {
      ok: false,
      message:
        'Installer khul nahi paya. Phone settings me is app ke liye "Install unknown apps" allow karo, phir dobara try karo.',
    };
  }
}

export async function installUpdate(apkUrl: string, options?: InstallUpdateOptions): Promise<InstallResult> {
  if (!Capacitor.isNativePlatform()) {
    window.open(apkUrl, '_blank');
    return { ok: true, message: 'Browser me APK download link khul gaya — wahan se install karo.' };
  }

  const { totalBytes: knownTotal, onProgress } = options ?? {};
  try {
    // Progress mode (UI attached a handler): chunked ranged download so the
    // user sees real MB/percent instead of a silent wait.
    if (onProgress) {
      let totalBytes = typeof knownTotal === 'number' && knownTotal > 0 ? knownTotal : null;
      onProgress({ receivedBytes: 0, totalBytes, percent: totalBytes && totalBytes > 0 ? 0 : null });
      if (totalBytes == null) {
        totalBytes = await probeTotalBytes(apkUrl);
        onProgress({ receivedBytes: 0, totalBytes, percent: totalBytes != null ? 0 : null });
      }
      if (totalBytes != null && totalBytes > 0) {
        try {
          await downloadChunked(apkUrl, totalBytes, onProgress);
          return await launchInstaller();
        } catch {
          // ranged path fail — partial file ko hata ke whole download fallback
          try {
            await Filesystem.deleteFile({ path: `${UPDATE_DIR}/${APK_FILE}`, directory: Directory.Cache });
          } catch {
            // file exist hi nahi karti — koi baat nahi
          }
        }
      }
    }

    // Whole download (single request, no progress) — default path.
    const base64 = await downloadWhole(apkUrl);
    await Filesystem.writeFile({
      path: `${UPDATE_DIR}/${APK_FILE}`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    return await launchInstaller();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
