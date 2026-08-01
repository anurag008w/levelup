import type { ChatRepository } from '../../core/ports/repositories';
import type { KeyValueRepository } from '../../core/ports/repositories';
import type { ChatStoreState } from '../../core/domain/chat';

export const CHAT_STORAGE_KEY = 'levelup-chat-v1';

/** localStorage-backed chat store with defensive normalization. */
export class LocalChatRepository implements ChatRepository {
  private readonly store: KeyValueRepository;

  constructor(store: KeyValueRepository) {
    this.store = store;
  }

  load(): ChatStoreState {
    const raw = this.store.getItem(CHAT_STORAGE_KEY);
    if (raw === null) return { version: 1, sessions: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<ChatStoreState>;
      if (parsed.version === 1 && Array.isArray(parsed.sessions)) {
        return { version: 1, sessions: parsed.sessions };
      }
    } catch {
      // Corrupt payload — start fresh.
    }
    return { version: 1, sessions: [] };
  }

  save(state: ChatStoreState): void {
    this.store.setItem(CHAT_STORAGE_KEY, JSON.stringify(state));
  }
}
