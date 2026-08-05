import { useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarDays, Check, ChevronDown, Copy, FileText, FlaskConical, ListChecks, Sparkles, Trash2, Upload } from 'lucide-react';
import type { AppState } from '../types';
import type { PlannerRoutineRow, PlannerTestRow, SubjectPlanner } from '../core/domain/subject-planner';
import { PLANNER_CONVERSION_PROMPT, groupBySubject, plannerCountLabel, kindLabel } from '../core/domain/subject-planner';
import { container } from '../di/container';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';

type Notice = { type: 'ok' | 'error' | 'info'; text: string } | null;

/**
 * Planners — upload coaching planners in three kinds: SUBJECT (chapters/topics/
 * lectures per subject), TEST (tests with date + per-subject syllabus) and
 * ROUTINE (weekly class time-table). Import path: copy the conversion prompt →
 * paste your file into any external AI → paste/upload the returned JSON here.
 * Misa (the AI) reads all of them through the built-in planner tools.
 */
export default function PlannersScreen({ state, update }: { state: AppState; update: (fn: (s: AppState) => AppState) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const grouped = useMemo(() => groupBySubject(state.subjectPlanners ?? []), [state.subjectPlanners]);
  const stats = useMemo(() => {
    const planners = state.subjectPlanners ?? [];
    const subjects = new Set<string>();
    let tests = 0;
    let days = 0;
    for (const p of planners) {
      if (p.kind === 'subject') subjects.add(p.subject);
      tests += p.kind === 'test' ? (p.tests ?? []).length : 0;
      days += p.kind === 'routine' ? (p.routine ?? []).length : 0;
    }
    return { subjects: subjects.size, planners: planners.length, tests, days };
  }, [state.subjectPlanners]);

  function flash(n: Notice) {
    setNotice(n);
    if (n) window.setTimeout(() => setNotice(null), 4000);
  }

  function refresh() {
    update(() => container.store.get());
  }

  async function copyPrompt() {
    haptic();
    try {
      await navigator.clipboard.writeText(PLANNER_CONVERSION_PROMPT);
      setCopied(true);
      flash({ type: 'ok', text: 'Conversion prompt copy ho gaya — kisi bhi AI (ChatGPT/Claude/Gemini) mein paste karke apni file convert karwao.' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      flash({ type: 'error', text: 'Clipboard access nahi mila — prompt neeche select karke manually copy karo.' });
    }
  }

  function doImport(text: string, meta: { source: 'file' | 'paste'; fileName?: string }) {
    try {
      const result = container.plannerService.importPlanners(text, meta);
      refresh();
      if (result.added === 0) {
        flash({ type: 'info', text: 'Koi naya planner add nahi hua — ye planners pehle se already saved hain.' });
        return;
      }
      flash({ type: 'ok', text: `${result.added} planner${result.added === 1 ? '' : 's'} add ho gaye.${result.skipped > 0 ? ` ${result.skipped} duplicate skip.` : ''} Ab Misa se pucho — "physics mein kya kya hai".` });
      setPaste('');
    } catch (err) {
      flash({ type: 'error', text: err instanceof Error ? err.message : 'Import fail ho gaya.' });
    }
  }

  function handleImportPaste() {
    if (!paste.trim()) {
      flash({ type: 'error', text: 'Pehle JSON paste karo — ya copy prompt use karke external AI se banwao.' });
      return;
    }
    haptic();
    doImport(paste, { source: 'paste' });
  }

  function handleFile(file: File | null) {
    if (!file) return;
    haptic();
    const reader = new FileReader();
    reader.onload = () => {
      doImport(String(reader.result ?? ''), { source: 'file', fileName: file.name });
    };
    reader.onerror = () => flash({ type: 'error', text: 'File padhna fail ho gaya.' });
    reader.readAsText(file);
  }

  function deletePlanner(planner: SubjectPlanner) {
    if (!window.confirm(`"${planner.title}" delete karna hai? (${planner.subject} — ${plannerCountLabel(planner)})`)) return;
    haptic();
    container.plannerService.remove(planner.id);
    refresh();
    flash({ type: 'info', text: `"${planner.title}" delete ho gaya.` });
  }

  function toggleItem(plannerId: string, itemId: string, done: boolean) {
    haptic();
    container.plannerService.toggleItem(plannerId, itemId, done);
    refresh();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="SUBJECT PLANNERS"
        title="Planners"
        subtitle="PCM aur custom subjects ke planners upload karo — Misa unhe padh aur answer kar sakti hai."
      />

      {/* How it works */}
      <div className="gradient-border mb-5 rounded-[1.35rem] p-px" data-tone="blood">
        <div className="rounded-[calc(1.35rem-1px)] bg-panel p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(201,87,87,0.14)', color: 'var(--color-danger)' }}>
                <Sparkles size={16} />
              </span>
              <div>
              <p className="font-display text-[15px] font-bold">Kisi bhi file se planner banao</p>
              <p className="text-xs text-muted">3 steps — ek file mein sab kuch, koi coding nahi</p>
              </div>
            </div>
            <button type="button" onClick={() => void copyPrompt()} className="btn btn-primary min-h-9 shrink-0 gap-1.5 px-3 text-xs">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied!' : 'Copy prompt'}
            </button>
          </div>
          <ol className="space-y-2 text-[12px] leading-relaxed text-muted">
            <li className="flex gap-2">
              <span className="badge shrink-0" style={{ backgroundColor: 'rgba(201,87,87,0.12)', color: 'var(--color-danger)' }}>1</span>
              <span><b className="text-text">Copy prompt</b> dabao — prompt clipboard mein aa jayega.</span>
            </li>
            <li className="flex gap-2">
              <span className="badge shrink-0" style={{ backgroundColor: 'rgba(201,87,87,0.12)', color: 'var(--color-danger)' }}>2</span>
              <span>Apni <b className="text-text">poori file</b> (PDF/Excel/screenshot text — lectures + tests + routine sab ek saath) + ye prompt <b className="text-text">kisi bhi external AI</b> (ChatGPT/Claude/Gemini) mein paste karo — wo poora content jaise ka waisa JSON bana dega.</span>
            </li>
            <li className="flex gap-2">
              <span className="badge shrink-0" style={{ backgroundColor: 'rgba(201,87,87,0.12)', color: 'var(--color-danger)' }}>3</span>
              <span>Wahi JSON <b className="text-text">neeche paste ya upload</b> karo — planner saved. Phir Misa se pucho: <b className="text-text">"physics mein kya kya hai"</b>, <b className="text-text">"AITS-1 mein kya aayega"</b> ya <b className="text-text">"monday ko kya class hai"</b>.</span>
            </li>
          </ol>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-4 gap-2">
        <MiniStat label="Planners" value={String(stats.planners)} />
        <MiniStat label="Subjects" value={String(stats.subjects)} />
        <MiniStat label="Tests" value={String(stats.tests)} />
        <MiniStat label="Days" value={String(stats.days)} />
      </div>

      {/* Import */}
      <div className="mb-2.5">
        <SectionHeader icon={<Upload size={14} color="var(--color-l)" />} accent="var(--color-l)" title="Import planners" meta="JSON only" />
      </div>
      <div className="card mb-5 p-4">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">External AI ka JSON</span>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder='{"version":2,"type":"levelup-subject-planner","planners":[{"kind":"test",...}]} — yahan paste karo'
            className="field min-h-28 resize-none font-mono text-[11px]"
          />
        </label>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button type="button" onClick={handleImportPaste} className="btn btn-primary min-h-10 gap-2">
            <ListChecks size={15} /> Import JSON
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-ghost min-h-10 gap-2">
            <Upload size={15} /> Upload .json
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,text/plain,text/markdown"
            className="hidden"
            aria-label="Upload planner JSON file"
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>
        {notice && (
          <p
            className="mt-3 rounded-xl px-3 py-2 text-xs"
            style={
              notice.type === 'error'
                ? { backgroundColor: 'rgba(201,87,87,0.12)', color: 'var(--color-danger)' }
                : notice.type === 'ok'
                  ? { backgroundColor: 'rgba(138,154,91,0.13)', color: 'var(--color-success)' }
                  : { backgroundColor: 'rgba(79,209,197,0.13)', color: 'var(--color-l)' }
            }
          >
            {notice.text}
          </p>
        )}
      </div>

      {/* Uploaded planners */}
      <div className="mb-2.5">
        <SectionHeader
          icon={<BookOpen size={14} color="var(--color-l)" />}
          accent="var(--color-l)"
          title="Uploaded planners"
          meta={`${stats.planners} total · ${stats.tests} tests · ${stats.days} days`}
        />
      </div>

      {stats.planners === 0 ? (
        <div className="card mb-5 flex flex-col items-center gap-3 p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-l/10 text-l">
            <FileText size={22} />
          </span>
          <div>
            <p className="font-display text-[15px] font-bold">Abhi koi planner nahi</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
              Copy prompt se apni file convert karwao, phir JSON import karo — subject planner, test planner (AITS/JEE Mains) aur weekly routine sab chalega. Har planner alag dikhega aur Misa use padh sakegi.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-8 space-y-4">
          {[...grouped.entries()].map(([subject, list]) => {
            const itemTotal = list.reduce((sum, p) => sum + p.items.length, 0);
            const itemDone = list.reduce((sum, p) => sum + p.items.filter((i) => i.done).length, 0);
            const testTotal = list.reduce((sum, p) => sum + (p.kind === 'test' ? (p.tests ?? []).length : 0), 0);
            const dayTotal = list.reduce((sum, p) => sum + (p.kind === 'routine' ? (p.routine ?? []).length : 0), 0);
            const subtitle = [
              `${list.length} planner${list.length === 1 ? '' : 's'}`,
              itemTotal > 0 ? `${itemTotal} items${itemDone > 0 ? ` · ${itemDone} done` : ''}` : '',
              testTotal > 0 ? `${testTotal} tests` : '',
              dayTotal > 0 ? `${dayTotal} days` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <section key={subject} className="overflow-hidden rounded-[1.25rem] border border-border bg-panel">
                <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'rgba(138,154,91,0.14)', color: 'var(--color-l)' }}>
                      {list[0]?.kind === 'test' ? <FlaskConical size={16} /> : list[0]?.kind === 'routine' ? <CalendarDays size={16} /> : <BookOpen size={16} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-display text-[15px] font-bold">{subject}</p>
                      <p className="text-[11px] text-muted">{subtitle}</p>
                    </div>
                  </div>
                </header>
                <div className="divide-y divide-border">
                  {list.map((planner) => (
                    <PlannerRow
                      key={planner.id}
                      planner={planner}
                      expanded={expanded.has(planner.id)}
                      onToggle={() => toggleExpand(planner.id)}
                      onDelete={() => deletePlanner(planner)}
                      onToggleItem={(itemId, done) => toggleItem(planner.id, itemId, done)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlannerRow({
  planner,
  expanded,
  onToggle,
  onDelete,
  onToggleItem,
}: {
  planner: SubjectPlanner;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onToggleItem: (itemId: string, done: boolean) => void;
}) {
  const doneCount = planner.items.filter((i) => i.done).length;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text">{planner.title}</span>
            <span className="block text-[11px] text-muted">
              <span className="badge mr-1" style={{ backgroundColor: 'rgba(201,87,87,0.10)', color: 'var(--color-danger)' }}>
                {kindLabel(planner.kind)}
              </span>
              {plannerCountLabel(planner)}
              {doneCount > 0 ? ` · ${doneCount} done` : ''}
              {planner.fileName ? ` · ${planner.fileName}` : ''}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {planner.kind === 'subject' && doneCount > 0 && (
            <span className="badge" style={{ backgroundColor: 'rgba(138,154,91,0.13)', color: 'var(--color-success)' }}>
              {doneCount}/{planner.items.length}
            </span>
          )}
          <button type="button" onClick={onDelete} className="memory-action text-danger" aria-label={`Delete ${planner.title}`}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2.5 rounded-xl border border-border bg-bg/50 p-2.5">
          {planner.description && <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted">{planner.description}</p>}
          {planner.kind === 'test' ? (
            <TestRows rows={planner.tests ?? []} />
          ) : planner.kind === 'routine' ? (
            <RoutineRows rows={planner.routine ?? []} />
          ) : (
            <SubjectItems planner={planner} onToggleItem={onToggleItem} />
          )}
        </div>
      )}
    </div>
  );
}

function SubjectItems({ planner, onToggleItem }: { planner: SubjectPlanner; onToggleItem: (itemId: string, done: boolean) => void }) {
  const sorted = [...planner.items].sort((a, b) => (a.week ?? 0) - (b.week ?? 0) || a.title.localeCompare(b.title));
  if (sorted.length === 0) {
    return <p className="px-1 py-1 text-xs text-muted">Is planner mein koi items nahi hain.</p>;
  }
  return (
    <ul className="max-h-[46vh] space-y-0.5 overflow-y-auto pr-1">
      {sorted.map((item) => (
        <li key={item.id} className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-panel-raised/60">
          <button
            type="button"
            onClick={() => onToggleItem(item.id, !item.done)}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${item.done ? 'border-success bg-success/20 text-success' : 'border-border text-transparent'}`}
            aria-label={item.done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
          >
            <Check size={11} strokeWidth={3} />
          </button>
          <div className="min-w-0 flex-1">
            <p className={`text-[12px] leading-snug ${item.done ? 'text-muted line-through' : 'text-text'}`}>
              {item.week !== undefined && <span className="mr-1 font-mono text-[10px] text-muted">W{item.week}</span>}
              {item.type !== 'topic' && <span className="mr-1 uppercase tracking-wide text-muted text-[9px]">{item.type}</span>}
              {item.title}
            </p>
            {item.details && <p className="text-[10px] leading-snug text-muted">{item.details}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TestRows({ rows }: { rows: PlannerTestRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-1 text-xs text-muted">Is planner mein koi test nahi hai.</p>;
  }
  return (
    <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
      {rows.map((test) => {
        const meta = [test.date, test.pattern, test.testType].filter(Boolean).join(' · ');
        return (
          <div key={test.id} className="rounded-xl border border-border bg-bg/40 p-2.5">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
              <FlaskConical size={12} className="shrink-0 text-danger" />
              {test.name}
              {meta && <span className="ml-auto shrink-0 text-right text-[10px] font-normal text-muted">{meta}</span>}
            </p>
            <div className="mt-2 space-y-1.5">
              {Object.entries(test.syllabus ?? {}).map(([subject, topics]) => (
                <div key={subject} className="text-[11px] leading-snug">
                  <span className="font-semibold uppercase tracking-wide text-l">{subject}:</span>
                  <span className="ml-1.5 text-muted">{topics.join(' · ')}</span>
                </div>
              ))}
              {Object.keys(test.syllabus ?? {}).length === 0 && <p className="text-[10px] text-muted">Syllabus available nahi hai.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoutineRows({ rows }: { rows: PlannerRoutineRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-1 text-xs text-muted">Is planner mein koi day nahi hai.</p>;
  }
  return (
    <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-border bg-bg/40 p-2.5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-text">{row.day}</p>
          <div className="mt-1.5 space-y-1">
            {row.slots.map((slot, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-muted">{slot.time}</span>
                <span className="text-text">{slot.activity}</span>
              </div>
            ))}
            {row.slots.length === 0 && <p className="text-[10px] text-muted">No slots.</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-dim">{label}</p>
      <p className="mt-1 font-display text-lg font-bold">{value}</p>
    </div>
  );
}
