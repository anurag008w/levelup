import { useState } from 'react';
import type { AppState } from '../types';
import {
  currentMonthNumber,
  currentWeekNumber,
  getCurrentDayNumber,
  isMonthlyAssessmentDue,
  isWeeklyReviewDue,
} from '../lib/engine';
import { todayISO } from '../lib/storage';

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
      <div className="mx-auto max-w-md px-4 pb-28 pt-6 text-center text-muted">
        <p className="mt-16 text-sm">Mission shuru karo Today tab se — reviews yahin dikhenge.</p>
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

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="font-mono text-[11px] tracking-widest text-muted">REVIEW & PROTOCOLS</p>
        <h1 className="font-display text-lg font-bold">Weekly · Monthly · Exam Mode</h1>
      </header>

      {weekDue && (
        <Card title={`Weekly Review — Week ${currentWeekNumber(dayNumber)}`} accent="var(--color-l)">
          <Field label="Is week sabse strong habit kaunsi rahi?" value={strongest} onChange={setStrongest} />
          <Field label="Sabse weak / bar-bar skip hone wali habit?" value={weakest} onChange={setWeakest} />
          <Field label="Agle week ke liye ek adjustment" value={plan} onChange={setPlan} />
          <button onClick={submitWeekly} className="mt-1 w-full rounded-lg py-2.5 font-display text-sm font-bold text-bg" style={{ backgroundColor: 'var(--color-l)' }}>
            Weekly Review Save Karo
          </button>
        </Card>
      )}

      {monthDue && (
        <Card title={`Monthly Assessment — Month ${currentMonthNumber(dayNumber)}`} accent="var(--color-light)">
          <Field label="Is mahine ka sabse bada mindset/skill shift?" value={reflection} onChange={setReflection} textarea />
          <button onClick={submitMonthly} className="mt-1 w-full rounded-lg py-2.5 font-display text-sm font-bold text-bg" style={{ backgroundColor: 'var(--color-light)' }}>
            Monthly Assessment Save Karo
          </button>
        </Card>
      )}

      {!weekDue && !monthDue && (
        <div className="mb-6 rounded-xl border p-4 text-sm text-muted" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
          Koi review abhi due nahi hai. Weekly review Day 7, 14, 21... par aur Monthly assessment Day 30, 60, 90 par unlock hoga.
        </div>
      )}

      <Card title="Exam Month Protocol" accent="var(--color-danger)">
        <p className="mb-2 text-xs text-muted">
          Apna JEE Main attempt date set karo — attempt se 30 din pehle Today screen automatically Exam Month mode mein switch ho jayega
          (naya topic band, sirf revision + mocks).
        </p>
        <input
          type="date"
          value={examDate}
          onChange={(e) => setExamDate(e.target.value)}
          className="w-full rounded-lg border bg-panel-raised px-3 py-2.5 text-sm text-text"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button onClick={saveExamDate} className="mt-2 w-full rounded-lg py-2.5 font-display text-sm font-bold text-bg" style={{ backgroundColor: 'var(--color-danger)' }}>
          Exam Date Save Karo
        </button>
      </Card>

      <Card title="Past Reviews" accent="var(--color-muted)">
        {state.weeklyReviews.length === 0 && state.monthlyAssessments.length === 0 ? (
          <p className="text-xs text-muted">Abhi tak koi review submit nahi hui.</p>
        ) : (
          <div className="space-y-3">
            {[...state.weeklyReviews].reverse().map((r) => (
              <div key={`w${r.weekNumber}`} className="text-xs">
                <p className="font-medium text-text">Week {r.weekNumber}</p>
                <p className="text-muted">💪 {r.strongest || '—'}</p>
                <p className="text-muted">⚠️ {r.weakest || '—'}</p>
              </div>
            ))}
            {[...state.monthlyAssessments].reverse().map((r) => (
              <div key={`m${r.monthNumber}`} className="text-xs">
                <p className="font-medium text-text">Month {r.monthNumber}</p>
                <p className="text-muted">{r.reflection || '—'}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <button onClick={resetAll} className="mt-2 w-full rounded-lg border py-2.5 text-xs text-danger" style={{ borderColor: 'var(--color-danger)' }}>
        Reset All Progress
      </button>
    </div>
  );
}

function Card({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
      <p className="mb-3 font-display text-sm font-bold" style={{ color: accent }}>
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
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border bg-panel-raised px-3 py-2 text-sm text-text"
          style={{ borderColor: 'var(--color-border)' }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border bg-panel-raised px-3 py-2 text-sm text-text"
          style={{ borderColor: 'var(--color-border)' }}
        />
      )}
    </div>
  );
}
