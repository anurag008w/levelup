import { Sparkles, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { container } from '../di/container';

interface CoachData {
  text: string;
  ok: boolean;
}

/** Per-day cache so toggling tasks / re-renders never refetch the tip. */
const coachCache = new Map<string, CoachData>();

export default function AICoach({
  today,
  dayNumber,
  levelTitle,
  pct,
  streak,
  recovery,
  examLeft,
  done,
  total,
}: {
  today: string;
  dayNumber: number;
  levelTitle: string;
  pct: number;
  streak: number;
  recovery: boolean;
  examLeft: number | null;
  done: number;
  total: number;
}) {
  const aiOn = container.providerSettings.isAiEnabled();
  const key = today;
  const cached = coachCache.get(key);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'off'>(
    cached ? 'done' : aiOn ? 'idle' : 'off',
  );
  const [tip, setTip] = useState(cached?.text ?? '');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!aiOn) {
      setStatus('off');
      return;
    }
    if (started.current) return;
    started.current = true;

    if (coachCache.has(key)) {
      const hit = coachCache.get(key)!;
      setTip(hit.text);
      setStatus(hit.ok ? 'done' : 'error');
      if (!hit.ok) setError('provider se connect nahi hua');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    container.llm
      .complete({
        messages: [
          {
            role: 'system',
            content:
              'You are a sharp, motivating study coach for a JEE aspirant using a 90-day habit system called Human OS. Reply in Hinglish (Hindi written in Latin script). Keep it to 1-3 short lines, direct and specific, no emojis, no markdown, no surrounding quotes.',
          },
          {
            role: 'user',
            content: buildPrompt(dayNumber, levelTitle, pct, streak, recovery, examLeft, done, total),
          },
        ],
        temperature: 0.8,
        maxTokens: 120,
      })
      .then((res) => {
        if (cancelled) return;
        const text = res.text.trim().replace(/^["']|["']$/g, '');
        coachCache.set(key, { text, ok: true });
        setTip(text);
        setStatus('done');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        coachCache.set(key, { text: '', ok: false });
        setError(shortError(err));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, key]);

  if (status === 'off') {
    return (
      <div className="card mb-4 flex items-start gap-2 p-3.5">
        <WifiOff size={16} color="var(--color-muted)" className="mt-0.5 shrink-0" />
        <div>
          <p className="font-display text-sm font-bold text-muted">AI Coach band hai</p>
          <p className="mt-0.5 text-xs text-muted">
            AI tab mein provider enable karke API key daalo, phir yahan AI coach ka tip dikhega.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-panel p-3.5 text-xs text-muted">
        <Sparkles size={15} color="var(--color-light)" className="animate-pulse" />
        <span>AI coach aaj ka plan padh raha hai…</span>
      </div>
    );
  }

  if (status === 'error') {
    const activeId = container.providerSettings.getActiveProvider()?.id;
    const zenBlocked = activeId === 'opencode' || activeId === 'opencode-zen';
    return (
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3.5">
        <WifiOff size={16} color="var(--color-danger)" className="mt-0.5 shrink-0" />
        <div>
          <p className="font-display text-sm font-bold text-danger">AI coach offline</p>
          <p className="mt-0.5 text-xs text-muted">
            {error}. AI tab mein key/base URL/model check karo, phir "Test" dabao.
          </p>
          {zenBlocked && (
            <p className="mt-1 text-[11px] text-light">
              Note: OpenCode Zen browser mein direct nahi chalta (CORS support nahi). Mobile app mein native HTTP se
              chalega; preview ke liye AI tab mein OpenRouter ya Gemini choose karo.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="gradient-border mb-4 rounded-2xl p-px">
      <div className="flex items-start gap-2 rounded-2xl bg-panel-raised p-3.5">
        <Sparkles size={16} color="var(--color-light)" className="mt-0.5 shrink-0" />
        <div>
          <p className="mb-0.5 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted">
            <Wifi size={11} color="var(--color-success)" /> AI COACH · DAY {dayNumber}
          </p>
          <p className="text-sm leading-snug">{tip}</p>
        </div>
      </div>
    </div>
  );
}

function buildPrompt(
  dayNumber: number,
  levelTitle: string,
  pct: number,
  streak: number,
  recovery: boolean,
  examLeft: number | null,
  done: number,
  total: number,
): string {
  const parts: string[] = [];
  parts.push(`Day ${dayNumber} of 90.`);
  parts.push(`Current level: ${levelTitle}.`);
  parts.push(`Today plan: ${done}/${total} tasks done (${pct}%).`);
  parts.push(`Streak: ${streak} day(s).`);
  if (recovery) parts.push('RECOVERY MODE is active (yesterday was very low completion).');
  if (examLeft !== null) parts.push(`Exam in ${examLeft} days — exam month protocol (revision + mocks only).`);
  parts.push('Give a 1-3 line coaching tip for today.');
  return parts.join(' ');
}

function shortError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    return msg.length > 90 ? `${msg.slice(0, 90)}…` : msg;
  }
  return 'koi error aaya';
}
