/**
 * Persistent Storage Service
 * Stores data that survives app updates on Android
 * Uses localStorage with prefix for compatibility
 */

const PREFIX = '@levelup:';

class PersistentStorage {
  private cache: Map<string, string> = new Map();

  constructor() {
    // Initialize cache from localStorage
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage(): void {
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
   * Set item in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    const storageKey = PREFIX + key;
    
    try {
      const serialized = JSON.stringify(value);
      this.cache.set(storageKey, serialized);
      localStorage.setItem(storageKey, serialized);
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
    }
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
}

const _persistentStorage = new PersistentStorage();
export const persistentStorage = _persistentStorage;
export default _persistentStorage;
