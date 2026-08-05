import { useState } from 'react';
import { 
  Trophy, Zap, Target, Clock, TrendingUp, Sparkles, ChevronRight, 
  Check, X, Trash2, Plus, BookOpen, Brain, FlaskConical,
  Atom, Calculator, Beaker, Lightbulb,
  ListChecks, Wand2, User
} from 'lucide-react';
import type { AppState } from '../types';
import type { CustomPhase, MasteryLevel } from '../core/domain/state';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeader from '../components/ui/SectionHeader';
import { haptic } from '../lib/haptics';
import { container } from '../di/container';
import { PhaseGeneratorService, type JourneyStats } from '../features/ai/phase-generator.service';
import { isoDate } from '../core/ports/clock';

interface PostJourneyScreenProps {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  onBack?: () => void;
}

const MASTERY_CONFIG: Record<MasteryLevel, { label: string; color: string; bgColor: string; icon: typeof Zap }> = {
  beginner: { label: 'Beginner', color: 'text-muted', bgColor: 'bg-muted/20', icon: Target },
  intermediate: { label: 'Intermediate', color: 'text-tag-concept', bgColor: 'bg-tag-concept/20', icon: TrendingUp },
  advanced: { label: 'Advanced', color: 'text-l', bgColor: 'bg-l/20', icon: Zap },
  expert: { label: 'Expert', color: 'text-gold', bgColor: 'bg-gold/20', icon: Trophy },
};

const BLOCK_TYPES = [
  { id: 'physics', name: 'Physics', icon: Atom, color: 'var(--color-tag-physics)' },
  { id: 'chemistry', name: 'Chemistry', icon: FlaskConical, color: 'var(--color-tag-chemistry)' },
  { id: 'maths', name: 'Maths', icon: Calculator, color: 'var(--color-tag-maths)' },
  { id: 'revision', name: 'Revision', icon: BookOpen, color: 'var(--color-tag-revision)' },
  { id: 'mock', name: 'Mock Test', icon: Brain, color: 'var(--color-tag-mock)' },
  { id: 'concept', name: 'Concept Building', icon: Lightbulb, color: 'var(--color-tag-concept)' },
  { id: 'problem', name: 'Problem Solving', icon: Beaker, color: 'var(--color-tag-problem)' },
];

const DIFFICULTY_COLORS = {
  easy: { bg: 'bg-l/15', text: 'text-l', border: 'border-l/30' },
  medium: { bg: 'bg-gold/15', text: 'text-gold', border: 'border-gold/30' },
  hard: { bg: 'bg-danger/15', text: 'text-danger', border: 'border-danger/30' },
  extreme: { bg: 'bg-danger/25', text: 'text-danger', border: 'border-danger/50' },
};

