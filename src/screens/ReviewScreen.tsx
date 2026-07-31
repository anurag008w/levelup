import { useState } from 'react';
import { CalendarClock, CalendarRange, Check, ClipboardList, History, NotebookPen, Siren, Trash2 } from 'lucide-react';
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

  if (!state.startDateISO) {
    return (
      <div className="screen">
        <ScreenHeader eyebrow="REVIEW & PROTOCOLS" title="Weekly · Monthly · Exam" />
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

  function submitWeekly() {
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
    update((s) => ({
      ...s,
      monthlyAssessments: [...s.monthlyAssessments, { monthNumber: currentMonthNumber(dayNumber), dateISO: todayISO(), reflection }],
    }));
    setReflection('');
  }

  function saveExamDate() {
    update((s) => ({ ...s, examDateISO: examDate || null }));
  }

  const pastCount = state.weeklyReviews.length + state.monthlyAssessments.length;

  return (
    <div className="screen fade-up">
      <ScreenHeader eyebrow="REVIEW & PROTOCOLS" title="Reviews & Exam Mode" subtitle="Hafta aur mahina — padh ke reflect karo." />

      {weekDue && (
        <Card accent="var(--color-l)" icon={<CalendarRange size={15} color="var(--color-l)" />} title={`Weekly Review — Week ${currentWeekNumber(dayNumber)}`}>
          <Field label="Is week sabse strong habit kaunsi rahi?" value={strongest} onChange={setStrongest} />
          <Field label="Sabse weak / bar-bar skip hone wali habit?" value={weakest} onChange={setWeakest} />
          <Field label="Agle week ke liye ek adjustment" value={plan} onChange={setPlan} />
          <button onClick={submitWeekly} className="btn btn-teal mt-1 w-full py-2.5 font-display text-sm font-bold">
            Weekly Review Save Karo
          </button>
        </Card>
      )}

      {monthDue && (
        <Card accent="var(--color-light)" icon={<CalendarClock size={15} color="var(--color-light)" />} title={`Monthly Assessment — Month ${currentMonthNumber(dayNumber)}`}>
          <Field label="Is mahine ka sabse bada mindset/skill shift?" value={reflection} onChange={setReflection} textarea />
          <button onClick={submitMonthly} className="btn btn-primary mt-1 w-full py-2.5 font-display text-sm font-bold">
            Monthly Assessment Save Karo
          </button>
        </Card>
      )}

      {!weekDue && !monthDue && (
        <div className="card mb-5 flex items-center gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-grid">
            <Check size={16} color="var(--color-success)" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            Koi review abhi due nahi hai. Weekly Day 7, 14, 21… aur Monthly Day 30, 60, 90 par unlock hoga.
          </p>
        </div>
      )}

      <Card accent="var(--color-danger)" icon={<Siren size={15} color="var(--color-danger)" />} title="Exam Month Protocol">
        <p className="mb-2 text-xs leading-relaxed text-muted">
          Apna JEE Main attempt date set karo — attempt se 30 din pehle Today screen automatically Exam Month mode mein switch ho
          jayega (naya topic band, sirf revision + mocks).
        </p>
        <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} className="field" />
        <button onClick={saveExamDate} className="btn mt-2 w-full py-2.5 font-display text-sm font-bold" style={{ backgroundColor: 'var(--color-danger)', color: 'var(--color-bg)' }}>
          Exam Date Save Karo
        </button>
      </Card>

      <div className="mb-2">
        <SectionHeader icon={<History size={14} color="var(--color-muted)" />} accent="var(--color-muted)" title="Past Reviews" meta={pastCount > 0 ? `${pastCount}` : undefined} />
      </div>
      {pastCount === 0 ? (
        <EmptyState icon={<ClipboardList size={24} color="var(--color-muted)" />} title="Abhi tak koi review nahi" hint="Pahli weekly review Day 7 par aayegi." />
      ) : (
        <div className="space-y-2">
          {[...state.weeklyReviews].reverse().map((r) => (
            <div key={`w${r.weekNumber}-${r.dateISO}`} className="card p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="chip" style={{ borderColor: 'var(--color-l-dim)', color: 'var(--color-l)' }}>
                  Week {r.weekNumber}
                </span>
                <span className="text-[10px] text-muted">{r.dateISO}</span>
              </div>
              <p className="text-xs text-muted">
                <span className="font-medium text-text">Strong:</span> {r.strongest || '—'}
              </p>
              <p className="text-xs text-muted">
                <span className="font-medium text-text">Weak:</span> {r.weakest || '—'}
              </p>
            </div>
          ))}
          {[...state.monthlyAssessments].reverse().map((r) => (
            <div key={`m${r.monthNumber}-${r.dateISO}`} className="card p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="chip" style={{ borderColor: 'var(--color-light-dim)', color: 'var(--color-light)' }}>
                  Month {r.monthNumber}
                </span>
                <span className="text-[10px] text-muted">{r.dateISO}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted">{r.reflection || '—'}</p>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={resetAll}
        className="btn mt-5 w-full border border-danger/40 bg-transparent py-2.5 text-xs text-danger hover:bg-danger/10"
      >
        <Trash2 size={13} />
        Reset All Progress
      </button>
    </div>
  );
}

function Card({ title, accent, icon, children }: { title: string; accent: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card mb-5 p-4">
      <p className="mb-3 flex items-center gap-1.5 font-display text-sm font-bold" style={{ color: accent }}>
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
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="field resize-none" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="field" />
      )}
    </div>
  );
}
