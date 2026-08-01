/**
 * Persistent Storage Service
 * Stores data that survives app updates on Android
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@levelup:';

class PersistentStorage {
  private isNative: boolean;

  constructor() {
    this.isNative = typeof window !== 'undefined' && 
      (window as any).Capacitor?.isNative === true;
  }

  /**
   * Get item from storage
   */
  async get<T>(key: string): Promise<T | null> {
    const storageKey = PREFIX + key;
    
    try {
      if (this.isNative) {
        // Use Capacitor Storage for native
        const { Storage } = await import('@capacitor-community/storage');
        const result = await Storage.get({ key: storageKey });
        return result.value ? JSON.parse(result.value) : null;
      } else {
        // Fallback to localStorage for web
        const value = localStorage.getItem(storageKey);
        return value ? JSON.parse(value) : null;
      }
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
      
      if (this.isNative) {
        const { Storage } = await import('@capacitor-community/storage');
        await Storage.set({ key: storageKey, value: serialized });
      } else {
        localStorage.setItem(storageKey, serialized);
      }
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
      if (this.isNative) {
        const { Storage } = await import('@capacitor-community/storage');
        await Storage.remove({ key: storageKey });
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error(`Error removing ${key}:`, error);
    }
  }

  /**
   * Clear all app storage
   */
  async clear(): Promise<void> {
    try {
      if (this.isNative) {
        const { Storage } = await import('@capacitor-community/storage');
        await Storage.clear();
      } else {
        // Only clear app keys
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(PREFIX)) {
            localStorage.removeItem(key);
          }
        });
      }
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }

  /**
   * Get all keys
   */
  async keys(): Promise<string[]> {
    try {
      if (this.isNative) {
        const { Storage } = await import('@capacitor-community/storage');
        const { keys } = await Storage.keys();
        return keys
          .filter(k => k.startsWith(PREFIX))
          .map(k => k.replace(PREFIX, ''));
      } else {
        const allKeys = Object.keys(localStorage);
        return allKeys
          .filter(k => k.startsWith(PREFIX))
          .map(k => k.replace(PREFIX, ''));
      }
    } catch (error) {
      console.error('Error getting keys:', error);
      return [];
    }
  }
}

export const persistentStorage = new PersistentStorage();
export default persistentStorage;