export default function PostJourneyScreen({ state, update, onBack }: PostJourneyScreenProps) {
  const postJourney = state.postJourney;
  const masteryConfig = MASTERY_CONFIG[postJourney.mastery.level];
  const [showGenerator, setShowGenerator] = useState(false);

  // Generator wizard state
  const [genStep, setGenStep] = useState(1);
  const [genDays, setGenDays] = useState(15);
  const [genFocus, setGenFocus] = useState<string[]>([]);
  const [genDifficulty, setGenDifficulty] = useState<'easy' | 'medium' | 'hard' | 'extreme'>('medium');
  const [genGoals, setGenGoals] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  function completeJourney() {
    haptic();
    const phaseGenerator = new PhaseGeneratorService(container.llm, container.store);
    const finalStats = phaseGenerator.generateFinalStats(state);
    const topicScores = phaseGenerator.calculateTopicScores(state);
    
    const stats: JourneyStats = {
      totalTasks: finalStats.totalTasksCompleted,
      completedTasks: finalStats.totalTasksCompleted,
      accuracy: finalStats.averageAccuracy,
      studyHours: finalStats.totalStudyHours,
      streakDays: finalStats.streakDays,
      clearedLevels: finalStats.levelCleared,
    };
    const masteryLevel = phaseGenerator.calculateMastery(stats);

    update((s) => ({
      ...s,
      postJourney: {
        ...s.postJourney,
        journeyComplete: true,
        completedAt: new Date().toISOString(),
        finalStats,
        mastery: {
          level: masteryLevel,
          topicScores,
          unlockedAt: new Date().toISOString(),
        },
      },
    }));
  }

  async function generatePhase() {
    setIsGenerating(true);
    haptic();
    
    // Create AI-powered phase with smart defaults
    const existingPhases = state.postJourney.customPhases;
    const lastPhase = existingPhases[existingPhases.length - 1];
    const dayStart = lastPhase ? lastPhase.dayEnd + 1 : 91;
    
    // Generate habits based on focus areas
    const habits = generateHabitsForFocus(genFocus, genDifficulty);
    const goals = genGoals ? genGoals.split(',').map(g => g.trim()).filter(Boolean) : generateDefaultGoals(genFocus);
    
    const suggestion: CustomPhase = {
      id: `ai-phase-${Date.now()}`,
      name: generatePhaseName(genFocus),
      description: `Custom block focused on ${genFocus.join(', ')} with ${genDifficulty} difficulty`,
      dayStart,
      dayEnd: dayStart + genDays - 1,
      goals,
      habits,
      difficulty: genDifficulty,
      createdBy: 'ai',
      createdAt: isoDate(new Date()),
    };

    update((s) => ({
      ...s,
      postJourney: {
        ...s.postJourney,
        pendingAISuggestions: [...s.postJourney.pendingAISuggestions, suggestion],
      },
    }));

    setIsGenerating(false);
    setShowGenerator(false);
    setGenStep(1);
  }

  function generatePhaseName(focus: string[]): string {
    const blockType = BLOCK_TYPES.find(b => focus.includes(b.id));
    if (blockType) {
      const dayLabel = genDays <= 7 ? 'Week' : genDays <= 14 ? 'Fortnight' : 'Block';
      return `${dayLabel}: ${blockType.name}`;
    }
    const dayLabel = genDays <= 7 ? 'Week' : genDays <= 14 ? 'Fortnight' : 'Block';
    return `${dayLabel} ${focus[0] || 'Practice'}`;
  }

  function generateHabitsForFocus(focus: string[], difficulty: string): string[] {
    const habits: Record<string, string[]> = {
      physics: ['Read HCV Concepts', 'Solve 20 Problems', 'Formula Revision'],
      chemistry: ['NCERT Reading', 'Reaction Practice', 'JEE Patterns'],
      maths: ['Daily Practice', 'Previous Year Questions', 'Speed Calculation'],
      revision: ['Topic Recap', 'Quick Revisions', 'Flashcards'],
      mock: ['Full Mock', 'Analysis', 'Weak Topic Focus'],
      concept: ['Theory Reading', 'Example Problems', 'Concept Map'],
      problem: ['Problem Sets', 'Time Trials', 'Error Analysis'],
    };

    const selected: string[] = [];
    for (const f of focus) {
      if (habits[f]) {
        selected.push(...habits[f].slice(0, difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3));
      }
    }
    return [...new Set(selected)].slice(0, 6);
  }

  function generateDefaultGoals(focus: string[]): string[] {
    return [
      `Master ${focus[0] || 'topics'} fundamentals`,
      'Complete daily practice targets',
      'Track progress and improve weak areas',
    ];
  }

  function approvePhase(suggestionId: string) {
    haptic();
    update((s) => {
      const suggestion = s.postJourney.pendingAISuggestions.find(sg => sg.id === suggestionId);
      if (!suggestion) return s;

      const existingPhases = s.postJourney.customPhases;
      const lastPhase = existingPhases[existingPhases.length - 1];
      const dayStart = lastPhase ? lastPhase.dayEnd + 1 : 91;
      
      const newPhase = { ...suggestion, dayStart, dayEnd: dayStart + suggestion.goals.length + 10 };
      
      return {
        ...s,
        postJourney: {
          ...s.postJourney,
          customPhases: [...s.postJourney.customPhases, newPhase],
          pendingAISuggestions: s.postJourney.pendingAISuggestions.filter(sg => sg.id !== suggestionId),
          activeCustomPhaseId: newPhase.id,
        },
      };
    });
  }

  function rejectPhase(suggestionId: string) {
    haptic();
    update((s) => ({
      ...s,
      postJourney: {
        ...s.postJourney,
        pendingAISuggestions: s.postJourney.pendingAISuggestions.filter(sg => sg.id !== suggestionId),
      },
    }));
  }

  function setActivePhase(phaseId: string | null) {
    haptic();
    update((s) => ({
      ...s,
      postJourney: {
        ...s.postJourney,
        activeCustomPhaseId: phaseId,
      },
    }));
  }

  function deletePhase(phaseId: string) {
    haptic();
    update((s) => ({
      ...s,
      postJourney: {
        ...s.postJourney,
        customPhases: s.postJourney.customPhases.filter(p => p.id !== phaseId),
        activeCustomPhaseId: s.postJourney.activeCustomPhaseId === phaseId ? null : s.postJourney.activeCustomPhaseId,
      },
    }));
  }

  function toggleFocus(blockId: string) {
    haptic();
    setGenFocus(prev => 
      prev.includes(blockId) 
        ? prev.filter(f => f !== blockId)
        : [...prev, blockId]
    );
  }

  return (
    <div className="screen fade-up">
      <ScreenHeader
        eyebrow="POST-JOURNEY"
        title="Beyond 90 Days"
        subtitle="Custom blocks & mastery levels"
        right={
          onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-sm text-muted hover:text-text"
            >
              <ChevronRight size={18} className="rotate-180" />
              Back
            </button>
          ) : undefined
        }
      />

      {/* Journey Complete Button */}
      {!postJourney.journeyComplete && (
        <div className="gradient-border mb-6 rounded-2xl p-px" data-tone="gold">
          <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-5 text-center">
            <div className="mx-auto mb-3 inline-flex rotate-[-7deg] border-2 border-light px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-light">Complete</div>
            <h2 className="mb-2 font-display text-xl font-bold">90 days complete</h2>
            <p className="mb-4 text-sm text-muted">Claim your journey and unlock post-journey mode.</p>
            <button
              type="button"
              onClick={completeJourney}
              className="btn btn-primary w-full"
            >
              <Trophy size={16} className="mr-2" />
              Complete Journey
            </button>
          </div>
        </div>
      )}

      {/* Final Stats */}
      {postJourney.journeyComplete && postJourney.finalStats && (
        <div className="mb-6">
          <SectionHeader
            icon={<Trophy size={14} color="var(--color-light)" />}
            accent="var(--color-light)"
            title="Journey complete"
          />
          <div className="gradient-border rounded-2xl p-px" data-tone="gold">
            <div className="grid grid-cols-3 gap-3 rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-4">
              <StatCard icon={<Target size={16} />} label="Tasks" value={postJourney.finalStats.totalTasksCompleted} />
              <StatCard icon={<TrendingUp size={16} />} label="Accuracy" value={`${postJourney.finalStats.averageAccuracy}%`} />
              <StatCard icon={<Clock size={16} />} label="Hours" value={postJourney.finalStats.totalStudyHours} />
              <StatCard icon={<Zap size={16} />} label="Streak" value={`${postJourney.finalStats.streakDays}d`} />
              <StatCard icon={<Sparkles size={16} />} label="Levels" value={`${postJourney.finalStats.levelCleared}/30`} />
              <StatCard icon={<Trophy size={16} />} label="Phase" value={postJourney.finalStats.phaseReached.split(' ')[1] || 'End'} />
            </div>
          </div>
        </div>
      )}

      {/* Mastery Level */}
      {postJourney.journeyComplete && (
        <div className="mb-6">
          <SectionHeader
            icon={<Zap size={14} color="var(--color-l)" />}
            accent="var(--color-l)"
            title="Mastery Level"
          />
          <div className="gradient-border rounded-2xl p-px" data-tone="gold">
            <div className="flex items-center justify-between rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-4">
              <div className="flex items-center gap-3">
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${masteryConfig.bgColor}`}>
                  <masteryConfig.icon size={24} className={masteryConfig.color} />
                </span>
                <div>
                  <p className={`font-display text-lg font-bold ${masteryConfig.color}`}>{masteryConfig.label}</p>
                  <p className="text-xs text-muted">
                    {postJourney.mastery.level === 'beginner' && 'Just getting started!'}
                    {postJourney.mastery.level === 'intermediate' && 'Making good progress!'}
                    {postJourney.mastery.level === 'advanced' && 'Strong performer!'}
                    {postJourney.mastery.level === 'expert' && 'JEE Ready!'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-bold text-l">
                  {postJourney.extensionDays > 0 ? `Day ${90 + postJourney.extensionDays}` : 'Day 90'}
                </p>
                <p className="text-xs text-muted">Current day</p>
              </div>
            </div>
            <div className="rounded-b-[calc(var(--radius-2xl)-1px)] bg-panel px-4 pb-4">
              <div className="flex justify-between text-xs text-muted">
                <span>Beginner</span>
                <span>Intermediate</span>
                <span>Advanced</span>
                <span>Expert</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-bg">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blood via-l to-blood-bright transition-all"
                  style={{
                    width: `${
                      postJourney.mastery.level === 'beginner' ? 25 :
                      postJourney.mastery.level === 'intermediate' ? 50 :
                      postJourney.mastery.level === 'advanced' ? 75 : 100
                    }%`
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Block Generator */}
      {postJourney.journeyComplete && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <SectionHeader
              icon={<Wand2 size={14} color="var(--color-light)" />}
              accent="var(--color-light)"
              title="AI Block Generator"
            />
            {!showGenerator && (
              <button
                type="button"
                onClick={() => { haptic(); setShowGenerator(true); }}
                className="btn btn-primary text-xs"
              >
                <Plus size={14} className="mr-1" />
                New Block
              </button>
            )}
          </div>

          {/* Generator Wizard */}
          {showGenerator && (
            <div className="gradient-border rounded-2xl p-px slide-up" data-tone="gold">
              <div className="rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-display font-bold">Create Custom Block</h3>
                  <div className="flex gap-1">
                    {[1, 2, 3].map(step => (
                      <span
                        key={step}
                        className={`h-2 w-8 rounded-full transition-colors ${
                          step <= genStep ? 'bg-l' : 'bg-border'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Step 1: Duration */}
                {genStep === 1 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted">How many days for this block?</p>
                    <div className="flex gap-2">
                      {[7, 10, 15, 21, 30].map(days => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => { haptic(); setGenDays(days); }}
                          className={`flex-1 rounded-xl py-3 text-center font-medium transition-all ${
                            genDays === days
                              ? 'bg-l text-bg'
                              : 'bg-bg text-muted hover:bg-l/20'
                          }`}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => { haptic(); setGenStep(2); }}
                      className="btn btn-primary w-full"
                      disabled={genDays === 0}
                    >
                      Next: Focus Areas
                    </button>
                  </div>
                )}

                {/* Step 2: Focus Areas */}
                {genStep === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted">Select focus areas (can select multiple)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {BLOCK_TYPES.map(block => {
                        const Icon = block.icon;
                        const isSelected = genFocus.includes(block.id);
                        return (
                          <button
                            key={block.id}
                            type="button"
                            onClick={() => toggleFocus(block.id)}
                            className={`flex items-center gap-2 rounded-xl p-3 transition-all ${
                              isSelected
                                ? 'bg-l/20 border border-l/50'
                                : 'bg-bg border border-transparent'
                            }`}
                          >
                            <Icon size={18} style={{ color: block.color }} />
                            <span className="text-sm font-medium">{block.name}</span>
                            {isSelected && <Check size={14} className="ml-auto text-l" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { haptic(); setGenStep(1); }} className="btn btn-ghost flex-1">
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => { haptic(); setGenStep(3); }}
                        className="btn btn-primary flex-1"
                        disabled={genFocus.length === 0}
                      >
                        Next: Difficulty
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Difficulty & Goals */}
                {genStep === 3 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted">Select difficulty level</p>
                    <div className="flex gap-2">
                      {(['easy', 'medium', 'hard', 'extreme'] as const).map(diff => (
                        <button
                          key={diff}
                          type="button"
                          onClick={() => { haptic(); setGenDifficulty(diff); }}
                          className={`flex-1 rounded-xl py-3 text-center text-sm font-medium capitalize transition-all ${
                            genDifficulty === diff
                              ? DIFFICULTY_COLORS[diff].bg + ' ' + DIFFICULTY_COLORS[diff].text
                              : 'bg-bg text-muted hover:bg-bg/80'
                          }`}
                        >
                          {diff}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-muted">Specific Goals (optional)</label>
                      <textarea
                        value={genGoals}
                        onChange={(e) => setGenGoals(e.target.value)}
                        placeholder="e.g., Complete HCV Ch 1-5, Solve 200 problems..."
                        className="field min-h-[80px] w-full resize-none"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button type="button" onClick={() => { haptic(); setGenStep(2); }} className="btn btn-ghost flex-1">
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={generatePhase}
                        className="btn btn-primary flex-1"
                        disabled={isGenerating}
                      >
                        {isGenerating ? (
                          <>Generating...</>
                        ) : (
                          <>
                            <Wand2 size={14} className="mr-2" />
                            Generate Block
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => { haptic(); setShowGenerator(false); setGenStep(1); }}
                  className="absolute right-4 top-4 text-muted hover:text-text"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Suggestions */}
      {postJourney.journeyComplete && postJourney.pendingAISuggestions.length > 0 && (
        <div className="mb-6">
          <SectionHeader
            icon={<Sparkles size={14} color="var(--color-success)" />}
            accent="var(--color-success)"
            title="AI Suggestions"
            meta={`${postJourney.pendingAISuggestions.length} pending`}
          />
          <div className="space-y-3">
            {postJourney.pendingAISuggestions.map((suggestion) => (
              <PhaseCard
                key={suggestion.id}
                phase={suggestion}
                isActive={false}
                isPending
                onActivate={() => {}}
                onDelete={() => rejectPhase(suggestion.id)}
                onApprove={() => approvePhase(suggestion.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Custom Blocks */}
      {postJourney.journeyComplete && (
        <div className="mb-6">
          <SectionHeader
            icon={<ListChecks size={14} color="var(--color-l)" />}
            accent="var(--color-l)"
            title="Custom Blocks"
            meta={`${postJourney.customPhases.length} blocks`}
          />

          {postJourney.customPhases.length === 0 ? (
            <div className="gradient-border rounded-2xl p-px" data-tone="gold">
              <div className="flex flex-col items-center rounded-[calc(var(--radius-2xl)-1px)] bg-panel p-6 text-center">
                <BookOpen size={32} className="mb-2 text-muted" />
                <p className="mb-1 font-medium">No custom blocks yet</p>
                <p className="mb-3 text-xs text-muted">Use AI generator to create personalized blocks</p>
                <button
                  type="button"
                  onClick={() => { haptic(); setShowGenerator(true); }}
                  className="btn btn-primary"
                >
                  <Wand2 size={14} className="mr-2" />
                  Create First Block
                </button>
              </div>
            </div>
          ) : (
            <div className="relative space-y-2.5">
              <div className="absolute bottom-4 left-[3px] top-3 w-[2px] rounded-full bg-grid" aria-hidden="true" />
              {postJourney.customPhases.map((phase) => (
                <PhaseCard
                  key={phase.id}
                  phase={phase}
                  isActive={postJourney.activeCustomPhaseId === phase.id}
                  onActivate={() => setActivePhase(phase.id)}
                  onDelete={() => deletePhase(phase.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-bg p-3 text-center">
      <span className="mb-1 text-muted">{icon}</span>
      <p className="font-mono text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}

function PhaseCard({
  phase,
  isActive,
  isPending,
  onActivate,
  onDelete,
  onApprove,
}: {
  phase: CustomPhase;
  isActive: boolean;
  isPending?: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onApprove?: () => void;
}) {
  const difficultyColors = DIFFICULTY_COLORS[phase.difficulty];
  const blockType = BLOCK_TYPES.find(b => phase.habits.some(h => h.toLowerCase().includes(b.id)));
  const BlockIcon = blockType?.icon || BookOpen;

  return (
    <div className="relative">
      <span
        className={`absolute left-[-3px] top-4 z-10 h-3.5 w-3.5 rounded-full border-2 transition-all ${
          isActive ? 'pulse-dot' : ''
        }`}
        style={{
          borderColor: isActive ? 'var(--color-l)' : 'var(--color-border)',
          backgroundColor: isActive ? 'var(--color-l)' : 'var(--color-bg)',
        }}
        aria-hidden="true"
      />
      
      <div
        className={`card card-press w-full p-3.5 text-left transition-colors ${
          isActive ? 'ring-2 ring-l/30' : ''
        }`}
        style={{
          borderColor: isActive ? 'rgba(163,19,19,0.5)' : 'var(--color-border)',
          backgroundColor: isActive ? 'rgba(163,19,19,0.05)' : undefined,
        }}
      >
        <button
          type="button"
          onClick={() => haptic()}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <BlockIcon size={16} style={{ color: blockType?.color || 'var(--color-tag-default)' }} />
              <p className="font-mono text-[10px] tracking-widest text-muted">
                BLOCK · DAYS {phase.dayStart}–{phase.dayEnd}
              </p>
            </div>
            <p className="mt-0.5 truncate font-display text-[15px] font-bold tracking-tight">{phase.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg px-2 py-1 text-xs font-medium ${difficultyColors.bg} ${difficultyColors.text}`}>
              {phase.difficulty}
            </span>
            {isActive && (
              <span className="badge" style={{ backgroundColor: 'rgba(163,19,19,0.14)', color: 'var(--color-l)' }}>
                Active
              </span>
            )}
          </div>
        </button>

        {phase.goals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {phase.goals.slice(0, 3).map((goal, i) => (
              <span key={i} className="chip">
                {goal}
              </span>
            ))}
          </div>
        )}

        {phase.habits.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {phase.habits.slice(0, 4).map((habit, i) => (
              <span key={i} className="chip" style={{ borderColor: 'rgba(163,19,19,0.4)', color: 'var(--color-l)' }}>
                {habit}
              </span>
            ))}
            {phase.habits.length > 4 && (
              <span className="chip">+{phase.habits.length - 4}</span>
            )}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            {phase.createdBy === 'ai' ? (
              <>
                <Sparkles size={12} className="text-gold" />
                AI Generated
              </>
            ) : (
              <>
                <User size={12} />
                Custom
              </>
            )}
          </span>
          <div className="flex gap-2">
            {isPending ? (
              <>
                <button
                  type="button"
                  onClick={onApprove}
                  className="flex items-center gap-1 text-xs text-success hover:text-success/80"
                >
                  <Check size={14} />
                  Accept
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex items-center gap-1 text-xs text-danger hover:text-danger/80"
                >
                  <X size={14} />
                  Skip
                </button>
              </>
            ) : (
              <>
                {!isActive && (
                  <button
                    type="button"
                    onClick={onActivate}
                    className="flex items-center gap-1 text-xs text-muted hover:text-l"
                  >
                    <Check size={14} />
                    Activate
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex items-center gap-1 text-xs text-muted hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
