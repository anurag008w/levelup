import { lazy, Suspense, useState } from 'react';
import { CalendarClock, CalendarRange, Check, ChevronRight, ClipboardList, History, Medal, NotebookPen, Siren, Trash2 } from 'lucide-react';
import type { AppState } from '../types';
import {
  currentMonthNumber,
  currentWeekNumber,
  getCurrentDayNumber,
  isMonthlyAssessmentDue,
  isWeeklyReviewDue,
} from '../lib/engine';
import { todayISO } from '../lib/storage';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import EmptyState from '../components/ui/EmptyState';
import { haptic, hapticSuccess } from '../lib/haptics';

const PostJourneyScreen = lazy(() => import('./PostJourneyScreen'));

export default function ReviewScreen({
  state,
  today,
  update,
  resetAll,
}: {
  state: AppState;
  today: string;
  update: (fn: (s: AppState) => AppState) => void;
  resetAll: () => void;
}) {
  const [strongest, setStrongest] = useState('');
  const [weakest, setWeakest] = useState('');
  const [plan, setPlan] = useState('');
  const [reflection, setReflection] = useState('');
  const [examDate, setExamDate] = useState(state.examDateISO ?? '');
  const [showPostJourney, setShowPostJourney] = useState(false);

  // Show Post-Journey screen if navigating there
  if (showPostJourney) {
    return (
      <Suspense fallback={<div className="screen"><ScreenHeader eyebrow="" title="Loading..." /></div>}>
        <PostJourneyScreen state={state} update={update} onBack={() => setShowPostJourney(false)} />
      </Suspense>
    );
  }

  if (!state.startDateISO) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="REVIEW & PROTOCOLS" title="Review" />
        <EmptyState
          icon={<NotebookPen size={28} color="var(--color-muted)" />}
          title="Mission shuru nahi hua"
          hint="Today tab se shuru karo — reviews aur protocols yahin dikhenge."
        />
      </div>
    );
  }

  const dayNumber = getCurrentDayNumber(state, today);
  const weekDue = isWeeklyReviewDue(state, dayNumber);
  const monthDue = isMonthlyAssessmentDue(state, dayNumber);
  const nextWeek = currentWeekNumber(dayNumber);
  const nextWeekDay = nextWeek * 7;
  const daysToWeek = Math.max(0, nextWeekDay - dayNumber);
  const nextMonth = currentMonthNumber(dayNumber);
  const nextMonthDay = nextMonth * 30;
  const daysToMonth = Math.max(0, nextMonthDay - dayNumber);

  const examLeft = examDaysLeft(state, today);
  const examProgress = examLeft === null ? 0 : Math.min(1, Math.max(0, (30 - examLeft) / 30));

  function submitWeekly() {
    hapticSuccess();
    update((s) => ({
      ...s,
      weeklyReviews: [
        ...s.weeklyReviews,
        { weekNumber: currentWeekNumber(dayNumber), dateISO: todayISO(), strongest, weakest, planForNextWeek: plan },
      ],
    }));
    setStrongest('');
    setWeakest('');
    setPlan('');
  }

  function submitMonthly() {
    hapticSuccess();
    update((s) => ({
      ...s,
      monthlyAssessments: [...s.monthlyAssessments, { monthNumber: currentMonthNumber(dayNumber), dateISO: todayISO(), reflection }],
    }));
    setReflection('');
  }

  function saveExamDate() {
    haptic();
    update((s) => ({ ...s, examDateISO: examDate || null }));
  }

  const pastCount = state.weeklyReviews.length + state.monthlyAssessments.length;

  return (
    <div className="screen fade-up">
      <ScreenHeader eyebrow="REVIEW & PROTOCOLS" title="Review" subtitle="Hafta aur mahina — padh ke reflect karo." />

      {/* Exam countdown hero */}
      {examLeft !== null ? (
        <div className="gradient-border mb-4 rounded-[1.25rem] p-px">
          <div className="flex items-center gap-4 rounded-[calc(1.25rem-1px)] bg-panel p-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
              <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                <circle cx="32" cy="32" r="27" stroke="var(--color-grid)" strokeWidth="6" fill="none" />
                <circle
                  cx="32"
                  cy="32"
                  r="27"
                  stroke="var(--color-light)"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 27}
                  strokeDashoffset={2 * Math.PI * 27 * (1 - examProgress)}
                  style={{ transition: 'stroke-dashoffset 0.8s var(--ease-emphasized)' }}
                />
              </svg>
              <span className="absolute font-display text-sm font-bold text-light">{examLeft}</span>
            </div>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold text-light">Exam Month Active</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">
                JEE Main tak {examLeft} din. Today screen ab revision-only mode mein hai.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card mb-4 flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel-raised">
            <Siren size={17} color="var(--color-danger)" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            JEE Main date set karo — attempt se 30 din pehle app automatically exam month mode mein switch ho jayega.
          </p>
        </div>
      )}

      {/* Upcoming */}
      <div className="card mb-4 p-4">
        <SectionHeader icon={<CalendarRange size={14} color="var(--color-l)" />} accent="var(--color-l)" title="Upcoming" />
        <div className="space-y-2">
          <UpcomingRow
            icon={<CalendarRange size={15} color={weekDue ? 'var(--color-l)' : 'var(--color-muted-dim)'} />}
            title={`Weekly Review — Week ${nextWeek}`}
            when={weekDue ? 'Due today' : `Day ${nextWeekDay} · ${daysToWeek} din baaki`}
            due={weekDue}
          />
          <UpcomingRow
            icon={<CalendarClock size={15} color={monthDue ? 'var(--color-light)' : 'var(--color-muted-dim)'} />}
            title={`Monthly Assessment — Month ${nextMonth}`}
            when={monthDue ? 'Due today' : `Day ${nextMonthDay} · ${daysToMonth} din baaki`}
            due={monthDue}
          />
        </div>
      </div>

      {weekDue && (
        <Card accent="var(--color-l)" icon={<CalendarRange size={15} color="var(--color-l)" />} title={`Weekly Review — Week ${currentWeekNumber(dayNumber)}`}>
          <Field label="Is week sabse strong habit kaunsi rahi?" value={strongest} onChange={setStrongest} />
          <Field label="Sabse weak / bar-bar skip hone wali habit?" value={weakest} onChange={setWeakest} />
          <Field label="Agle week ke liye ek adjustment" value={plan} onChange={setPlan} />
          <button onClick={submitWeekly} className="btn btn-teal mt-1 w-full font-display text-sm font-bold">
            Weekly Review Save Karo
          </button>
        </Card>
      )}

      {monthDue && (
        <Card accent="var(--color-light)" icon={<CalendarClock size={15} color="var(--color-light)" />} title={`Monthly Assessment — Month ${currentMonthNumber(dayNumber)}`}>
          <Field label="Is mahine ka sabse bada mindset/skill shift?" value={reflection} onChange={setReflection} textarea />
          <button onClick={submitMonthly} className="btn btn-primary mt-1 w-full font-display text-sm font-bold">
            Monthly Assessment Save Karo
          </button>
        </Card>
      )}

      {!weekDue && !monthDue && (
        <div className="card mb-4 flex items-center gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(52,211,153,0.14)' }}>
            <Check size={16} color="var(--color-success)" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            Koi review abhi due nahi hai. Weekly Day 7, 14, 21… aur Monthly Day 30, 60, 90 par unlock hota hai.
          </p>
        </div>
      )}

      <Card accent="var(--color-danger)" icon={<Siren size={15} color="var(--color-danger)" />} title="Exam Month Protocol">
        <p className="mb-3 text-sm leading-relaxed text-muted">
          Apna JEE Main attempt date set karo — attempt se 30 din pehle Today screen automatically Exam Month mode mein switch ho
          jayega (naya topic band, sirf revision + mocks).
        </p>
        <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className="field" aria-label="Exam date" />
        <button
          onClick={saveExamDate}
          className="btn mt-2.5 w-full font-display text-sm font-bold"
          style={{ backgroundColor: 'var(--color-danger)', color: 'var(--color-bg)' }}
        >
          Exam Date Save Karo
        </button>
      </Card>

      <div className="mb-2.5">
        <SectionHeader icon={<History size={14} color="var(--color-muted)" />} accent="var(--color-muted)" title="Past Reviews" meta={pastCount > 0 ? `${pastCount}` : undefined} />
      </div>

      {pastCount === 0 ? (
        <EmptyState icon={<ClipboardList size={24} color="var(--color-muted)" />} title="Abhi tak koi review nahi" hint="Pahli weekly review Day 7 par aayegi." />
      ) : (
        <div className="relative space-y-2.5">
          <div className="absolute bottom-4 left-[7px] top-4 w-[2px] rounded-full bg-grid" aria-hidden="true" />
          {[...state.weeklyReviews].reverse().map((r) => (
            <div key={`w${r.weekNumber}-${r.dateISO}`} className="relative pl-7">
              <span className="absolute left-0 top-5 h-4 w-4 rounded-full border-2 border-l bg-bg" style={{ borderColor: 'var(--color-l)' }} aria-hidden="true" />
              <div className="card p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="badge" style={{ backgroundColor: 'rgba(79,209,197,0.14)', color: 'var(--color-l)' }}>
                    Week {r.weekNumber}
                  </span>
                  <span className="text-[10px] text-muted-dim">{r.dateISO}</span>
                </div>
                <p className="text-sm text-muted">
                  <span className="font-semibold text-text">Strong:</span> {r.strongest || '—'}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  <span className="font-semibold text-text">Weak:</span> {r.weakest || '—'}
                </p>
                {r.planForNextWeek && (
                  <p className="mt-1 flex items-start gap-1 text-sm text-muted">
                    <ChevronRight size={13} className="mt-0.5 shrink-0" />
                    <span>{r.planForNextWeek}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
          {[...state.monthlyAssessments].reverse().map((r) => (
            <div key={`m${r.monthNumber}-${r.dateISO}`} className="relative pl-7">
              <span className="absolute left-0 top-5 h-4 w-4 rounded-full border-2 border-light bg-bg" style={{ borderColor: 'var(--color-light)' }} aria-hidden="true" />
              <div className="card p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="badge" style={{ backgroundColor: 'rgba(245,179,103,0.14)', color: 'var(--color-light)' }}>
                    Month {r.monthNumber}
                  </span>
                  <span className="text-[10px] text-muted-dim">{r.dateISO}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted">{r.reflection || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={resetAll}
        className="btn mt-6 w-full border border-danger/40 bg-transparent text-sm text-danger hover:bg-danger/10"
      >
        <Trash2 size={14} />
        Reset All Progress
      </button>

      {/* Post-Journey Section */}
      {(state.postJourney?.journeyComplete || dayNumber >= 85) && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowPostJourney(true)}
            className="gradient-border w-full rounded-[1.25rem] p-px text-left"
          >
            <div className="flex items-center justify-between rounded-[calc(1.25rem-1px)] bg-panel p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(245,179,103,0.15)' }}>
                  <Medal size={18} color="var(--color-light)" />
                </span>
                <div>
                  <p className="font-display text-[15px] font-bold">Post-Journey</p>
                  <p className="text-xs leading-snug text-muted">
                    {state.postJourney?.journeyComplete 
                      ? `${state.postJourney.customPhases.length} custom phases`
                      : `${90 - dayNumber} days to complete!`}
                  </p>
                </div>
              </div>
              <ChevronRight size={18} className="text-muted" />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function UpcomingRow({ icon, title, when, due }: { icon: React.ReactNode; title: string; when: string; due: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-bg/60 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-panel-raised">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted">{when}</p>
      </div>
      <span
        className="badge shrink-0"
        style={{
          backgroundColor: due ? 'rgba(79,209,197,0.14)' : 'var(--color-panel-raised)',
          color: due ? 'var(--color-l)' : 'var(--color-muted-dim)',
        }}
      >
        {due ? 'Due' : 'Soon'}
      </span>
    </div>
  );
}

function Card({ title, accent, icon, children }: { title: string; accent: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card mb-4 p-4">
      <p className="mb-3 flex items-center gap-1.5 font-display text-[15px] font-bold" style={{ color: accent }}>
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <div className="mb-3">
      <label className="field-label">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="field resize-none" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="field" />
      )}
    </div>
  );
}

function examDaysLeft(state: AppState, todayISO: string): number | null {
  if (!state.examDateISO) return null;
  const MS_DAY = 24 * 60 * 60 * 1000;
  const today = new Date(`${todayISO}T00:00:00`).getTime();
  const exam = new Date(`${state.examDateISO}T00:00:00`).getTime();
  return Math.round((exam - today) / MS_DAY);
}
