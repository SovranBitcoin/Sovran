import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { createSecureVault } from '../secureVault';

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
const scoped = (key: string) => `${NAMESPACE}:${key}`;
const SENSITIVE_KEYS = new Set([
  'api_keys',
  'child_keys',
  'xcashu_tokens',
  'cached_receive_tokens',
]);

export function createSdkStorageDriver(ownerPubkey: string) {
  const storage = createProfileScopedStorage(ownerPubkey);
  let pending = Promise.resolve();
  let failed = false;
  const enqueue = (write: () => Promise<void>) => {
    pending = pending
      .then(async () => {
        if (!failed) await write();
      })
      .catch(() => {
        failed = true;
      });
    // The SDK voids writes. Capture failures here and report them through
    // flush at the awaited wallet boundary, without an unhandled rejection.
    return pending;
  };
  return {
    async getItem<T>(key: string, defaultValue: T): Promise<T> {
      const legacy = await storage.getItem(scoped(key));
      if (!SENSITIVE_KEYS.has(key)) return legacy == null ? defaultValue : JSON.parse(legacy);
      const vault = createSecureVault(ownerPubkey, scoped(key));
      let raw = await vault.read();
      if (legacy !== null) {
        JSON.parse(legacy);
        if (raw !== null && raw !== legacy) throw new Error('Conflicting payment recovery records');
        if (raw === null) {
          await vault.write(legacy);
          raw = legacy;
        }
        await storage.removeItem(scoped(key));
      }
      return raw === null ? defaultValue : JSON.parse(raw);
    },
    setItem<T>(key: string, value: T): Promise<void> {
      const raw = JSON.stringify(value);
      return enqueue(async () => {
        if (SENSITIVE_KEYS.has(key)) await createSecureVault(ownerPubkey, scoped(key)).write(raw);
        else await storage.setItem(scoped(key), raw);
      });
    },
    removeItem(key: string): Promise<void> {
      return enqueue(async () => {
        if (SENSITIVE_KEYS.has(key))
          await createSecureVault(ownerPubkey, scoped(key)).write('null');
        else await storage.removeItem(scoped(key));
      });
    },
    async flush(): Promise<void> {
      await pending;
      if (failed) throw new Error('Payment recovery could not be saved');
    },
  };
}
