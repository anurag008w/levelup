/**
 * Persistent Storage Service
 * Stores data that survives app updates on Android
 * Uses localStorage with prefix for compatibility
 */

const PREFIX = '@levelup:';

class PersistentStorage {
  private cache: Map<string, string> = new Map();
  private lastWriteError: string | null = null;

  constructor() {
    // Initialize cache from localStorage
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage(): void {
    // Non-browser environments (SSR, node-based test runners) have no
    // localStorage — skip seeding the cache instead of logging an error at
    // module import time. Browsers take the normal path below.
    if (typeof localStorage === 'undefined') return;
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(PREFIX)) {
          const value = localStorage.getItem(key);
          if (value) {
            this.cache.set(key, value);
          }
        }
      });
    } catch (error) {
      console.error('Error loading from localStorage:', error);
    }
  }

  /**
   * Get item from storage
   */
  async get<T>(key: string): Promise<T | null> {
    const storageKey = PREFIX + key;
    
    try {
      const value = this.cache.get(storageKey);
      if (value === undefined) {
        // Try localStorage directly
        const directValue = localStorage.getItem(storageKey);
        if (directValue) {
          return JSON.parse(directValue);
        }
        return null;
      }
      return JSON.parse(value);
    } catch (error) {
      console.error(`Error getting ${key}:`, error);
      return null;
    }
  }

  /**
   * Set item in storage. Resolves to true on success, false on failure.
   * Quota errors are tracked (see getLastWriteError) — a swallowed quota error
   * would otherwise mean SILENT data loss on the next app restart.
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    const storageKey = PREFIX + key;

    try {
      const serialized = JSON.stringify(value);
      this.cache.set(storageKey, serialized);
      localStorage.setItem(storageKey, serialized);
      this.lastWriteError = null;
      return true;
    } catch (error) {
      const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      this.lastWriteError = quota
        ? `Storage full — "${key}" save nahi hua (quota exceeded). Kuch purani memory delete karo.`
        : `Storage write failed for "${key}": ${String(error)}`;
      if (quota) console.error(`[storage] QUOTA EXCEEDED while saving ${key} — data will be lost on restart`, error);
      else console.error(`Error setting ${key}:`, error);
      return false;
    }
  }

  /** Last write failure (e.g. quota exceeded) or null when the last write succeeded. */
  getLastWriteError(): string | null {
    return this.lastWriteError;
  }

  /**
   * Remove item from storage
   */
  async remove(key: string): Promise<void> {
    const storageKey = PREFIX + key;
    
    try {
      this.cache.delete(storageKey);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error(`Error removing ${key}:`, error);
    }
  }

  /**
   * Clear all app storage
   */
  async clear(): Promise<void> {
    try {
      this.cache.clear();
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }

  /**
   * Get all keys
   */
  async keys(): Promise<string[]> {
    try {
      const allKeys = Object.keys(localStorage);
      return allKeys
        .filter((k: string) => k.startsWith(PREFIX))
        .map((k: string) => k.replace(PREFIX, ''));
    } catch (error) {
      console.error('Error getting keys:', error);
      return [];
    }
  }

  /**
   * Re-seeds the in-memory cache from localStorage. Call when another tab may
   * have written data (e.g. on visibilitychange → visible): known keys are
   * normally served from the cache, so without this the other tab's writes
   * stay invisible forever.
   */
  reload(): void {
    this.cache.clear();
    this.loadFromLocalStorage();
  }
}

const _persistentStorage = new PersistentStorage();
export const persistentStorage = _persistentStorage;
export default _persistentStorage;
