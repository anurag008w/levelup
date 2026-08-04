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

export interface ApkAsset {
  name: string;
  url: string;
  size?: number;
}

export function getEnvVersion(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const version = env.VITE_APP_VERSION?.trim();
  return version ? version : 'dev';
}

// Priority: bake-time version (VITE_APP_VERSION, set by the release build) →
// real installed versionName from the OS → unknown ('dev').
export function resolveCurrentVersion(envVersion: string, nativeVersion: string | null): string {
  const env = envVersion?.trim();
  if (env && env !== 'dev') return env;
  const native = nativeVersion?.trim();
  if (native) return native;
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
  return version
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .map((part) => parseInt(part, 10))
    .filter((n) => !Number.isNaN(n));
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
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getInstalledVersion();
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      return { currentVersion, latest: null, available: false };
    }
    if (!response.ok) {
      throw new Error(`Update check fail (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const latest = releaseFromApi(payload);
    if (!latest) {
      return { currentVersion, latest: null, available: false };
    }
    return {
      currentVersion,
      latest,
      available: isUpdateAvailable(currentVersion, latest.version),
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

export async function installUpdate(apkUrl: string): Promise<InstallResult> {
  if (!Capacitor.isNativePlatform()) {
    window.open(apkUrl, '_blank');
    return { ok: true, message: 'Browser me APK download link khul gaya — wahan se install karo.' };
  }
  try {
    // WebView fetch GitHub release-asset redirect (release-assets.githubusercontent.com)
    // ko CORS se block kar deta hai ("Failed to fetch"). Native CapacitorHttp
    // (OkHttp) download karta hai — CORS nahi lagta, redirects khud follow hote hain.
    const response = await CapacitorHttp.get({
      url: apkUrl,
      responseType: 'blob',
      connectTimeout: 30_000,
      readTimeout: 120_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`APK download fail (HTTP ${response.status})`);
    }
    // responseType 'blob' native pe base64 string return karta hai.
    const base64 = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (!base64) throw new Error('APK data empty');
    await Filesystem.writeFile({
      path: `${UPDATE_DIR}/${APK_FILE}`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
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
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
