/**
 * AI Phase Generator Service
 * Generates custom phases based on user's progress and performance
 */

import type { AppState } from '../../core/domain/state';
import type { CustomPhase, JourneyFinalStats, MasteryLevel } from '../../core/domain/state';
import type { LLMService } from './llm.service';
import type { StateStore } from '../../core/ports/repositories';
import { isoDate } from '../../core/ports/clock';

export interface PhaseGenerationRequest {
  currentStats: JourneyStats;
  strongHabits: string[];
  weakHabits: string[];
  topicsCompleted: string[];
  topicsPending: string[];
  userPreferences?: string;
}

export interface JourneyStats {
  totalTasks: number;
  completedTasks: number;
  accuracy: number;
  studyHours: number;
  streakDays: number;
  clearedLevels: number;
}

const MASTERY_THRESHOLDS = {
  beginner: 0,
  intermediate: 50,
  advanced: 70,
  expert: 90,
};

export class PhaseGeneratorService {
  private readonly llm: LLMService;
  private readonly store: StateStore;

  constructor(llm: LLMService, store: StateStore) {
    this.llm = llm;
    this.store = store;
  }

  /**
   * Calculate mastery level based on overall performance
   */
  calculateMastery(stats: JourneyStats): MasteryLevel {
    const score = this.calculateOverallScore(stats);
    
    if (score >= MASTERY_THRESHOLDS.expert) return 'expert';
    if (score >= MASTERY_THRESHOLDS.advanced) return 'advanced';
    if (score >= MASTERY_THRESHOLDS.intermediate) return 'intermediate';
    return 'beginner';
  }

  /**
   * Calculate topic-wise mastery scores
   */
  calculateTopicScores(state: AppState): Record<string, number> {
    const scores: Record<string, number> = {};
    
    // Calculate based on task completion and performance
    for (const [, log] of Object.entries(state.taskLogs)) {
      for (const [taskId, completed] of Object.entries(log)) {
        if (completed) {
          // Extract topic from task ID (format: topic_subtopic_task)
          const topicId = taskId.split('_')[0];
          scores[topicId] = (scores[topicId] || 0) + 5; // +5 per completed task
        }
      }
    }

    // Normalize scores to 0-100
    const maxScore = Math.max(...Object.values(scores), 1);
    for (const topic of Object.keys(scores)) {
      scores[topic] = Math.min(100, Math.round((scores[topic] / maxScore) * 100));
    }

    return scores;
  }

  /**
   * Generate final journey stats
   */
  generateFinalStats(state: AppState): JourneyFinalStats {
    let totalTasks = 0;
    let completedTasks = 0;

    for (const log of Object.values(state.taskLogs)) {
      for (const completed of Object.values(log)) {
        totalTasks++;
        if (completed) completedTasks++;
      }
    }

    // Find strongest and weakest habits
    const habitScores: Record<string, { done: number; total: number }> = {};
    for (const [, log] of Object.entries(state.taskLogs)) {
      for (const taskId of Object.keys(log)) {
        const habitId = taskId.split('_')[0];
        if (!habitScores[habitId]) {
          habitScores[habitId] = { done: 0, total: 0 };
        }
        habitScores[habitId].total++;
        if (log[taskId]) {
          habitScores[habitId].done++;
        }
      }
    }

    let strongestHabit = 'N/A';
    let weakestHabit = 'N/A';
    let maxScore = 0;
    let minScore = 100;

    for (const [habitId, scores] of Object.entries(habitScores)) {
      if (scores.total === 0) continue;
      const avg = (scores.done / scores.total) * 100;
      if (avg > maxScore) {
        maxScore = avg;
        strongestHabit = habitId;
      }
      if (avg < minScore) {
        minScore = avg;
        weakestHabit = habitId;
      }
    }

    const totalStudyMinutes = state.studyTimeMinutes * Object.keys(state.taskLogs).length;

    return {
      totalTasksCompleted: completedTasks,
      averageAccuracy: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      strongestHabit,
      weakestHabit,
      totalStudyHours: Math.round(totalStudyMinutes / 60),
      streakDays: this.calculateMaxStreak(state),
      levelCleared: state.clearedLevels.length,
      phaseReached: this.getHighestPhase(state),
    };
  }

  /**
   * Check if journey is complete (day 90+)
   */
  isJourneyComplete(state: AppState): boolean {
    if (!state.startDateISO) return false;
    const today = new Date();
    const startDate = new Date(state.startDateISO);
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceStart >= 90 || state.clearedLevels.length >= 30;
  }

