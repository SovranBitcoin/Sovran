import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { apiLog } from '@/shared/lib/logger';

/**
 * Key-value storage for `@routstr/sdk`, on the app's profile-scoped backing.
 *
 * The SDK ships `localStorageDriver` and an IndexedDB driver, neither of which
 * exists here. Its contract is three async methods over JSON values, so the
 * adaptation is small — and pointing it at `createProfileScopedStorage` is what
 * keeps a provider list, an API key or a stuck token from leaking between Nostr
 * accounts, which a shared AsyncStorage key would not.
 */

const NAMESPACE = 'routstr-sdk';
const storage = createProfileScopedStorage();

const scoped = (key: string) => `${NAMESPACE}:${key}`;

export const sdkStorageDriver = {
  async getItem<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const raw = await storage.getItem(scoped(key));
      return raw == null ? defaultValue : (JSON.parse(raw) as T);
    } catch {
      // A malformed value is a cache miss, never a crash: everything the SDK
      // keeps here is re-fetchable, and refusing to start over one bad row
      // would be worse than re-fetching.
      return defaultValue;
    }
  },

  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await storage.setItem(scoped(key), JSON.stringify(value));
    } catch (error) {
      apiLog.warn('routstr.sdk.storage_write_failed', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await storage.removeItem(scoped(key));
    } catch {
      // Nothing to do: the next read treats it as a miss either way.
    }
  },
};
