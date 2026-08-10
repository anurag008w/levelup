import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativePlatform } from '../infra/ai/http-native';

const EXPORT_DIR = 'exports';

export interface ExportFileResult {
  ok: boolean;
  /** Hinglish status message, safe to show directly in a toast/flash. */
  message: string;
}

/**
 * Exports text content (JSON/markdown/etc.) as a file, working on BOTH web
 * and native Capacitor apps.
 *
 * - Web: classic Blob + `<a download>` browser download — unchanged.
 * - Native (Android/iOS): the Blob+`<a download>` trick silently no-ops
 *   inside a Capacitor WebView (no download happens, no error either — the
 *   user just never gets a file). Instead we write the content to the app
 *   cache via `Filesystem.writeFile`, then hand it to the native share sheet
 *   via `@capacitor/share`, so the user can save it to Drive/Files, send it
 *   over WhatsApp, etc. The exported file is written under `exports/` in
 *   `Directory.Cache`, which the app's FileProvider (`file_paths.xml`,
 *   `cache-path path="."`) already exposes — no manifest change needed.
 *
 * Never throws: cancelling the native share sheet resolves with `ok: true`
 * (nothing went wrong, the user just changed their mind) so callers don't
 * need to special-case it.
 */
export async function exportTextFile(content: string, filename: string, mimeType = 'application/json'): Promise<ExportFileResult> {
  if (!isNativePlatform()) {
    downloadInBrowser(content, filename, mimeType);
    return { ok: true, message: `${filename} download ho gayi.` };
  }

  try {
    const { uri } = await Filesystem.writeFile({
      path: `${EXPORT_DIR}/${filename}`,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Share.share({ title: filename, files: [uri] });
    return { ok: true, message: `${filename} share ho gayi — jahan save karna hai wahan choose karo.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User backed out of the share sheet — not a failure, nothing to report.
    if (/cancel/i.test(msg)) return { ok: true, message: 'Share cancel kar diya.' };
    return { ok: false, message: `Export fail ho gaya: ${msg}` };
  }
}

function downloadInBrowser(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