  /**
   * Generate AI phase suggestion based on progress
   */
  async generatePhaseSuggestion(request: PhaseGenerationRequest): Promise<CustomPhase> {
    const prompt = this.buildPhaseGenerationPrompt(request);
    
    const response = await this.llm.complete({
      messages: [
        { role: 'system', content: 'You are an expert JEE curriculum designer. Generate detailed phase plans.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 1500,
    });

    return this.parsePhaseFromResponse(response.text, request);
  }

  /**
   * Create custom phase manually
   */
  createCustomPhase(
    name: string,
    description: string,
    _days: number,
    goals: string[],
    habits: string[],
    difficulty: CustomPhase['difficulty'],
  ): CustomPhase {
    return {
      id: `custom-${Date.now()}`,
      name,
      description,
      dayStart: 0, // Will be calculated based on existing phases
      dayEnd: 0,
      goals,
      habits,
      difficulty,
      createdBy: 'user',
      createdAt: isoDate(new Date()),
    };
  }

  /**
   * Approve AI suggested phase
   */
  approveAISuggestion(state: AppState, suggestionId: string): AppState {
    const suggestion = state.postJourney.pendingAISuggestions.find(s => s.id === suggestionId);
    if (!suggestion) return state;

    const newPhase = { ...suggestion, createdBy: 'ai' as const };
    const updatedPhases = [...state.postJourney.customPhases, newPhase];
    const pending = state.postJourney.pendingAISuggestions.filter(s => s.id !== suggestionId);

    return {
      ...state,
      postJourney: {
        ...state.postJourney,
        customPhases: updatedPhases,
        pendingAISuggestions: pending,
        activeCustomPhaseId: newPhase.id,
      },
    };
  }

  /**
   * Reject AI suggested phase
   */
  rejectAISuggestion(state: AppState, suggestionId: string): AppState {
    return {
      ...state,
      postJourney: {
        ...state.postJourney,
        pendingAISuggestions: state.postJourney.pendingAISuggestions.filter(s => s.id !== suggestionId),
      },
    };
  }

  /**
   * Set active custom phase
   */
  setActivePhase(state: AppState, phaseId: string | null): AppState {
    return {
      ...state,
      postJourney: {
        ...state.postJourney,
        activeCustomPhaseId: phaseId,
      },
    };
  }

  // === Private Helpers ===

  private calculateOverallScore(stats: JourneyStats): number {
    const accuracyWeight = 0.4;
    const completionWeight = 0.3;
    const streakWeight = 0.2;
    const levelWeight = 0.1;

    const accuracyScore = stats.accuracy;
    const completionScore = stats.totalTasks > 0 
      ? (stats.completedTasks / stats.totalTasks) * 100 
      : 0;
    const streakScore = Math.min(100, stats.streakDays * 5);
    const levelScore = (stats.clearedLevels / 30) * 100;

    return Math.round(
      accuracyScore * accuracyWeight +
      completionScore * completionWeight +
      streakScore * streakWeight +
      levelScore * levelWeight
    );
  }

  private calculateMaxStreak(state: AppState): number {
    let maxStreak = 0;
    let currentStreak = 0;

    const dates = Object.keys(state.taskLogs).sort();
    for (let i = 0; i < dates.length; i++) {
      const log = state.taskLogs[dates[i]];
      const completedCount = Object.values(log).filter(Boolean).length;
      
      if (completedCount > 0) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    return maxStreak;
  }

  private getHighestPhase(state: AppState): string {
    if (state.clearedLevels.length >= 28) return 'Phase 4 - Peak Performance';
    if (state.clearedLevels.length >= 22) return 'Phase 3 - Light Execution';
    if (state.clearedLevels.length >= 14) return 'Phase 2 - L Mindset';
    if (state.clearedLevels.length >= 1) return 'Phase 1 - JEE Core';
    return 'Not Started';
  }

  private buildPhaseGenerationPrompt(request: PhaseGenerationRequest): string {
    return `Based on the following JEE preparation journey, suggest a custom phase:

STRONG HABITS: ${request.strongHabits.join(', ') || 'None'}
WEAK HABITS: ${request.weakHabits.join(', ') || 'None'}
TOPICS COMPLETED: ${request.topicsCompleted.join(', ') || 'None'}
TOPICS PENDING: ${request.topicsPending.join(', ') || 'All'}

STATS:
- Tasks: ${request.currentStats.completedTasks}/${request.currentStats.totalTasks}
- Accuracy: ${request.currentStats.accuracy}%
- Study Hours: ${request.currentStats.studyHours}
- Streak: ${request.currentStats.streakDays} days
- Levels Cleared: ${request.currentStats.clearedLevels}/30

${request.userPreferences ? `USER PREFERENCES: ${request.userPreferences}` : ''}

Generate a 10-15 day custom phase with:
1. A compelling name
2. Clear description
3. 3-5 specific goals
4. 4-6 habits to develop
5. Difficulty level (easy/medium/hard/extreme)

Format response as JSON:
{
  "name": "Phase Name",
  "description": "Description",
  "goals": ["goal1", "goal2", "goal3"],
  "habits": ["habit1", "habit2", "habit3", "habit4"],
  "difficulty": "medium"
}`;
  }

  private parsePhaseFromResponse(text: string, request: PhaseGenerationRequest): CustomPhase {
    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const existingPhases = this.store.get().postJourney.customPhases.length;
        const dayStart = 91 + (existingPhases * 15);
        
        return {
          id: `ai-phase-${Date.now()}`,
          name: data.name || 'AI Generated Phase',
          description: data.description || 'Custom AI-generated phase',
          dayStart,
          dayEnd: dayStart + 14,
          goals: data.goals || [],
          habits: data.habits || [],
          difficulty: data.difficulty || 'medium',
          createdBy: 'ai',
          createdAt: isoDate(new Date()),
        };
      }
    } catch (e) {
      console.error('Failed to parse phase from AI response:', e);
    }

    // Fallback: create basic phase
    return {
      id: `ai-phase-${Date.now()}`,
      name: 'Custom Practice Phase',
      description: 'Focus on weak areas and maintain strong habits',
      dayStart: 91,
      dayEnd: 105,
      goals: request.weakHabits.slice(0, 3),
      habits: [...request.strongHabits.slice(0, 2), ...request.weakHabits.slice(0, 2)],
      difficulty: 'medium',
      createdBy: 'ai',
      createdAt: isoDate(new Date()),
    };
  }
}
