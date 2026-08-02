import { describe, it, expect } from 'vitest';
import type { KeyValueRepository } from '../../../core/ports/repositories';
import type { ChatStoreState, ChatPreferences } from '../../../core/domain/chat';
import { LocalChatRepository, CHAT_STORAGE_KEY } from '../chat-repository';

const PREFS: ChatPreferences = {
  providerId: null,
  model: null,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  userPersona: '',
  includeContext: true,
};

function memoryStore(): KeyValueRepository & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe('LocalChatRepository', () => {
  it('loads an empty store when nothing is saved', () => {
    const repo = new LocalChatRepository(memoryStore());
    expect(repo.load()).toEqual({ version: 1, sessions: [] });
  });

  it('round-trips a saved store', () => {
    const store = memoryStore();
    const repo = new LocalChatRepository(store);
    const state: ChatStoreState = {
      version: 1,
      sessions: [{ id: 's1', title: 'Hi', messages: [], createdAt: 'x', updatedAt: 'x', prefs: PREFS }],
    };
    repo.save(state);
    expect(store.data.get(CHAT_STORAGE_KEY)).toContain('"s1"');
    expect(repo.load().sessions).toHaveLength(1);
  });

  it('recovers to an empty store on corrupt payloads', () => {
    const store = memoryStore();
    store.setItem(CHAT_STORAGE_KEY, '{not json');
    expect(new LocalChatRepository(store).load()).toEqual({ version: 1, sessions: [] });
  });

  it('recovers to an empty store on wrong version or missing sessions', () => {
    const store = memoryStore();
    store.setItem(CHAT_STORAGE_KEY, JSON.stringify({ version: 2, sessions: [] }));
    expect(new LocalChatRepository(store).load().sessions).toEqual([]);
    store.setItem(CHAT_STORAGE_KEY, JSON.stringify({ version: 1, sessions: 'oops' }));
    expect(new LocalChatRepository(store).load().sessions).toEqual([]);
  });
});
