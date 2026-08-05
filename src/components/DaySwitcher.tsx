import { useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Lock, RotateCcw } from 'lucide-react';

/**
 * Admin-only day navigator. Lets the unlocked user preview any day of the
 * 90-day journey (plan, progress, chat context all follow along).
 */
export default function DaySwitcher({
  dayNumber,
  totalDays,
  dateLabel,
  onJump,
  onToday,
  onLock,
}: {
  dayNumber: number;
  totalDays: number;
  dateLabel: string;
  onJump: (day: number) => void;
  onToday: () => void;
  onLock: () => void;
}) {
  const [draft, setDraft] = useState(String(dayNumber));

  useEffect(() => {
    setDraft(String(dayNumber));
  }, [dayNumber]);

  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setDraft(String(dayNumber));
      return;
    }
    onJump(Math.min(Math.max(n, 1), totalDays));
  }

  const clampedDraft = () => {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) return dayNumber;
    return Math.min(Math.max(n, 1), totalDays);
  };

  return (
    <div className="card mb-4 overflow-hidden p-0" style={{ borderColor: 'rgba(239,233,223,0.35)' }}>
      <div className="bg-[rgba(239,233,223,0.12)] px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-peak)' }}>
          <CalendarDays size={13} /> Admin view
        </span>
        <span className="font-mono text-[11px] text-muted">{dateLabel}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">Day number type karo, phir Confirm dabao — exact selected day open hoga.</p>
      </div>

      <div className="p-3.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous day"
          onClick={() => onJump(dayNumber - 1)}
          disabled={dayNumber <= 1}
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: 'rgba(239,233,223,0.1)' }}>
          <input
            type="number"
            inputMode="numeric"
            className="w-full min-w-0 bg-transparent text-center font-display text-lg font-bold outline-none"
            value={draft}
            min={1}
            max={totalDays}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            aria-label={`Day ${dayNumber} of ${totalDays}`}
          />
          <span className="text-sm text-muted">/ {totalDays}</span>
        </div>

        <button
          type="button"
          className="icon-btn"
          aria-label="Next day"
          onClick={() => onJump(dayNumber + 1)}
          disabled={dayNumber >= totalDays}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-[1fr_1fr_auto] gap-2">
        <button type="button" className="btn btn-primary min-h-8 px-2 py-1 text-xs font-bold" onClick={() => onJump(clampedDraft())}>
          <Check size={13} /> Confirm
        </button>
        <button type="button" className="btn btn-ghost min-h-8 px-2 py-1 text-xs" onClick={onToday}>
          <RotateCcw size={13} /> Aaj (real date)
        </button>
        <button type="button" className="btn btn-ghost min-h-8 px-2.5 py-1 text-xs" style={{ color: 'var(--color-danger)' }} onClick={onLock}>
          <Lock size={13} /> Lock
        </button>
      </div>
      </div>
    </div>
  );
}
