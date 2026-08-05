import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import ProgressBar from '../components/ui/ProgressBar';
import { haptic } from '../lib/haptics';
import { checkForUpdates, getInstalledVersion, installUpdate, openExternalUrl, type DownloadProgress, type UpdateCheckResult } from '../lib/updates';
import { formatBytes } from '../features/backup/backup.service';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'checked'; result: UpdateCheckResult }
  | { status: 'installing' };

export default function UpdatesScreen() {
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState('dev');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const isNative = Capacitor.isNativePlatform();

  // Installed version + auto check — screen khulte hi turant check ho jaye.
  useEffect(() => {
    let mounted = true;
    getInstalledVersion().then((version) => {
      if (mounted) setCurrentVersion(version);
    });
    runCheck();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCheck() {
    haptic();
    setCheck({ status: 'checking' });
    setInstallMsg(null);
    const result = await checkForUpdates();
    setCheck({ status: 'checked', result });
  }

  async function runInstall(apkUrl: string, apkSize?: number) {
    haptic();
    if (check.status !== 'checked') return;
    const prevResult = check.result;
    setCheck({ status: 'installing' });
    setInstallMsg(null);
    setProgress({ receivedBytes: 0, totalBytes: typeof apkSize === 'number' && apkSize > 0 ? apkSize : null, percent: null });
    const result = await installUpdate(apkUrl, {
      totalBytes: apkSize,
      onProgress: (p) => setProgress(p),
    });
    setInstallMsg(result.message);
    setProgress(null);
    setCheck({ status: 'checked', result: prevResult });
  }

  const result = check.status === 'checked' ? check.result : null;
  const latest = result?.latest ?? null;
  const apkUrl = latest?.apkUrl ?? null;
  const versionKnown = currentVersion !== 'dev';

  return (
    <div className="screen fade-up">
      <ScreenHeader eyebrow="APP UPDATES" title="Updates" subtitle="GitHub release se naya version check karke seedha install karo." />

      <div className="mb-2.5">
        <SectionHeader icon={<RefreshCw size={14} color="var(--color-l)" />} accent="var(--color-l)" title="App version" meta={versionKnown ? currentVersion : 'local build'} />
      </div>

      <div className="card mb-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-l/10 text-l">
              <ShieldCheck size={19} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold">LevelUp {versionKnown ? `v${currentVersion}` : '(local)'}</p>
              <p className="text-xs leading-snug text-muted">
                {isNative
                  ? 'Android app — updates GitHub release se check hote hain.'
                  : 'Web preview — APK download karke phone me install hoga.'}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn justify-center text-xs" onClick={runCheck} disabled={check.status === 'checking' || check.status === 'installing'}>
            {check.status === 'checking' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            {check.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          <button type="button" className="btn btn-ghost justify-center text-xs" onClick={() => openExternalUrl('https://github.com/anurag008w/levelup/releases')}>
            <ExternalLink size={13} /> Releases
          </button>
        </div>
      </div>

      {check.status === 'checking' && (
        <div className="card mb-4 flex items-center gap-3 p-4">
          <RefreshCw size={16} className="animate-spin text-l" />
          <p className="text-sm text-muted">GitHub pe latest release dhoond raha hai…</p>
        </div>
      )}

      {check.status === 'installing' && (
        <div className="card mb-4 p-4">
          <div className="flex items-center gap-3">
            <RefreshCw size={16} className="animate-spin text-l" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">APK download ho raha hai…</p>
              <p className="text-xs text-muted">
                {progress?.totalBytes
                  ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}${progress.percent != null ? ` · ${progress.percent}%` : ''}`
                  : 'Thoda sa wait karo — bada file hai to der lag sakti hai.'}
              </p>
            </div>
          </div>
          {progress?.percent != null && (
            <div className="mt-3.5">
              <ProgressBar value={progress.percent} color="var(--color-blood-bright)" height={8} />
              <p className="mt-1.5 text-right font-mono text-[11px] font-semibold text-l">{progress.percent}%</p>
            </div>
          )}
        </div>
      )}

      {check.status === 'checked' && result && (
        <>
          {result.error && (
            <div className="card mb-4 border-danger/30 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger">
                <ShieldAlert size={15} /> Check fail ho gaya
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{result.error}</p>
            </div>
          )}

          {latest && (
            <>
              {result.available ? (
                <div className="card mb-4 border-l/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-bold text-l">
                        {versionKnown ? 'Naya version available!' : `Latest release: v${latest.version}`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {versionKnown ? `v${currentVersion} → v${latest.version}` : isNative ? 'Installed version nahi mil paya — niche se install karo.' : 'Web preview — apne phone pe APK install karna hoga.'}
                        {typeof latest.apkSize === 'number' && ` · ${formatBytes(latest.apkSize)}`}
                        {latest.publishedAt && ` · ${new Date(latest.publishedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <span className="badge shrink-0">update</span>
                  </div>
                  {apkUrl ? (
                    isNative ? (
                      <button type="button" className="btn mt-3 w-full justify-center text-sm" onClick={() => runInstall(apkUrl, latest.apkSize)}>
                        <Download size={15} /> Download & Install
                      </button>
                    ) : (
                      <button type="button" className="btn mt-3 w-full justify-center text-sm" onClick={() => openExternalUrl(apkUrl)}>
                        <Download size={15} /> APK download karo
                      </button>
                    )
                  ) : (
                    <p className="mt-3 text-xs leading-relaxed text-muted">Is release me APK attach nahi hai — release page se download karo.</p>
                  )}
                  {installMsg && <p className="mt-2.5 text-xs leading-relaxed text-muted">{installMsg}</p>}
                </div>
              ) : (
                <div className="card mb-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-bold">App latest hai</p>
                      <p className="mt-0.5 text-xs text-muted">
                        v{latest.version} installed{latest.publishedAt && ` · released ${new Date(latest.publishedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <span className="badge shrink-0">latest</span>
                  </div>
                </div>
              )}

              {latest.body && (
                <div className="mb-4">
                  <div className="mb-2.5">
                    <SectionHeader icon={<ShieldCheck size={14} color="var(--color-l)" />} accent="var(--color-l)" title="Release notes" meta={latest.tagName} />
                  </div>
                  <div className="card whitespace-pre-wrap p-4 text-xs leading-relaxed text-muted">{latest.body}</div>
                </div>
              )}

              <button type="button" className="btn btn-ghost w-full justify-center text-xs" onClick={() => openExternalUrl(latest.releaseUrl)}>
                <ExternalLink size={13} /> GitHub par release kholo
              </button>
            </>
          )}

          {!latest && !result.error && (
            <div className="card mb-4 p-4">
              <p className="text-sm font-semibold text-text">Koi release nahi mila</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">Repo me abhi tak koi GitHub release nahi hai. Release publish hote hi update yahan dikhega.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
